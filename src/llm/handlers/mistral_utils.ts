import type {
  ChatCompletionResponseChoice,
  ChatRequest,
  ChatCompletionResponse as MistralChatCompletionResponse,
  ChatCompletionResponseChunk as MistralChatCompletionResponseChunk,
  Message as MistralMessage, // Renamed to avoid conflict with our LLMMessage
  ToolCalls as MistralToolCalls,
} from "@mistralai/mistralai";
import type OpenAI from "openai"; // Added for specific Delta.ToolCall type
import type {
  ChatCompletionChunk, // For ChatCompletionChunk.Choice.Delta.ToolCall
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool, // Added for typing 'tool' parameter
} from "openai/resources/index"; // Assuming this is where ChatCompletionChunk is for ToolCall delta
import type { ChatCompletionContentPartText } from "openai/src/resources/index.js"; // Verify path

import type {
  CompletionParams,
  CompletionResponse,
  StreamCompletionResponse,
} from "../types"; // Changed from ../index to ../types
import { InputError } from "./base"; // Assuming InputError is in base.ts
// convertMessageContentToString was from ./utils.js in tokenjs, assume it's in ./utils.ts now
import { consoleWarn } from "./utils"; // Changed path from ../utils to ./utils

// Helper to convert our generic message content to string, needed by convertMessages.
// This might be a duplicate of a function in general utils, or needs to be robust.
// For now, a simple version based on original tokenjs `convertMessageContentToString`.
const simpleConvertMessageContentToString = (
  content: ChatCompletionMessageParam["content"]
): string => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    // Assuming multi-part content, concatenate text parts.
    // This simplification might not be suitable for all cases (e.g. images).
    return content
      .filter((part) => part.type === "text")
      .map((part) => (part as ChatCompletionContentPartText).text)
      .join("\n");
  }
  return ""; // Or throw error if null/undefined content is not expected
};

export const findLinkedToolCallName = (
  messages: ChatCompletionMessage[],
  toolCallId: string
): string => {
  for (const message of messages) {
    for (const toolCall of message?.tool_calls ?? []) {
      if (toolCall.id === toolCallId) {
        return toolCall.function.name;
      }
    }
  }
  throw new InputError(`Tool call with id ${toolCallId} not found in messages`);
};

export const convertMessages = (
  messages: (ChatCompletionMessageParam | ChatCompletionMessage)[]
): (MistralMessage | ChatCompletionResponseChoice["message"])[] => {
  return messages
    .map((message) => {
      const messageContent = simpleConvertMessageContentToString(
        message.content
      );
      if (message.role === "tool") {
        if (!message.tool_call_id) {
          throw new InputError("Tool message missing tool_call_id");
        }
        const name = findLinkedToolCallName(
          messages as ChatCompletionMessage[],
          message.tool_call_id
        );
        return {
          name,
          role: "tool",
          content: messageContent,
          tool_call_id: message.tool_call_id,
        } as MistralMessage; // Mistral tool message needs name
      }

      if (message.role === "system") {
        return {
          role: message.role,
          content: messageContent,
        } as MistralMessage;
      }
      if (message.role === "assistant") {
        return {
          role: message.role,
          content: messageContent,
          tool_calls:
            (message.tool_calls as MistralToolCalls[] | null | undefined) ??
            null, // Ensure type compatibility
        } as MistralMessage;
      }
      if (message.role === "user") {
        return {
          role: message.role,
          content: messageContent, // Mistral user message content is string
        } as MistralMessage;
      }
      // Handle deprecated 'function' role or other unexpected roles
      consoleWarn(
        `Unsupported message role for Mistral: ${message.role}. Skipping.`
      );
      return null; // Or throw error, for now skipping with null
    })
    .filter(Boolean) as (
    | MistralMessage
    | ChatCompletionResponseChoice["message"]
  )[]; // Filter out nulls
};

export const convertTools = (
  tools: CompletionParams["tools"],
  specificFunctionName?: string
): ChatRequest["tools"] => {
  if (!tools) {
    return undefined;
  }
  const specifiedTool = tools.filter((tool: ChatCompletionTool) => {
    if (specificFunctionName === undefined) {
      return true;
    }
    return tool.function.name === specificFunctionName;
  });
  if (specificFunctionName !== undefined && specifiedTool.length === 0) {
    throw new InputError(
      `Tool with name ${specificFunctionName} not found in tool list`
    );
  }
  return specifiedTool.map((tool: ChatCompletionTool) => ({
    type: "function",
    function: {
      name: tool.function.name,
      description: tool.function.description ?? "",
      parameters: tool.function.parameters ?? {},
    },
  }));
};

export const convertToolConfig = (
  toolChoice: CompletionParams["tool_choice"],
  tools: CompletionParams["tools"]
): {
  toolChoice: ChatRequest["toolChoice"];
  tools: ChatRequest["tools"];
} => {
  if (typeof toolChoice === "object" && toolChoice?.function?.name) {
    return {
      toolChoice: "any", // Force a tool, then filter the list
      tools: convertTools(tools, toolChoice.function.name),
    };
  }
  switch (toolChoice) {
    case "auto":
      return { toolChoice: "auto", tools: convertTools(tools) };
    case "none":
      return { toolChoice: "none", tools: convertTools(tools) };
    case "required":
      return { toolChoice: "any", tools: convertTools(tools) }; // 'any' is Mistral's closest to 'required'
    case undefined:
      return { toolChoice: undefined, tools: convertTools(tools) };
    default:
      throw new InputError(`Invalid tool choice: ${toolChoice}`);
  }
};

export const convertToolCallsToMistral = (
  toolCalls: ChatCompletionMessageToolCall[] | undefined
): MistralToolCalls[] | undefined => {
  if (!toolCalls) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));
};

export const convertMistralToolCallsToOpenAI = (
  toolResponse: MistralToolCalls[] | null | undefined
): ChatCompletionMessageToolCall[] | undefined => {
  if (!toolResponse) {
    return undefined;
  }
  return toolResponse.map((tool) => ({
    id: tool.id,
    type: "function",
    function: {
      name: tool.function.name,
      arguments: tool.function.arguments,
    },
  }));
};

export const convertMistralStreamToolCallsToOpenAI = (
  toolResponse: MistralToolCalls[] | null | undefined
):
  | OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[]
  | undefined => {
  if (!toolResponse) {
    return undefined;
  }
  return convertMistralToolCallsToOpenAI(toolResponse)?.map(
    (toolCall, index) => ({
      ...toolCall,
      index,
    })
  ) as
    | OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[]
    | undefined;
};

export async function* toStreamResponse(
  result: AsyncGenerator<MistralChatCompletionResponseChunk, void, unknown>,
  createdTimestamp: number,
  responseModel: string
): StreamCompletionResponse {
  for await (const chunk of result) {
    yield {
      id: chunk.id,
      created: createdTimestamp, // Use consistent created time for all chunks in a stream
      object: "chat.completion.chunk",
      model: responseModel, // Mistral chunks have model, use it or fallback
      choices: chunk.choices.map((choice) => ({
        index: choice.index,
        delta: {
          role: (choice.delta.role ||
            "assistant") as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta["role"], // Cast role
          content: choice.delta.content,
          tool_calls: convertMistralStreamToolCallsToOpenAI(
            choice.delta.tool_calls as MistralToolCalls[] | undefined
          ),
        },
        finish_reason: choice.finish_reason as any, // Cast if Mistral type differs
        logprobs: null, // Mistral doesn't provide logprobs in stream
      })),
      // Mistral API chunk doesn't have top-level usage; it comes at the end of stream if requested.
      // This needs to be handled by the main MistralHandler if usage is to be included.
      usage: chunk.usage ?? undefined,
    };
  }
}

export const toCompletionResponse = (
  result: MistralChatCompletionResponse,
  createdTimestamp: number
): CompletionResponse => {
  return {
    id: result.id,
    created: createdTimestamp,
    object: "chat.completion",
    model: result.model,
    choices: result.choices.map((choice) => ({
      index: choice.index,
      message: {
        role: "assistant",
        refusal: null, // Added refusal property
        content: choice.message.content,
        tool_calls: convertMistralToolCallsToOpenAI(
          choice.message.tool_calls as MistralToolCalls[] | undefined
        ),
      },
      finish_reason: choice.finish_reason as any, // Cast if Mistral type differs
      logprobs: null, // Mistral doesn't provide logprobs
    })),
    usage: result.usage
      ? {
          prompt_tokens: result.usage.prompt_tokens,
          completion_tokens: result.usage.completion_tokens,
          total_tokens: result.usage.total_tokens,
        }
      : undefined,
  };
};
