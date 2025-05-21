import {
  type ChatCompletionMessageParam,
  type CompletionResponse,
  type CompletionResponseChunk,
  type ConfigOptions,
  TokenJS,
} from "token.js";
import type {
  CompletionNonStreaming,
  CompletionStreaming,
  LLMProvider,
  ProviderCompletionParams,
} from "token.js/dist/chat";
import { AgentForgeEvents } from "../types";
import { EventEmitter } from "../utils/event-emitter";

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

export class LLM {
  protected readonly token: TokenJS;
  protected eventEmitter: EventEmitter;

  constructor(
    protected readonly provider: LLMProvider,
    protected readonly config: ConfigOptions
  ) {
    this.token = new TokenJS(this.config);
    this.eventEmitter = new EventEmitter();
  }

  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  transformCompletionToLLMResponse(
    completion: CompletionResponse
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
    chunks: CompletionResponseChunk[]
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
          if (toolCall.id && toolCall.function?.name) {
            if (!toolCalls[toolCall.index]) {
              toolCalls[toolCall.index] = {
                id: toolCall.id,
                toolName: toolCall.function.name,
                parameters: toolCall.function.arguments,
              };
            }
          } else if (toolCall.function?.arguments) {
            if (toolCalls[toolCall.index].parameters) {
              toolCalls[toolCall.index].parameters =
                toolCalls[toolCall.index].parameters +
                toolCall.function.arguments;
            } else {
              toolCalls[toolCall.index].parameters =
                toolCall.function.arguments;
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
    messages: ChatCompletionMessageParam[] | undefined
  ): ChatCompletionMessageParam[] {
    if (!messages) return [];

    return messages.map((message) => {
      // If content is empty or undefined, provide a placeholder
      if (!message.content) {
        return {
          ...message,
          content:
            message.content === ""
              ? "Empty message"
              : message.content || "No content provided",
        };
      }
      return message;
    });
  }

  async complete(
    params: Omit<ProviderCompletionParams<any>, "provider" | "stream">
  ): Promise<LLMResponse> {
    const completion = await this.token.chat.completions.create({
      ...params,
      provider: this.provider,
      stream: false,
    });

    return this.transformCompletionToLLMResponse(completion);
  }

  async chat(
    params: Omit<CompletionNonStreaming<any>, "provider" | "stream">
  ): Promise<LLMResponse> {
    params.messages = this.validateMessages(params.messages);

    const completion = await this.token.chat.completions.create({
      ...params,
      provider: this.provider,
      stream: false,
    });

    return this.transformCompletionToLLMResponse(completion);
  }

  async chatStream(
    params: Omit<CompletionStreaming<any>, "provider" | "stream"> & {
      onChunk: (chunk: CompletionResponseChunk) => void;
    }
  ): Promise<LLMResponse> {
    params.messages = this.validateMessages(params.messages);

    const completion = await this.token.chat.completions.create({
      ...params,
      provider: this.provider,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    } as CompletionStreaming<any>);

    const chunks: CompletionResponseChunk[] = [];

    for await (const chunk of completion) {
      this.eventEmitter.emit(AgentForgeEvents.LLM_STREAM_CHUNK, {
        model: params.model,
        agentName: "Unknown",
        chunk: chunk.choices?.[0]?.delta?.content,
      });
      params.onChunk(chunk);
      chunks.push(chunk);
    }

    if (chunks.length === 0) {
      throw new Error("Invalid response from LLM");
    }

    const response = this.transformCompletionChunksToLLMResponse(chunks);

    this.eventEmitter.emit(AgentForgeEvents.LLM_STREAM_COMPLETE, {
      content: response.content,
      isComplete: true,
      agentName: "Unknown",
    });

    return response;
  }
}
