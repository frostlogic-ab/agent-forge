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
 * Provider for Anthropic Claude LLMs
 */
export class AnthropicProvider extends LLMProvider {
  private client: AxiosInstance;
  private readonly DEFAULT_API_URL = "https://api.anthropic.com";
  private readonly SUPPORTED_MODELS = [
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
    "claude-2.1",
    "claude-2.0",
    "claude-instant-1.2",
  ];

  /**
   * Creates a new Anthropic provider
   * @param config Configuration for the provider
   */
  constructor(config: LLMProviderConfig) {
    super(config);

    this.client = axios.create({
      baseURL: config.baseUrl || this.DEFAULT_API_URL,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      timeout: config.timeout || 30000,
    });
  }

  /**
   * Completes a prompt using Anthropic's API
   * Not directly supported by Anthropic, so we convert to chat format
   * @param options Request options
   * @returns A promise that resolves to an LLM response
   */
  async complete(options: LLMRequestOptions): Promise<LLMResponse> {
    // Convert to chat format since Anthropic doesn't support completions
    const chatOptions: LLMRequestOptions = {
      ...options,
      messages: [
        {
          role: "user",
          content: options.messages.map((m) => m.content).join("\n"),
        },
      ],
    };

    return this.chat(chatOptions);
  }

  /**
   * Creates a chat completion using Anthropic's Messages API
   * @param options Request options
   * @returns A promise that resolves to an LLM response
   */
  async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    try {
      // Format the messages for Anthropic's API
      const formattedMessages = this.formatMessages(options.messages);

      // Prepare the API request payload
      const payload: any = {
        model: options.model,
        messages: formattedMessages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        ...(options.stopSequences
          ? { stop_sequences: options.stopSequences }
          : {}),
      };

      // Add tool definitions if provided
      if (options.toolDefinitions && options.toolDefinitions.length > 0) {
        payload.tools = this.convertToolsToAnthropicFormat(
          options.toolDefinitions
        );
      }

      const response = await this.client.post("/v1/messages", payload);
      const data = response.data;

      // Process tool calls if they exist
      const toolCalls: ToolCall[] = [];
      if (data.content && data.content.length > 0) {
        for (const content of data.content) {
          if (content.type === "tool_use") {
            toolCalls.push({
              toolName: content.name,
              parameters: content.input || {},
              result: null, // Results are filled in later when tools are executed
              timestamp: Date.now(),
            });
          }
        }
      }

      // Extract text content
      let textContent = "";
      if (data.content && data.content.length > 0) {
        for (const content of data.content) {
          if (content.type === "text") {
            textContent += content.text;
          }
        }
      }

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokenUsage: {
          prompt: data.usage?.input_tokens || 0,
          completion: data.usage?.output_tokens || 0,
          total:
            (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
        model: options.model,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Anthropic API error: ${
            error.response?.data?.error?.message || error.message
          }`
        );
      }
      throw error;
    }
  }

  /**
   * Gets the available models from Anthropic
   * @returns A promise that resolves to a list of model IDs
   */
  async getAvailableModels(): Promise<string[]> {
    // Anthropic doesn't have a models endpoint, so we return the supported models
    return [...this.SUPPORTED_MODELS];
  }

  /**
   * Validates if a model ID is supported by Anthropic
   * @param modelId The model ID to validate
   * @returns True if the model is supported, false otherwise
   */
  async supportsModel(modelId: string): Promise<boolean> {
    return this.SUPPORTED_MODELS.includes(modelId);
  }

  /**
   * Formats messages to match Anthropic's expected format
   * @param messages The messages to format
   * @returns Formatted messages for Anthropic's API
   */
  private formatMessages(messages: any[]): any[] {
    const formattedMessages = [];

    for (const message of messages) {
      // Map roles from our standard format to Anthropic's format
      let role: string;
      switch (message.role) {
        case "user":
          role = "user";
          break;
        case "assistant":
          role = "assistant";
          break;
        case "system":
          // System message is handled differently in Anthropic
          continue;
        case "tool":
          // We'll handle tool responses differently
          continue;
        default:
          role = "user";
      }

      formattedMessages.push({
        role,
        content: message.content,
      });
    }

    return formattedMessages;
  }

  /**
   * Converts tool configurations to Anthropic's expected format
   * @param tools The tool configurations to convert
   * @returns Tools in Anthropic's format
   */
  private convertToolsToAnthropicFormat(tools: ToolConfig[]): any[] {
    return tools.map((tool) => {
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
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        },
      };
    });
  }
}
