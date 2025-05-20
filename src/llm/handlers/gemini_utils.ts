import {
  type Content,
  type EnhancedGenerateContentResponse,
  // FunctionResponse, // Not directly used in utils, but for context
  // GenerateContentStreamResult, // Stream is handled in main handler but output processing here
  FinishReason,
  type FunctionDeclaration,
  type Tool as GeminiTool,
  HarmBlockThreshold,
  HarmCategory,
  type Part,
  // GenerationConfig, // Config is used in main handler
} from "@google/generative-ai";
import type { SafetySetting } from "@google/generative-ai";
import type {
  LLMCompletionOutput,
  LLMFunctionCallMessage,
  LLMMessage,
  // LLMToolChoice, // Handled in main logic
  LLMOutputChoice,
  LLMToolCall,
  LLMToolResponseMessage,
  LLMUsage,
  // ProviderModelMap, // Not used here
  // ProviderModels, // Not used here
} from "../../types";
import { InputError, InvariantError } from "./base"; // Assuming InputError is in base.ts

export const GEMINI_SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

// Utility: Convert LLMMessage role to Gemini role
export function toGeminiRole(
  role: LLMMessage["role"]
): "user" | "model" | "function" {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      // For assistant messages that are function calls, Gemini expects 'model' role
      // containing `functionCall` parts. If it's a response to a function call,
      // it's a 'function' role message from the user with `functionResponse` parts.
      return "model";
    case "system":
      console.warn(
        "Gemini does not directly support 'system' roles in chat history in the same way as OpenAI. " +
          "System instructions should be handled separately or merged with the first user message."
      );
      // Treating as 'user' if forced into history, but ideally handled by SystemInstruction parameter.
      return "user";
    case "tool":
      return "function"; // Gemini uses "function" for tool/function call results (FunctionResponse)
    default:
      throw new InputError(`Unsupported role for Gemini: ${role}`);
  }
}

// Utility: Convert LLMMessage content to Gemini Parts
export function messageToGeminiParts(message: LLMMessage): Part[] {
  if (message.role === "tool") {
    const toolMessage = message as LLMToolResponseMessage;
    // The 'name' in functionResponse should match the 'name' in a preceding functionCall.
    // The 'id' from LLMToolResponseMessage (tool_call_id) is used for this mapping.
    return [
      {
        functionResponse: {
          name: toolMessage.tool_call_id, // This must match the name of the function in the call
          response: {
            // Gemini expects the response to have a 'name' (matching the call) and 'content' (the result)
            // The actual function name that was called might also be needed here if different from id
            // For now, assuming tool_call_id is the function name expected by Gemini.
            name: toolMessage.tool_call_id, // This seems redundant if it's in functionResponse.name
            // but SDK examples sometimes show it. Let's follow typical patterns.
            // The actual response data from the tool execution.
            content: toolMessage.content,
          },
        },
      },
    ];
  }

  if (message.role === "assistant" && message.tool_calls) {
    const assistantMessage = message as LLMFunctionCallMessage;
    return assistantMessage.tool_calls.map((toolCall) => ({
      functionCall: {
        name: toolCall.function.name,
        args:
          typeof toolCall.function.arguments === "string"
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments,
      },
    }));
  }

  if (typeof message.content === "string") {
    return [{ text: message.content }];
  }

  if (Array.isArray(message.content)) {
    return message.content.map((part) => {
      if (part.type === "text") {
        return { text: part.text };
      }
      if (part.type === "image_url" && part.image_url) {
        // This is a placeholder and needs robust handling for various image URI types (data, http)
        // and conversion to Gemini's `inlineData` format if necessary.
        console.warn(
          "Image handling in messageToGeminiParts is simplified and requires proper implementation for base64/URL handling."
        );
        // Example structure for inline data:
        // return { inlineData: { mimeType: "image/jpeg", data: "base64encodedimage..." } };
        return { text: `[Image: ${part.image_url.url}]` }; // Placeholder
      }
      throw new InputError(
        `Unsupported message content part type: ${(part as any).type}`
      );
    });
  }
  return []; // Should ideally not be reached if message.content is typed correctly
}

// Utility: Convert LLMMessages to Gemini Content array
// Handles system prompt by expecting it to be passed to the model separately or merged by caller.
export function toGeminiHistory(messages: LLMMessage[]): Content[] {
  const history: Content[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      // Skip system messages here; they should be handled by the `systemInstruction` parameter
      // or merged into the first user message by the calling logic if that's the strategy.
      console.warn(
        "System messages in history are skipped by toGeminiHistory; use systemInstruction."
      );
      continue;
    }

    const role = toGeminiRole(message.role);
    const parts = messageToGeminiParts(message);

    // Gemini requires alternating user and model roles.
    // If the last message has the same role, and it's 'model', merge parts.
    // This handles consecutive assistant messages (e.g., text response followed by tool call).
    if (
      history.length > 0 &&
      history[history.length - 1].role === role &&
      role === "model"
    ) {
      history[history.length - 1].parts.push(...parts);
    } else if (
      history.length > 0 &&
      history[history.length - 1].role === role &&
      role === "user"
    ) {
      // if previous was user and current is user, merge
      history[history.length - 1].parts.push(...parts);
    } else {
      history.push({ role, parts });
    }
  }
  return history;
}

// Utility: Convert LLMToolCall to GeminiTool array
export function toGeminiTools(tools?: LLMToolCall[]): GeminiTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  // Gemini expects a single GeminiTool object with a list of FunctionDeclarations
  const functionDeclarations = tools.map((tool): FunctionDeclaration => {
    if (tool.type !== "function") {
      throw new InputError(
        `Unsupported tool type for Gemini: ${tool.type}. Only 'function' is supported.`
      );
    }
    return {
      name: tool.function.name,
      description: tool.function.description || "", // Ensure description is not undefined
      parameters: tool.function.parameters as any, // Cast for now, ensure schema is compatible with Gemini's
    };
  });
  return [{ functionDeclarations }];
}

// Utility: Convert Gemini API response to LLMCompletionOutput
export function fromGeminiResponseToLLMCompletionOutput(
  response: EnhancedGenerateContentResponse,
  model: string
): LLMCompletionOutput {
  const choices: LLMOutputChoice[] = [];

  response.candidates?.forEach((candidate, index) => {
    let message: LLMMessage;
    const firstPart = candidate.content?.parts[0]; // Get the first part to check for functionCall

    if (
      candidate.finishReason === FinishReason.TOOL_EXECUTION &&
      firstPart?.functionCall
    ) {
      message = {
        role: "assistant",
        content: null,
        tool_calls: candidate.content.parts.map((part) => {
          if (!part.functionCall) {
            throw new InvariantError(
              "Gemini: Expected functionCall in part for TOOL_EXECUTION finish reason."
            );
          }
          return {
            // Ensure a unique ID for each tool call if multiple are generated.
            // Gemini's functionCall.name could serve, assuming it's unique per call in a response.
            id: part.functionCall.name, // This might need a more robust unique ID generation.
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args), // Args are already an object
            },
          };
        }),
      };
    } else {
      // Handle cases like STOP, MAX_TOKENS, etc., or if functionCall is not present
      const textContent = candidate.content?.parts
        .map((p) => p.text)
        .filter(Boolean)
        .join("");
      message = {
        role: "assistant",
        content: textContent || "", // Ensure content is always a string, even if empty
      };
    }

    choices.push({
      index: index,
      message: message,
      finish_reason: mapGeminiFinishReason(candidate.finishReason),
      // logprobs: null, // Gemini API might not provide logprobs directly
    });
  });

  const usage: LLMUsage = {
    prompt_tokens: response.usageMetadata?.promptTokenCount ?? 0,
    completion_tokens: response.usageMetadata?.candidatesTokenCount ?? 0, // Sum of all candidates' tokens
    total_tokens: response.usageMetadata?.totalTokenCount ?? 0,
  };

  return {
    id: `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`, // Generate a more unique ID
    object: "completion", // Consistent with OpenAI terminology
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    usage,
  };
}

function mapGeminiFinishReason(
  reason?: FinishReason
): LLMOutputChoice["finish_reason"] {
  if (!reason) return "unknown";
  switch (reason) {
    case FinishReason.STOP:
      return "stop";
    case FinishReason.MAX_TOKENS:
      return "length";
    case FinishReason.SAFETY:
      return "content_filter";
    case FinishReason.RECITATION:
      return "recitation"; // Or map to a more generic one if not directly applicable
    case FinishReason.TOOL_EXECUTION:
      return "tool_calls";
    case FinishReason.OTHER:
      return "unknown";
    case FinishReason.UNSPECIFIED:
      return "unknown";
    default:
      return "unknown";
  }
}

// Utility for streaming: Convert Gemini stream chunks to LLMCompletionOutput chunks
export async function* fromGeminiStreamChunkToLLMCompletionOutputChunk(
  stream: AsyncIterable<EnhancedGenerateContentResponse>,
  modelId: string // Changed from 'model' to 'modelId' to avoid conflict with 'model' role
): AsyncGenerator<LLMCompletionOutput> {
  // Variables to accumulate parts of a streaming response, especially for tool calls
  // This is complex because tool calls might arrive in multiple chunks.
  // For simplicity, this initial version assumes each chunk with functionCall data is somewhat self-contained for delta purposes.
  // A truly robust implementation would buffer and assemble complete tool calls.

  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0];
    if (!candidate) continue;

    const part = candidate.content?.parts[0]; // Consider all parts for a more robust impl.
    let deltaContent: string | null = null;
    let toolCallDeltas: LLMToolCall[] | undefined = undefined;
    const finishReason = mapGeminiFinishReason(candidate.finishReason);

    if (part?.text) {
      deltaContent = part.text;
    }

    // Handling streaming of tool calls:
    // Gemini may send functionCall name in one chunk and arguments in subsequent ones.
    // This simplified delta just reports what's in the current chunk's part.
    if (part?.functionCall) {
      toolCallDeltas = [
        {
          // The ID should be consistent for all deltas of the same tool_call.
          // Gemini function call name can serve as a temporary ID during streaming if unique.
          id: part.functionCall.name, // This might not be unique if multiple calls to same func
          type: "function",
          function: {
            name: part.functionCall.name,
            // Arguments are an object. Streaming them means sending partial updates.
            // For delta, stringifying the current args fragment.
            arguments: JSON.stringify(part.functionCall.args),
          },
        },
      ];
    }

    const choice: LLMOutputChoice = {
      index: 0, // Streaming typically builds a single choice (index 0)
      delta: {
        role: "assistant",
        content: deltaContent,
        tool_calls: toolCallDeltas,
      },
      finish_reason:
        finishReason === "unknown" && !deltaContent && !toolCallDeltas
          ? null
          : finishReason,
    };

    const outputChunk: LLMCompletionOutput = {
      id: `gemini-chunk-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
      object: "completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [choice],
      usage: chunk.usageMetadata
        ? {
            prompt_tokens: chunk.usageMetadata.promptTokenCount,
            // Completion tokens in a chunk might be cumulative or per-chunk, SDK dependent.
            // For now, reflecting what's given.
            completion_tokens: chunk.usageMetadata.candidatesTokenCount,
            total_tokens: chunk.usageMetadata.totalTokenCount,
          }
        : undefined,
    };
    yield outputChunk;
  }
}
