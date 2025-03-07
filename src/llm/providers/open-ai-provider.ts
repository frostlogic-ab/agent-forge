import axios, { type AxiosInstance } from "axios";
import type {
  LLMProviderConfig,
  LLMRequestOptions,
  LLMResponse,
  ToolCall,
  ToolConfig,
} from "../../types";
import { LLMProvider } from "../llm-provider";

/**
 * Provider for OpenAI LLMs
 */
export class OpenAIProvider extends LLMProvider {
  private client: AxiosInstance;
  private readonly DEFAULT_API_URL = "https://api.openai.com/v1";

  /**
   * Creates a new OpenAI provider
   * @param config Configuration for the provider
   */
  constructor(config: LLMProviderConfig) {
    super(config);

    this.client = axios.create({
      baseURL: config.baseUrl || this.DEFAULT_API_URL,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(config.organizationId
          ? { "OpenAI-Organization": config.organizationId }
          : {}),
      },
      timeout: config.timeout || 30000,
    });
  }

  /**
   * Completes a prompt using OpenAI's completion API
   * @param options Request options
   * @returns A promise that resolves to an LLM response
   */
  async complete(options: LLMRequestOptions): Promise<LLMResponse> {
    const prompt = options.messages.map((m) => m.content).join("\n");

    try {
      const response = await this.client.post("/completions", {
        model: options.model,
        prompt,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1024,
        ...(options.stopSequences ? { stop: options.stopSequences } : {}),
      });

      const data = response.data;

      return {
        content: data.choices[0].text.trim(),
        tokenUsage: {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
          total: data.usage.total_tokens,
        },
        model: options.model,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `OpenAI API error: ${
            error.response?.data?.error?.message || error.message
          }`
        );
      }
      throw error;
    }
  }

  /**
   * Creates a chat completion using OpenAI's chat API
   * @param options Request options
   * @returns A promise that resolves to an LLM response
   */
  async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    try {
      const payload: any = {
        model: options.model,
        messages: options.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.name ? { name: m.name } : {}),
        })),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1024,
        ...(options.stopSequences ? { stop: options.stopSequences } : {}),
      };

      // If tool definitions are provided, convert them to OpenAI's function format
      if (options.toolDefinitions && options.toolDefinitions.length > 0) {
        payload.tools = options.toolDefinitions.map((tool) =>
          this.convertToolToOpenAIFunction(tool)
        );
        payload.tool_choice = "auto";
      }

      const response = await this.client.post("/chat/completions", payload);
      const data = response.data;
      const choice = data.choices[0];

      // Process tool calls if they exist
      const toolCalls: ToolCall[] = [];
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        for (const toolCall of choice.message.tool_calls) {
          try {
            const parsedArgs = JSON.parse(toolCall.function.arguments);
            toolCalls.push({
              toolName: toolCall.function.name,
              parameters: parsedArgs,
              result: null, // Results are filled in later when tools are executed
              timestamp: Date.now(),
            });
          } catch (e) {
            console.error(`Failed to parse tool call arguments: ${e}`);
          }
        }
      }

      return {
        content: choice.message.content || "",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokenUsage: {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
          total: data.usage.total_tokens,
        },
        model: options.model,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `OpenAI API error: ${
            error.response?.data?.error?.message || error.message
          }`
        );
      }
      throw error;
    }
  }

  /**
   * Gets available models from OpenAI
   * @returns A promise that resolves to a list of model IDs
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.client.get("/models");
      return response.data.data.map((model: any) => model.id);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `OpenAI API error: ${
            error.response?.data?.error?.message || error.message
          }`
        );
      }
      throw error;
    }
  }

  /**
   * Checks if a model is supported by OpenAI
   * @param modelId The model ID to check
   * @returns True if the model is supported, false otherwise
   */
  async supportsModel(modelId: string): Promise<boolean> {
    try {
      const models = await this.getAvailableModels();
      return models.includes(modelId);
    } catch {
      return false;
    }
  }

  /**
   * Converts a tool configuration to OpenAI's function format
   * @param tool The tool configuration
   * @returns The OpenAI function definition
   */
  private convertToolToOpenAIFunction(tool: ToolConfig): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    if (tool.parameters) {
      for (const param of tool.parameters) {
        properties[param.name] = {
          type: param.type.toLowerCase(),
          description: param.description,
        };

        if (param.required) {
          required.push(param.name);
        }
      }
    }

    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
    };
  }
}
