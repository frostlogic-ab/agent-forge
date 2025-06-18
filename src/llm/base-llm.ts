import { EventEmitter } from "../utils/event-emitter";
import { AgentForgeEvents } from "../types";

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

export interface ILLMProvider {
  complete(params: any): Promise<LLMResponse>;
  chat(params: any): Promise<LLMResponse>;
  chatStream(params: any): Promise<LLMResponse>;
}

export abstract class BaseLLM implements ILLMProvider {
  protected eventEmitter: EventEmitter;

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  abstract complete(params: any): Promise<LLMResponse>;
  abstract chat(params: any): Promise<LLMResponse>;
  abstract chatStream(params: any): Promise<LLMResponse>;

  protected emitStreamChunk(model: string, agentName: string, chunk: string | undefined) {
    this.eventEmitter.emit(AgentForgeEvents.LLM_STREAM_CHUNK, {
      model,
      agentName,
      chunk,
    });
  }

  protected emitStreamComplete(content: string, agentName: string) {
    this.eventEmitter.emit(AgentForgeEvents.LLM_STREAM_COMPLETE, {
      content,
      isComplete: true,
      agentName,
    });
  }
}


