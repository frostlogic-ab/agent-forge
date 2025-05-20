import { CohereClient } from "cohere-ai"; // Assuming cohere-ai is a project dependency
import type {
  StreamedChatResponse,
  // Specific Cohere response types used by the handler
} from "cohere-ai/api";
import type { Stream } from "cohere-ai/core"; // Assuming cohere-ai is a project dependency
import { nanoid } from "nanoid";

import type {
  ChatCompletionMessageToolCall,
  // ChatCompletionAssistantMessageParam, // Used in utils
  // ChatCompletionToolMessageParam, // Used in utils
} from "openai/resources/index"; // May need to map from ../types if not direct OpenAI types

import type {
  CohereModel,
  CompletionParams, // Used by utils
  CompletionResponse,
  ProviderCompletionParams,
  StreamCompletionResponse,
  // ChatCompletionTool, // Used by utils
} from "../types";
import { BaseHandler } from "./base";
import { InputError, InvariantError } from "./base"; // MessageRole used by utils
import {
  consoleWarn,
  getTimestamp,
  // convertMessageContentToString, // Used by utils
} from "./bedrock_utils"; // Re-use shared utils if applicable

import {
  convertFinishReason,
  convertMessages,
  convertRole, // Placeholder, will be from ./cohere_utils
  convertStopSequences,
  convertTools,
  getUsageTokens,
  popLastToolMessageParams,
  popLastUserMessageContentString,
  toCohereTool,
  toToolResult,
} from "./cohere_utils";

// Placeholder for StreamedChatResponse if not fully imported or defined
// We'll need this for createCompletionResponseStreaming
interface CohereStreamEvent {
  eventType: string;
  generationId?: string;
  finishReason?: any; // Cohere's FinishReason
  text?: string;
  toolCallDelta?: {
    index?: number;
    name?: string;
    parameters?: string;
    text?: string;
  };
  // Add other event-specific fields if necessary
}

async function* createCompletionResponseStreaming(
  response: Stream<StreamedChatResponse>, // Use Cohere's Stream type
  model: CohereModel,
  created: number
): StreamCompletionResponse {
  let id: string | undefined;
  const toolCallIdMap: Map<number, string> = new Map();

  for await (const chunk of response) {
    // Casting chunk to 'any' or a more specific local type if Cohere's types are too broad/problematic
    const currentChunk = chunk as any as CohereStreamEvent;

    if (currentChunk.eventType === "stream-start") {
      id = currentChunk.generationId;
      yield {
        choices: [
          {
            index: 0,
            finish_reason: null,
            logprobs: null,
            delta: {
              role: "assistant",
            },
          },
        ],
        created,
        model,
        id: currentChunk.generationId ?? null,
        object: "chat.completion.chunk",
      };
    }

    if (id === undefined) {
      throw new InvariantError("The generated ID is undefined.");
    }

    if (currentChunk.eventType === "stream-end") {
      yield {
        choices: [
          {
            index: 0,
            finish_reason: convertFinishReason(currentChunk.finishReason),
            logprobs: null,
            delta: {},
          },
        ],
        created,
        model,
        id,
        object: "chat.completion.chunk",
      };
    } else if (
      currentChunk.eventType === "text-generation" ||
      (currentChunk.eventType === "tool-calls-chunk" &&
        typeof currentChunk.text === "string")
    ) {
      const text = currentChunk.text;
      yield {
        choices: [
          {
            index: 0,
            finish_reason: null,
            logprobs: null,
            delta: {
              content: text,
            },
          },
        ],
        created,
        model,
        id,
        object: "chat.completion.chunk",
      };
    } else if (currentChunk.eventType === "tool-calls-chunk") {
      const index = currentChunk.toolCallDelta?.index;
      if (typeof index !== "number") {
        throw new InvariantError("Content block index is undefined.");
      }

      let toolCallId = toolCallIdMap.get(index);
      if (toolCallId === undefined) {
        toolCallId = nanoid();
        toolCallIdMap.set(index, toolCallId);
      }

      yield {
        choices: [
          {
            index: 0,
            finish_reason: null,
            logprobs: null,
            delta: {
              content: currentChunk.toolCallDelta?.text,
              tool_calls: [
                {
                  index,
                  id: toolCallId,
                  type: "function",
                  function: {
                    name: currentChunk.toolCallDelta?.name,
                    arguments: currentChunk.toolCallDelta?.parameters,
                  },
                },
              ],
            },
          },
        ],
        created,
        model,
        id,
        object: "chat.completion.chunk",
      };
    }
  }
}

export class CohereHandler extends BaseHandler<CohereClient> {
  async create(
    body: ProviderCompletionParams<"cohere">
  ): Promise<CompletionResponse | StreamCompletionResponse> {
    this.validateInputs(body);

    if (this.opts.baseURL) {
      consoleWarn(
        `The 'baseUrl' will be ignored by Cohere because it does not support this field.`
      );
    }

    const apiKey = this.opts.apiKey ?? process.env.COHERE_API_KEY;
    if (apiKey === undefined) {
      throw new InputError(
        "No Cohere API key detected. Please define an 'COHERE_API_KEY' environment variable or supply the API key using the 'apiKey' parameter."
      );
    }

    const maxTokens = body.max_tokens ?? undefined;
    const p = body.top_p ?? undefined;
    const stopSequences = convertStopSequences(body.stop);
    const temperature =
      typeof body.temperature === "number"
        ? body.temperature / 2 // Cohere temp is 0-1, input is 0-2
        : undefined;
    const tools = convertTools(body.tools, body.tool_choice);

    const { messages, lastUserMessage, toolResults } = convertMessages(
      body.messages
    );

    const input = {
      maxTokens,
      message: lastUserMessage,
      chatHistory: messages,
      model: body.model,
      stopSequences,
      temperature,
      p,
      toolResults,
      tools,
    } as any; // Cast to any to match CohereClient input if types are not perfectly aligned yet

    const cohere = new CohereClient({
      token: apiKey,
    });

    if (body.stream === true) {
      const created = getTimestamp();
      // Assuming cohere.chatStream returns a type compatible with Stream<StreamedChatResponse>
      const response = await cohere.chatStream(input);
      return createCompletionResponseStreaming(response, body.model, created);
    }
    const created = getTimestamp();
    const response = await cohere.chat(input);

    const toolCalls: ChatCompletionMessageToolCall[] | undefined =
      response.toolCalls?.map((toolCall: any) => {
        // toolCall from Cohere
        return {
          type: "function",
          id: nanoid(), // Cohere doesn't provide tool call IDs in non-streaming
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.parameters),
          },
        };
      });

    const usage = getUsageTokens(response.meta?.billedUnits);
    const convertedResponse: CompletionResponse = {
      object: "chat.completion",
      choices: [
        {
          finish_reason: convertFinishReason(response.finishReason),
          index: 0,
          logprobs: null,
          message: {
            role: "assistant",
            refusal: null,
            content: response.text,
            tool_calls: toolCalls,
          },
        },
      ],
      created,
      id: response.generationId ?? null,
      model: body.model,
      usage,
    };

    return convertedResponse;
  }
}
