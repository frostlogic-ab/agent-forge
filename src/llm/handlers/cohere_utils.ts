import { nanoid } from "nanoid";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "openai/resources/index"; // Assuming these are available or will be mapped from ../types

import type {
  CohereModel,
  CompletionParams,
  CompletionResponse,
  // StreamCompletionResponse, // Not directly used by utils, but by handler
} from "../types"; // Adjusted import
import { InputError, InvariantError } from "./base"; // Value imports
import type { MessageRole } from "./base"; // Type import
import {
  // consoleWarn, // Not used in these utils, but good to keep in mind for handler
  convertMessageContentToString,
  // getTimestamp, // Not used in these utils, but by handler
} from "./bedrock_utils"; // Re-use if applicable, or define locally if different

// Types from cohere-ai/api - these might need to be defined locally or imported if cohere-ai is a direct dep
// For now, let's assume they are structurally similar or define placeholders if needed.
// type CohereClient = any; // Removed unused placeholder
type ApiMetaBilledUnits = any; // Placeholder
type ChatRequest = any; // Placeholder
type FinishReason = any; // Placeholder
type Message = any; // Placeholder
// type StreamedChatResponse = any; // Placeholder for stream processing, likely in handler
type Tool = any; // Placeholder for Cohere's Tool type
type ToolResult = any; // Placeholder for Cohere's ToolResult type

type CohereMessageRole = "CHATBOT" | "SYSTEM" | "USER" | "TOOL";

export const convertRole = (role: MessageRole): CohereMessageRole => {
  if (role === "assistant") {
    return "CHATBOT";
  }
  if (role === "system") {
    return "SYSTEM";
  }
  if (role === "tool") {
    return "TOOL";
  }
  if (role === "user") {
    return "USER";
  }
  if (role === "developer") {
    return "SYSTEM";
  }
  throw new InputError(`Unknown role: ${role}`);
};

export const convertFinishReason = (
  finishReason?: FinishReason
): CompletionResponse["choices"][0]["finish_reason"] => {
  if (
    finishReason === "COMPLETE" ||
    finishReason === "USER_CANCEL" ||
    finishReason === "STOP_SEQUENCE"
  ) {
    return "stop";
  }
  if (finishReason === "MAX_TOKENS") {
    return "length";
  }
  if (finishReason === "ERROR_TOXIC") {
    return "content_filter";
  }
  if (finishReason === "ERROR_LIMIT") {
    throw new Error(
      "The generation could not be completed because the model's context limit was reached."
    );
  }
  if (finishReason === "ERROR") {
    throw new Error("The generation could not be completed due to an error.");
  }
  return "unknown";
};

export const popLastUserMessageContentString = (
  messages: CompletionParams["messages"]
): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") {
      if (typeof message.content === "string") {
        messages.splice(i, 1);
        return message.content;
      }
      if (Array.isArray(message.content)) {
        for (const e of message.content) {
          if (e.type === "text") {
            messages.splice(i, 1);
            return e.text;
          }
        }
      }
    }
  }
  return "Empty"; // Placeholder for Cohere if no user message
};

export const convertStopSequences = (
  stop?: CompletionParams["stop"]
): string[] | undefined => {
  if (stop === null || stop === undefined) {
    return undefined;
  }
  if (typeof stop === "string") {
    return [stop];
  }
  if (Array.isArray(stop) && stop.every((e) => typeof e === "string")) {
    return stop;
  }
  throw new Error(`Unknown stop sequence type: ${stop}`);
};

export const toCohereTool = (tool: ChatCompletionTool): Tool => {
  const convertType = (
    type: string,
    properties?: any,
    additionalProperties?: any
  ): string => {
    switch (type) {
      case "string":
        return "str";
      case "integer":
        return "int";
      case "array":
        return `List${properties ? `[${convertType(properties.type)}]` : ""}`;
      case "object":
        if (additionalProperties) {
          return `Dict[str, ${convertType(additionalProperties.type)}]`;
        }
        return "Dict";
      default:
        return type;
    }
  };

  const convertProperties = (
    properties: Record<string, any>,
    requiredFields: string[]
  ): Record<string, any> => {
    const converted: Record<string, any> = {};
    for (const [key, value] of Object.entries(properties)) {
      const isRequired = requiredFields.includes(key);
      converted[key] = {
        description: value.description,
        type: convertType(value.type, value.items, value.additionalProperties),
        required: isRequired,
      };
      if (value.type === "object" && value.properties) {
        converted[key].properties = convertProperties(
          value.properties,
          value.required || []
        );
      }
    }
    return converted;
  };

  const required: string[] = Array.isArray(tool.function.parameters?.required)
    ? tool.function.parameters?.required
    : [];
  const parameterDefinitions = tool.function.parameters?.properties
    ? convertProperties(tool.function.parameters.properties, required)
    : undefined;

  return {
    name: tool.function.name,
    description: tool.function.description ?? "",
    parameterDefinitions,
  };
};

export const getUsageTokens = (
  billedUnits?: ApiMetaBilledUnits
): CompletionResponse["usage"] => {
  if (
    billedUnits &&
    typeof billedUnits.inputTokens === "number" &&
    typeof billedUnits.outputTokens === "number"
  ) {
    const { inputTokens, outputTokens } = billedUnits;
    return {
      completion_tokens: outputTokens,
      prompt_tokens: inputTokens,
      total_tokens: outputTokens + inputTokens,
    };
  }
  return undefined;
};

export const popLastToolMessageParams = (
  messages: CompletionParams["messages"]
): ChatCompletionToolMessageParam[] | undefined => {
  const lastMessage = messages.at(messages.length - 1);
  if (lastMessage === undefined || lastMessage.role !== "tool") {
    return undefined;
  }

  const toolMessages: ChatCompletionToolMessageParam[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "tool") {
      toolMessages.unshift(message as ChatCompletionToolMessageParam); // Type assertion
      messages.pop();
    } else {
      // Stop if we encounter a non-tool message from the end
      break;
    }
  }
  return toolMessages.length > 0 ? toolMessages : undefined;
};

export const toToolResult = (
  toolMessage: ChatCompletionToolMessageParam,
  previousMessages: CompletionParams["messages"]
): ToolResult => {
  let lastAssistantMessage: ChatCompletionAssistantMessageParam | null = null;
  for (let i = previousMessages.length - 1; i >= 0; i--) {
    const message = previousMessages[i];
    if (message.role === "tool") {
      continue;
    }
    if (message.role === "assistant") {
      lastAssistantMessage = message as ChatCompletionAssistantMessageParam; // Type assertion
      break;
    }
    throw new Error(
      `Expected an assistant message to precede tool messages, but detected a message from the ${message.role} role instead.`
    );
  }

  if (lastAssistantMessage === null) {
    throw new Error(
      `Could not find message from the 'assistant' role, which must precede messages from the 'tool' role.`
    );
  }
  if (lastAssistantMessage.tool_calls === undefined) {
    throw new Error(
      `Expected 'assistant' message to contain a 'tool_calls' field because it precedes tool call messages, but no 'tool_calls' field was found.`
    );
  }
  const toolCall = lastAssistantMessage.tool_calls.find(
    (t) => t.id === toolMessage.tool_call_id
  );
  if (!toolCall) {
    throw new Error(
      `Could not find the following tool call ID in the 'assistant' message: ${toolMessage.tool_call_id}`
    );
  }

  const toolCallContentStr = convertMessageContentToString(toolMessage.content);
  const toolResult: ToolResult = {
    // Assuming ToolResult structure
    call: {
      name: toolCall.function.name,
      parameters: JSON.parse(toolCall.function.arguments),
    },
    outputs: [JSON.parse(toolCallContentStr ?? "")], // Ensure content is string for JSON.parse
  };
  return toolResult;
};

export const convertMessages = (
  unclonedMessages: CompletionParams["messages"]
): {
  messages: Message[]; // Cohere's Message type
  lastUserMessage: string;
  toolResults: ChatRequest["toolResults"]; // Cohere's toolResults type
} => {
  const clonedMessages = structuredClone(unclonedMessages);

  const lastToolMessages = popLastToolMessageParams(clonedMessages);
  const lastToolResults = lastToolMessages?.map(
    (toolMessage) => toToolResult(toolMessage, clonedMessages) // Pass currently cloned (modified) messages
  );

  const lastUserMessage =
    lastToolResults === undefined
      ? popLastUserMessageContentString(clonedMessages)
      : "";

  const chatHistory: Message[] = []; // Use Cohere's Message type
  for (let i = 0; i < clonedMessages.length; i++) {
    const message = clonedMessages[i];
    if (message.role === "tool") {
      // This case should ideally not be hit if popLastToolMessageParams works correctly
      // and subsequent logic handles tool results properly.
      // However, if there are interspersed tool messages, Cohere wants them in toolResults.
      // This logic might be complex depending on how Cohere handles multiple sets of tool calls/results.
      // For now, this path tries to convert it similar to how lastToolResults are made.
      const newToolResult = toToolResult(
        message as ChatCompletionToolMessageParam,
        clonedMessages.slice(0, i)
      );
      const lastChatHistoryMessage = chatHistory.at(chatHistory.length - 1);
      if (
        lastChatHistoryMessage !== undefined &&
        lastChatHistoryMessage.role === "TOOL" && // Assuming Cohere Message has role
        Array.isArray(lastChatHistoryMessage.toolResults) // Assuming structure
      ) {
        lastChatHistoryMessage.toolResults.push(newToolResult);
      } else {
        chatHistory.push({
          role: "TOOL",
          toolResults: [newToolResult],
        } as Message); // Cast to Cohere Message
      }
    } else if (message.role === "assistant") {
      const messageContentStr = convertMessageContentToString(message.content);
      chatHistory.push({
        role: convertRole(message.role),
        message: messageContentStr ?? "", // Ensure message is string
        toolCalls: message.tool_calls?.map((toolCall) => {
          return {
            // This is Cohere's tool_call format within a CHATBOT message
            name: toolCall.function.name,
            parameters: JSON.parse(toolCall.function.arguments),
          };
        }),
      } as Message); // Cast to Cohere Message
    } else if (typeof message.content === "string") {
      chatHistory.push({
        role: convertRole(message.role),
        message: message.content,
      } as Message); // Cast to Cohere Message
    } else if (Array.isArray(message.content)) {
      // Handle cases where user/system message content is an array (e.g. for images, though Cohere might not support them this way)
      // For now, only taking text parts.
      for (const part of message.content) {
        if (part.type === "text") {
          chatHistory.push({
            role: convertRole(message.role),
            message: part.text,
          } as Message); // Cast to Cohere Message
        }
      }
    }
  }

  return {
    messages: chatHistory,
    lastUserMessage,
    toolResults: lastToolResults as ChatRequest["toolResults"], // Cast as it might be undefined
  };
};

export const convertTools = (
  tools: CompletionParams["tools"],
  toolChoice: CompletionParams["tool_choice"]
): ChatRequest["tools"] => {
  if (toolChoice === "none" || tools === undefined) {
    return undefined;
  }
  // Assuming ChatRequest['tools'] is Tool[]
  return tools.map(toCohereTool) as ChatRequest["tools"];
};
