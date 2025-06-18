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


