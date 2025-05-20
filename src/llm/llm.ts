import { AgentForgeEvents } from "../types";
import { EventEmitter } from "../utils/event-emitter";
import {
  LLMClient,
  type LLMClientCompletionInput,
  type LLMClientConfig,
  type SupportedLLMProvider,
} from "./client";
import type {
  ChatCompletionMessageParam,
  CompletionResponse,
  CompletionResponseChunk,
  // ConfigOptions as OldConfigOptions, // Replaced by LLMClientConfig
  // LLMProvider as OldLLMProvider, // Replaced by SupportedLLMProvider
} from "./types"; // Assuming these are now sourced from our own types.ts

export interface LLMResponseToolCall {
  id: string;
  toolName: string;
  parameters: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokenUsage?: {
    completion: number;
    prompt: number;
    total: number;
  };
  toolCalls?: LLMResponseToolCall[];
}

// Define a type for the parameters of complete/chat methods,
// excluding stream, as that's handled by the method choice.
// It will be based on LLMClientCompletionInput.
type LLMBaseMethodParams = Omit<
  LLMClientCompletionInput,
  "stream" | "stream_options"
>;

export class LLM {
  protected readonly llmClient: LLMClient;
  protected eventEmitter: EventEmitter;
  // Store the provider for potential direct use if needed, though LLMClient handles it.
  protected readonly provider: SupportedLLMProvider;

  constructor(
    provider: SupportedLLMProvider,
    // The config here needs to be mapped to LLMClientConfig
    // Assuming oldConfig contained apiKey, baseURL, and potentially bedrock specific parts
    oldConfig: {
      apiKey?: string;
      baseURL?: string;
      bedrock?: {
        region?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
      };
    }
  ) {
    this.provider = provider; // Store the provider

    // Construct LLMClientConfig from oldConfig
    const clientConfig: LLMClientConfig = {
      provider: provider,
      apiKey: oldConfig.apiKey,
      baseURL: oldConfig.baseURL,
      awsRegion: oldConfig.bedrock?.region,
      awsAccessKeyId: oldConfig.bedrock?.accessKeyId,
      awsSecretAccessKey: oldConfig.bedrock?.secretAccessKey,
    };

    this.llmClient = new LLMClient(clientConfig);
    this.eventEmitter = new EventEmitter();
  }

  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  transformCompletionToLLMResponse(
    completion: CompletionResponse // This type should come from ./types
  ): LLMResponse {
    if (!completion?.choices?.length) {
      throw new Error("Invalid LLM response");
    }

    const choice = completion.choices[0];

    const usage = completion.usage
      ? {
          completion: completion.usage.completion_tokens,
          prompt: completion.usage.prompt_tokens,
          total: completion.usage.total_tokens,
        }
      : undefined;

    return {
      content: choice.message.content ?? "",
      model: completion.model,
      tokenUsage: usage,
      toolCalls: choice.message.tool_calls?.map((toolCall) => {
        return {
          id: toolCall.id,
          toolName: toolCall.function.name,
          parameters: JSON.parse(toolCall.function.arguments),
        };
      }),
    };
  }

  transformCompletionChunksToLLMResponse(
    chunks: CompletionResponseChunk[] // This type should come from ./types
  ): LLMResponse {
    const toolCalls: {
      [key: string]: {
        id: string;
        toolName: string;
        parameters: string | undefined;
      };
    } = {};

    let content = "";

    for (const chunk of chunks) {
      const delta = chunk.choices?.[0]?.delta;

      if (!delta) {
        continue;
      }

      if (delta.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          // Ensure toolCall.index is used if available, otherwise manage via id if index isn't in delta
          const callIndex = (toolCall as any).index ?? toolCall.id; // Adapt if index is not always present
          if (toolCall.id && toolCall.function?.name) {
            if (!toolCalls[callIndex]) {
              toolCalls[callIndex] = {
                id: toolCall.id,
                toolName: toolCall.function.name,
                parameters: toolCall.function.arguments,
              };
            } else if (toolCall.function.arguments) {
              if (toolCalls[callIndex].parameters) {
                toolCalls[callIndex].parameters += toolCall.function.arguments;
              } else {
                toolCalls[callIndex].parameters = toolCall.function.arguments;
              }
            }
          }
        }
      }
      if (delta.content) {
        content += delta.content;
      }
    }

    const lastChunk = chunks[chunks.length - 1];
    const usage = lastChunk.usage
      ? {
          completion: lastChunk.usage.completion_tokens,
          prompt: lastChunk.usage.prompt_tokens,
          total: lastChunk.usage.total_tokens,
        }
      : undefined;

    return {
      content,
      model: lastChunk.model,
      tokenUsage: usage,
      toolCalls: Object.values(toolCalls).map((toolCall) => ({
        ...toolCall,
        parameters: toolCall.parameters ? JSON.parse(toolCall.parameters) : {},
      })),
    };
  }

  protected validateMessages(
    messages: ChatCompletionMessageParam[] | undefined // This type from ./types
  ): ChatCompletionMessageParam[] {
    if (!messages) return [];

    return messages.map((message) => {
      if (message.content === null || message.content === undefined) {
        return {
          ...message,
          content: "No content provided", // Or handle as an error, depending on policy
        };
      }
      return message;
    });
  }

  async complete(params: LLMBaseMethodParams): Promise<LLMResponse> {
    const completion = (await this.llmClient.create({
      ...params,
      stream: false,
    })) as CompletionResponse; // Cast because we set stream: false

    return this.transformCompletionToLLMResponse(completion);
  }

  async chat(params: LLMBaseMethodParams): Promise<LLMResponse> {
    params.messages = this.validateMessages(params.messages);

    const completion = (await this.llmClient.create({
      ...params,
      stream: false,
    })) as CompletionResponse; // Cast because we set stream: false

    return this.transformCompletionToLLMResponse(completion);
  }

  async chatStream(
    params: LLMBaseMethodParams & {
      onChunk: (chunk: CompletionResponseChunk) => void;
      stream_options?: { include_usage?: boolean }; // Keep stream_options specific to chatStream
    }
  ): Promise<LLMResponse> {
    params.messages = this.validateMessages(params.messages);

    const { onChunk, stream_options, ...llmClientParams } = params;

    const stream = (await this.llmClient.create({
      ...llmClientParams,
      stream: true,
      stream_options: stream_options,
    })) as AsyncGenerator<CompletionResponseChunk>; // Cast because stream: true

    const chunks: CompletionResponseChunk[] = [];
    let modelFromStream: string | undefined = undefined;
    let usageFromStream: CompletionResponseChunk["usage"] = undefined;

    for await (const chunk of stream) {
      this.eventEmitter.emit(AgentForgeEvents.LLM_STREAM_CHUNK, {
        model: params.model, // model is part of LLMBaseMethodParams
        agentName: "Unknown", // This could be passed in or configured
        chunk: chunk.choices?.[0]?.delta?.content,
      });
      onChunk(chunk);
      chunks.push(chunk);
      if (chunk.model) modelFromStream = chunk.model;
      if (chunk.usage) usageFromStream = chunk.usage; // Capture last known usage
    }

    if (chunks.length === 0) {
      // If the stream was truly empty (no chunks at all)
      // Return a minimal response, possibly indicating an issue or an empty generation.
      // Fallback to the requested model if not found in any chunk.
      return {
        content: "",
        model: modelFromStream ?? params.model,
        tokenUsage: usageFromStream
          ? {
              completion: usageFromStream.completion_tokens,
              prompt: usageFromStream.prompt_tokens,
              total: usageFromStream.total_tokens,
            }
          : undefined,
        toolCalls: [],
      };
    }
    return this.transformCompletionChunksToLLMResponse(chunks);
  }
}
