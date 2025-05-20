import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ImageBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  MessageStream,
  TextBlock,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
  ToolUseBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type OpenAI from "openai";
import type { ChatCompletionMessageToolCall } from "openai/resources/index";

import type {
  AnthropicModel,
  CompletionParams,
  ProviderCompletionParams,
} from "../types";
import type {
  CompletionResponse,
  CompletionResponseChunk,
  StreamCompletionResponse,
} from "../types";
import {
  consoleWarn,
  convertMessageContentToString,
  fetchThenParseImage,
  getTimestamp,
  isEmptyObject,
} from "./anthropic_utils";
import { BaseHandler, InputError, InvariantError } from "./base";

// NOTE: Many helper functions from the original anthropic.ts (like createCompletionResponseNonStreaming, etc.)
// are kept here. They might be refactorable or made more generic later.

export const createCompletionResponseNonStreaming = (
  response: Message,
  created: number,
  toolChoice: CompletionParams["tool_choice"]
): CompletionResponse => {
  const finishReason = toFinishReasonNonStreaming(response.stop_reason);
  const chatMessage = toChatCompletionChoiceMessage(
    response.content,
    response.role,
    toolChoice
  );
  const choice = {
    index: 0,
    logprobs: null,
    message: chatMessage,
    finish_reason: finishReason,
  };
  const converted: CompletionResponse = {
    id: response.id,
    choices: [choice],
    created,
    model: response.model,
    object: "chat.completion",
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };

  return converted;
};

export async function* createCompletionResponseStreaming(
  response: MessageStreamEvent,
  created: number
): StreamCompletionResponse {
  let message: Message | undefined;

  let initialToolCallIndex: number | null = null;

  for await (const chunk of response) {
    if (chunk.type === "message_start") {
      message = chunk.message;
      yield {
        choices: [
          {
            index: 0,
            finish_reason: toFinishReasonStreaming(chunk.message.stop_reason),
            logprobs: null,
            delta: {
              role: chunk.message.role,
            },
          },
        ],
        created,
        model: message.model,
        id: message.id,
        object: "chat.completion.chunk",
      };
    }

    if (message === undefined) {
      throw new InvariantError("Message is undefined.");
    }

    let newStopReason: Message["stop_reason"] | undefined;

    let delta: CompletionResponseChunk["choices"][0]["delta"] = {};
    if (chunk.type === "content_block_start") {
      if (chunk.content_block.type === "text") {
        delta = {
          content: chunk.content_block.text,
        };
      } else {
        if (initialToolCallIndex === null) {
          initialToolCallIndex = chunk.index;
        }

        delta = {
          tool_calls: [
            {
              index: chunk.index - initialToolCallIndex,
              id: chunk.content_block.id,
              type: "function",
              function: {
                name: chunk.content_block.name,
                arguments: isEmptyObject(chunk.content_block.input)
                  ? ""
                  : JSON.stringify(chunk.content_block.input),
              },
            },
          ],
        };
      }
    } else if (chunk.type === "content_block_delta") {
      if (chunk.delta.type === "input_json_delta") {
        if (initialToolCallIndex === null) {
          throw new InvariantError(
            "Content block delta event came before a content block start event."
          );
        }

        delta = {
          tool_calls: [
            {
              index: chunk.index - initialToolCallIndex,
              function: {
                arguments: chunk.delta.partial_json,
              },
            },
          ],
        };
      } else {
        delta = {
          content: chunk.delta.text,
        };
      }
    } else if (chunk.type === "message_delta") {
      newStopReason = chunk.delta.stop_reason;
    }

    const stopReason =
      newStopReason !== undefined ? newStopReason : message.stop_reason;
    const finishReason = toFinishReasonStreaming(stopReason);

    const chunkChoice = {
      index: 0,
      finish_reason: finishReason,
      logprobs: null,
      delta,
    };

    yield {
      choices: [chunkChoice],
      created,
      model: message.model,
      id: message.id,
      object: "chat.completion.chunk",
    };
  }
}

const isTextBlock = (contentBlock: ContentBlock): contentBlock is TextBlock => {
  return contentBlock.type === "text";
};

const isToolUseBlock = (
  contentBlock: ContentBlock
): contentBlock is ToolUseBlock => {
  return contentBlock.type === "tool_use";
};

const toChatCompletionChoiceMessage = (
  content: Message["content"],
  role: Message["role"],
  toolChoice: CompletionParams["tool_choice"]
): CompletionResponse["choices"][0]["message"] => {
  const textBlocks = content.filter(isTextBlock);
  if (textBlocks.length > 1) {
    consoleWarn(
      "Received multiple text blocks from Anthropic, which is unexpected. Concatenating the text blocks into a single string."
    );
  }

  let toolUseBlocks: Anthropic.Messages.ToolUseBlock[];
  if (
    typeof toolChoice === "object" &&
    toolChoice?.type === "function" // OpenAI's way of specifying a tool
  ) {
    const selected = content
      .filter(isToolUseBlock)
      .find((block) => block.name === toolChoice.function.name);
    if (!selected) {
      throw new InvariantError(
        `Did not receive a tool use block from Anthropic for the function: ${toolChoice.function.name}`
      );
    }
    toolUseBlocks = [selected];
  } else {
    toolUseBlocks = content.filter(isToolUseBlock);
  }

  let toolCalls: ChatCompletionMessageToolCall[] | undefined;
  if (toolUseBlocks.length > 0) {
    toolCalls = toolUseBlocks.map((toolUse) => {
      return {
        id: toolUse.id,
        function: {
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input),
        },
        type: "function",
      };
    });
  }

  // Assuming 'refusal' can be null if not provided by Anthropic.
  // This aligns with OpenAI's ChatCompletionMessage type if 'refusal' is optional or nullable.
  const refusal: string | null = null; // Defaulting to null.

  if (textBlocks.length === 0) {
    const messageContent = content.every(isToolUseBlock) ? null : "";
    if (role === "assistant") {
      return {
        role,
        content: messageContent,
        tool_calls: toolCalls,
        refusal, // Added refusal
      };
    }
    // For user messages, or other roles that don't have 'refusal'
    return {
      role,
      content: messageContent,
      tool_calls: toolCalls,
    } as any; // Cast to bypass strict check if other roles don't expect refusal
  }

  if (role === "assistant") {
    return {
      role,
      content: textBlocks.map((block) => block.text).join(""),
      tool_calls: toolCalls,
      refusal, // Added refusal
    };
  }
  // For user messages or other roles
  return {
    role,
    content: textBlocks.map((block) => block.text).join(""),
    tool_calls: toolCalls,
  } as any; // Cast to bypass strict check
};

const toFinishReasonNonStreaming = (
  stopReason: Message["stop_reason"]
): CompletionResponse["choices"][0]["finish_reason"] => {
  if (stopReason === "end_turn") {
    return "stop";
  }
  if (stopReason === "tool_use") {
    return "tool_calls";
  }
  if (stopReason === "max_tokens") {
    return "length";
  }
  if (stopReason === "stop_sequence") {
    return "stop";
  }
  consoleWarn(
    `Received an unknown stop reason from Anthropic: ${stopReason}. Returning "unknown".`
  );
  return "unknown";
};

export const convertToolParams = (
  toolChoice: CompletionParams["tool_choice"],
  tools: CompletionParams["tools"]
): {
  toolChoice: MessageCreateParamsNonStreaming["tool_choice"];
  tools: MessageCreateParamsNonStreaming["tools"];
} => {
  let newToolChoice: MessageCreateParamsNonStreaming["tool_choice"];

  if (toolChoice === "auto") {
    newToolChoice = { type: "auto" };
  } else if (toolChoice === "required") {
    // Anthropic doesn't have a direct "required" for *any* tool.
    // It can require a *specific* tool via { type: "tool", name: "..." }
    // or allow any via { type: "any" }.
    // Token.js mapped "required" to "any". Let's maintain that for now.
    newToolChoice = { type: "any" };
    consoleWarn(
      'OpenAI tool_choice "required" is mapped to Anthropic\'s { type: "any" }.'
    );
  } else if (toolChoice === "none") {
    // Anthropic has no direct "none" for tool_choice.
    // The behavior is to not provide tools, or not provide a tool_choice.
    // Let's try omitting it, or if tools are present, Anthropic might pick one.
    // This needs careful testing. For now, undefined.
    newToolChoice = undefined;
    consoleWarn(
      'OpenAI tool_choice "none" is mapped to Anthropic\'s undefined tool_choice.'
    );
  } else if (typeof toolChoice === "object" && toolChoice.type === "function") {
    // OpenAI's specific function choice
    newToolChoice = {
      type: "tool",
      name: toolChoice.function.name,
    };
  } else {
    // Covers if toolChoice is undefined
    newToolChoice = undefined;
  }

  const newTools = tools?.map((tool) => {
    return {
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters as any, // Anthropic expects an object, not a JSONSchema definition
    };
  });

  return {
    toolChoice: newToolChoice,
    tools: newTools,
  };
};

const toFinishReasonStreaming = (
  stopReason: Message["stop_reason"]
): CompletionResponseChunk["choices"][0]["finish_reason"] => {
  if (stopReason === "end_turn" || stopReason === "stop_sequence") {
    return "stop";
  }
  if (stopReason === "tool_use") {
    return "tool_calls";
  }
  if (stopReason === "max_tokens") {
    return "length";
  }
  return "unknown";
};

export const getDefaultMaxTokens = (model: string): number => {
  // https://docs.anthropic.com/claude/reference/selecting-a-model
  // https://docs.anthropic.com/claude/docs/models-overview#model-comparison
  if (
    model.includes("claude-3-opus") ||
    model.includes("claude-3-sonnet") ||
    model.includes("claude-3-haiku") || // Added haiku for claude 3 family
    model.includes("claude-3-5") || // Added 3.5 sonnet
    model.includes("claude-2.1") ||
    model.includes("claude-2.0") ||
    model.includes("claude-instant-1.2")
  ) {
    return 4096;
  }
  consoleWarn(
    `Received an unknown Anthropic model: ${model}. Using a default max_tokens value of 4096.`
  );
  return 4096;
};

export const convertMessages = async (
  messages: CompletionParams["messages"]
): Promise<{
  messages: MessageCreateParamsNonStreaming["messages"];
  systemMessage: string | undefined;
}> => {
  let systemMessage: string | undefined;
  const newMessages: MessageCreateParamsNonStreaming["messages"] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "system") {
      if (systemMessage === undefined && i > 0) {
        // Allow system message to be anywhere if not already defined as first for flexibility, but warn.
        // Strict OpenAI compatibility would throw an error here.
        // consoleWarn("System message received out of order. Anthropic prefers it first.");
      }
      const sysContent = convertMessageContentToString(message.content);
      if (sysContent === null) {
        throw new InputError("System message content cannot be null.");
      }
      if (systemMessage !== undefined && sysContent !== systemMessage) {
        // If multiple system messages, concatenate or throw, Anthropic only takes one.
        // For now, let's assume last one wins or concatenate if that's desired.
        // throw new InputError("Multiple differing system messages found.");
        systemMessage = `${systemMessage}\n${sysContent}`; // Concatenate if multiple
      } else {
        systemMessage = sysContent;
      }
      continue;
    }

    // Process user, assistant, tool messages
    if (message.role === "user" || message.role === "assistant") {
      const currentMessage = message; // narrowed type for user/assistant
      let newContentBlocks: (TextBlockParam | ImageBlockParam)[];
      if (typeof currentMessage.content === "string") {
        newContentBlocks = [{ type: "text", text: currentMessage.content }];
      } else if (
        currentMessage.content === null ||
        currentMessage.content === undefined
      ) {
        // Assistant content can be null
        newContentBlocks =
          currentMessage.role === "assistant" && currentMessage.tool_calls
            ? []
            : [{ type: "text", text: "" }];
      } else {
        // User message content is Array<ChatCompletionContentPart>
        // Assistant message content can also be Array but structure is different in SDK vs API?
        // For simplicity, assuming currentMessage.content is Array<ChatCompletionContentPart> for user
        newContentBlocks = await Promise.all(
          (
            currentMessage.content as OpenAI.Chat.Completions.ChatCompletionContentPart[]
          ).map(async (part) => {
            if (part.type === "text") {
              return { type: "text", text: part.text } as TextBlockParam;
            }
            if (part.type === "image_url") {
              if (!part.image_url.url) {
                throw new InputError("Image URL is missing.");
              }
              const { content: imageContent, mimeType } =
                await fetchThenParseImage(part.image_url.url);
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: imageContent,
                },
              } as ImageBlockParam;
            }
            throw new InputError(
              `Unsupported content part type: ${(part as any).type}`
            );
          })
        );
      }

      const newMessage: Anthropic.Messages.MessageParam = {
        role: currentMessage.role,
        content: newContentBlocks as any,
      };

      if (currentMessage.role === "assistant" && currentMessage.tool_calls) {
        const toolUseContent: ToolUseBlockParam[] =
          currentMessage.tool_calls.map((toolCall) => {
            return {
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.function.name,
              input: JSON.parse(toolCall.function.arguments),
            };
          });
        // Anthropic combines text and tool_use in the same content array for assistant messages
        (
          newMessage.content as (
            | TextBlockParam
            | ImageBlockParam
            | ToolUseBlockParam
          )[]
        ).push(...toolUseContent);
      }
      newMessages.push(newMessage as any);
    } else if (message.role === "tool") {
      const toolMessage = message; // narrowed type for tool message
      if (!toolMessage.tool_call_id) {
        throw new InputError("Tool message must have a tool_call_id.");
      }
      if (typeof toolMessage.content !== "string") {
        // This should not happen based on OpenAICompletionToolMessageParam which has content: string
        consoleWarn(
          "Tool message content was not a string, defaulting to empty string."
        );
        // throw new InputError("Tool message content must be a string.");
      }
      const toolResultContent: ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: toolMessage.tool_call_id,
        content:
          typeof toolMessage.content === "string" ? toolMessage.content : "",
      };
      newMessages.push({ role: "user", content: [toolResultContent] });
    }
  }
  return { messages: newMessages, systemMessage };
};

export const convertStopSequences = (
  stop?: CompletionParams["stop"]
): string[] | undefined => {
  if (stop === undefined || stop === null) {
    return undefined;
  }
  if (typeof stop === "string") {
    return [stop];
  }
  return stop;
};

const getApiKey = (apiKey?: string): string | undefined => {
  return apiKey ?? process.env.ANTHROPIC_API_KEY;
};

export class AnthropicHandler extends BaseHandler<Anthropic> {
  validateInputs(body: ProviderCompletionParams<"anthropic">): void {
    super.validateInputs(body);

    if (body.response_format?.type === "json_object") {
      consoleWarn(
        "Anthropic does not directly support 'json_object' response format. You should include instructions for JSON output in your prompt."
      );
    }
    if (body.n !== undefined && body.n !== null && body.n > 1) {
      throw new InputError(
        "Anthropic does not support 'n' (multiple choices) > 1."
      );
    }
    if ((body as CompletionParams).seed !== undefined) {
      consoleWarn("Anthropic does not support the 'seed' parameter.");
    }
    // logprobs and top_logprobs are not on ProviderCompletionParams from types.ts
    // if (body.logprobs || body.top_logprobs) {
    //     consoleWarn("Anthropic does not support 'logprobs' or 'top_logprobs'.");
    // }
  }

  async create(
    body: ProviderCompletionParams<"anthropic">
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body);

    const apiKey = getApiKey(this.opts.apiKey);
    const anthropic = new Anthropic({ ...this.opts, apiKey });

    const { messages, systemMessage } = await convertMessages(body.messages);
    const { toolChoice, tools } = convertToolParams(
      body.tool_choice,
      body.tools
    );

    const params:
      | MessageCreateParamsNonStreaming
      | MessageCreateParamsStreaming = {
      model: body.model,
      messages: messages,
      system: systemMessage,
      max_tokens: body.max_tokens ?? getDefaultMaxTokens(body.model),
      stream: body.stream ?? false,
      temperature: body.temperature === null ? undefined : body.temperature, // Handle null
      top_p: body.top_p === null ? undefined : body.top_p, // Handle null
      top_k: undefined, // Anthropic uses top_k, OpenAI uses top_p. Mapping needed if top_k is desired.
      stop_sequences: convertStopSequences(body.stop),
      tool_choice: toolChoice,
      tools: tools,
    };

    const { provider, ...restParams } = params as any; // remove provider if present

    if (params.stream) {
      const stream = await anthropic.messages.stream(
        restParams as MessageCreateParamsStreaming
      );
      return createCompletionResponseStreaming(stream, getTimestamp());
    }
    const response = await anthropic.messages.create(
      restParams as MessageCreateParamsNonStreaming
    );
    return createCompletionResponseNonStreaming(
      response,
      getTimestamp(),
      body.tool_choice
    );
  }
}
