import axios, { type AxiosInstance } from "axios";
import {
  AgentForgeEvents,
  type LLMProviderConfig,
  type LLMRequestOptions,
  type LLMResponse,
  type StreamingOptions,
  type ToolCall,
  type ToolConfig,
} from "../../types";
import { LLMProvider } from "../llm-provider";

/**
 * Provider for OpenAI LLMs
 */
export class OpenAIProvider extends LLMProvider {
  private client: AxiosInstance;
  private readonly DEFAULT_API_URL = "https://api.openai.com/v1";
  private apiKey?: string;

  /**
   * Creates a new OpenAI provider
   * @param config Configuration for the provider
   */
  constructor(config: LLMProviderConfig) {
    super(config);

    this.apiKey = config.apiKey;

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
   * Creates a chat completion using OpenAI's API
   */
  async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    try {
      // Prepare chat request options
      const requestOptions = this.prepareChatRequestOptions(options);

      // Make the API call
      const response = await this.client.post(
        "/chat/completions",
        requestOptions
      );

      // Process and return the response
      return this.processChatResponse(response.data, options.model);
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
   * Prepares request options for chat completion
   */
  private prepareChatRequestOptions(options: LLMRequestOptions): any {
    // Convert messages to OpenAI format
    const messages = this.formatMessagesForProvider(options.messages);

    // Prepare tools if defined
    const tools = this.formatToolsForProvider(options.toolDefinitions);

    // Build the request payload
    return {
      model: options.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      tools: tools && tools.length > 0 ? tools : undefined,
    };
  }

  /**
   * Processes the chat completion response
   */
  private processChatResponse(responseData: any, model: string): LLMResponse {
    const content = responseData.choices[0]?.message?.content || "";

    // Extract and format tool calls if present
    const toolCalls = this.extractToolCallsFromResponse(responseData);

    // Calculate token usage
    const tokenUsage = {
      prompt: responseData.usage?.prompt_tokens || 0,
      completion: responseData.usage?.completion_tokens || 0,
      total: responseData.usage?.total_tokens || 0,
    };

    return {
      content,
      toolCalls,
      tokenUsage,
      model,
    };
  }

  /**
   * Extracts tool calls from the response
   */
  private extractToolCallsFromResponse(
    responseData: any
  ): ToolCall[] | undefined {
    const responseToolCalls = responseData.choices[0]?.message?.tool_calls;

    if (!responseToolCalls || responseToolCalls.length === 0) {
      return undefined;
    }

    return responseToolCalls.map((toolCall: any) => {
      let parameters: Record<string, any> = {};

      if (toolCall.function?.arguments) {
        try {
          parameters = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.error(`Error parsing tool call arguments: ${e}`);
          parameters = { _raw: toolCall.function.arguments };
        }
      }

      return {
        toolName: toolCall.function?.name || "",
        parameters,
        result: null, // Will be populated after execution
        timestamp: Date.now(),
        id: toolCall.id,
      };
    });
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

  /**
   * Creates a streaming chat completion using OpenAI's API
   */
  async chatStream(
    options: LLMRequestOptions & StreamingOptions
  ): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is required");
    }

    // Prepare the request
    const requestOptions = this.prepareStreamRequestOptions(options);

    try {
      // Make the streaming API call
      const response = await this.makeStreamingApiCall(requestOptions);

      // Process the streaming response
      return await this.processStreamingResponse(response, options);
    } catch (error) {
      throw new Error(
        `OpenAI streaming error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Prepares the request options for streaming
   */
  private prepareStreamRequestOptions(
    options: LLMRequestOptions & StreamingOptions
  ): any {
    // Convert messages to OpenAI format
    const messages = this.formatMessagesForProvider(options.messages);

    // Prepare tools if defined
    const tools = this.formatToolsForProvider(options.toolDefinitions);

    // Return the prepared options
    return {
      model: options.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      tools: tools && tools.length > 0 ? tools : undefined,
      stream: true,
    };
  }

  /**
   * Makes the streaming API call to OpenAI
   */
  private async makeStreamingApiCall(requestOptions: any): Promise<Response> {
    const response = await fetch(
      `${this.config.baseUrl || this.DEFAULT_API_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(this.config.organizationId
            ? { "OpenAI-Organization": this.config.organizationId }
            : {}),
        },
        body: JSON.stringify(requestOptions),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        `OpenAI API error: ${error.error?.message || JSON.stringify(error)}`
      );
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    return response;
  }

  /**
   * Reads and processes the stream chunks
   */
  private async readAndProcessStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    contentResult: string,
    toolCalls: any[],
    options: LLMRequestOptions & StreamingOptions
  ): Promise<{ contentResult: string; toolCalls: any[] }> {
    let updatedContent = contentResult;
    let updatedToolCalls = toolCalls;
    let buffer = ""; // Buffer to accumulate partial chunks

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode the chunk and add to buffer
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Look for complete SSE messages (data: [...]\n\n)
        const messages = buffer.split("\n\n");

        // Keep the last part if it doesn't end with \n\n (it might be incomplete)
        buffer = messages.pop() || "";

        for (const message of messages) {
          if (!message.trim()) continue;
          if (message.includes("[DONE]")) {
            // OpenAI's signal that the stream is complete
            continue;
          }

          // A single message might contain multiple data: lines when the server flushes buffers
          // Process each data: line separately
          const dataLines = message
            .split("\n")
            .filter((line) => line.startsWith("data: "));

          for (const dataLine of dataLines) {
            // Extract the JSON data
            const jsonStr = dataLine.substring(6).trim();
            if (!jsonStr) continue;

            try {
              const result = this.processStreamChunk(
                jsonStr,
                updatedContent,
                updatedToolCalls,
                options
              );
              updatedContent = result.contentResult;
              updatedToolCalls = result.toolCalls;
            } catch (error) {
              console.error("Error processing stream chunk:", error);
              // Continue processing other chunks even if one fails
            }
          }
        }
      }

      // Process any remaining data in the buffer if it contains complete data: lines
      if (buffer.trim()) {
        const dataLines = buffer
          .split("\n")
          .filter((line) => line.startsWith("data: "));

        for (const dataLine of dataLines) {
          const jsonStr = dataLine.substring(6).trim();
          if (jsonStr && !jsonStr.includes("[DONE]")) {
            try {
              const result = this.processStreamChunk(
                jsonStr,
                updatedContent,
                updatedToolCalls,
                options
              );
              updatedContent = result.contentResult;
              updatedToolCalls = result.toolCalls;
            } catch (error) {
              console.error("Error processing final stream chunk:", error);
            }
          }
        }
      }
    } catch (error) {
      console.error("Stream reading error:", error);
    }

    return { contentResult: updatedContent, toolCalls: updatedToolCalls };
  }

  /**
   * Processes the streaming response from OpenAI
   */
  private async processStreamingResponse(
    response: Response,
    options: LLMRequestOptions & StreamingOptions
  ): Promise<LLMResponse> {
    // Initialize variables to track the full response
    let contentResult = "";
    let toolCalls: any[] = [];

    // Check if body exists before using it
    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    // Process the stream
    const result = await this.readAndProcessStream(
      reader,
      decoder,
      contentResult,
      toolCalls,
      options
    );
    contentResult = result.contentResult;
    toolCalls = result.toolCalls;

    // Emit completion event
    this.eventEmitter.emit(AgentForgeEvents.LLM_STREAM_COMPLETE, {
      content: contentResult,
      isComplete: true,
      agentName: "Agent", // This will be overridden by the agent
    });

    // Return the complete response in the expected format
    const formattedToolCalls = this.formatToolCallsFromOpenAI(toolCalls);

    return {
      content: contentResult,
      toolCalls: formattedToolCalls,
      tokenUsage: {
        prompt: this.calculatePromptTokensApprox(options.messages),
        completion: this.calculateCompletionTokensApprox(contentResult),
        total: 0, // Will be calculated when properties are accessed
      },
      model: options.model,
    };
  }

  /**
   * Processes a single chunk from the stream
   * @returns Object with updated contentResult and toolCalls
   */
  private processStreamChunk(
    jsonStr: string,
    contentResult: string,
    toolCalls: any[],
    options: LLMRequestOptions & StreamingOptions
  ): { contentResult: string; toolCalls: any[] } {
    let updatedContent = contentResult;
    let updatedToolCalls = [...toolCalls];

    try {
      // Handle special case for "[DONE]" message
      if (jsonStr.includes("[DONE]")) {
        return { contentResult: updatedContent, toolCalls: updatedToolCalls };
      }

      // Only log stream chunks when verbose mode is enabled
      if ((options as any).verbose) {
        console.debug(
          `Processing stream chunk: ${jsonStr.substring(0, 100)}...`
        );
      }

      // Clean the JSON string to prevent common parsing errors
      const cleanedJsonStr = this.cleanJsonString(jsonStr);

      if (!cleanedJsonStr) {
        console.warn(
          `Stream chunk was empty after cleaning: ${jsonStr.substring(
            0,
            50
          )}...`
        );
        return { contentResult: updatedContent, toolCalls: updatedToolCalls };
      }

      let json: any;
      try {
        json = JSON.parse(cleanedJsonStr);
      } catch (error: unknown) {
        // If we still can't parse after cleaning, log the error and return current state
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(`Error parsing stream chunk: ${errorMessage}`);
        console.warn(
          `Failed JSON string: ${cleanedJsonStr.substring(0, 100)}...`
        );
        return { contentResult: updatedContent, toolCalls: updatedToolCalls };
      }

      // Skip if no choices or delta
      if (!json.choices?.[0]?.delta) {
        return { contentResult: updatedContent, toolCalls: updatedToolCalls };
      }

      const delta = json.choices[0].delta;

      // Handle content
      if (delta.content) {
        updatedContent += delta.content;

        // Emit event for the chunk
        this.eventEmitter.emit(AgentForgeEvents.LLM_STREAM_CHUNK, {
          model: options.model,
          agentName: "Unknown",
          chunk: delta.content,
        });
      } else if (delta.tool_calls) {
        // For tool calls, emit a placeholder message to indicate a tool is being called
        if (options.onChunk) {
          try {
            const toolNames = delta.tool_calls
              .filter((tc: any) => tc.function?.name)
              .map((tc: any) => tc.function.name);

            if (toolNames.length > 0) {
              options.onChunk(
                `[Using tool${
                  toolNames.length > 1 ? "s" : ""
                }: ${toolNames.join(", ")}...]`
              );
            }
          } catch (error) {
            console.warn("Error processing tool call names:", error);
          }
        }
      }

      // Handle tool calls
      if (delta.tool_calls && delta.tool_calls.length > 0) {
        try {
          // Validate tool calls before processing
          const validToolCalls = delta.tool_calls.filter((call: any) => {
            // Skip calls without an index
            if (call.index === undefined) return false;

            // For function calls, validate they have valid data
            if (call.function) {
              // Skip tool calls with empty function names (would cause API errors)
              if (call.function.name === "") return false;
            }

            return true;
          });

          if (validToolCalls.length > 0) {
            updatedToolCalls = this.accumulateToolCalls(
              updatedToolCalls,
              validToolCalls
            );

            // Try to parse arguments if they look complete
            for (const call of updatedToolCalls) {
              if (call.function?.arguments) {
                try {
                  // Only try to parse if it looks like valid JSON
                  if (
                    call.function.arguments.trim().startsWith("{") &&
                    call.function.arguments.trim().endsWith("}")
                  ) {
                    JSON.parse(call.function.arguments);
                  }
                } catch (error) {
                  console.warn(`Error parsing tool call arguments: ${error}`);
                }
              }
            }
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(`Error processing tool calls: ${errorMessage}`);
        }
      }

      return { contentResult: updatedContent, toolCalls: updatedToolCalls };
    } catch (e: unknown) {
      // Last resort error handling
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`Unhandled error in processStreamChunk: ${errorMessage}`);
      return { contentResult: updatedContent, toolCalls: updatedToolCalls };
    }
  }

  /**
   * Clean JSON string to fix common parsing issues
   */
  private cleanJsonString(str: string): string {
    if (!str || str.trim() === "") return "";

    try {
      // Check for common data: prefix pattern in SSE and remove it if present
      let normalizedStr = str;
      if (normalizedStr.startsWith("data: ")) {
        normalizedStr = normalizedStr.substring(6);
      }

      // If it's the "[DONE]" marker, return empty to signal completion
      if (normalizedStr.includes("[DONE]")) {
        return "";
      }

      // Try the most strict approach first: extract valid JSON using regex that handles nested structures
      const strictMatch =
        /^\s*(\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{(?:[^{}])*\}))*\}))*\})\s*$/;
      const strictResult = normalizedStr.match(strictMatch);

      if (strictResult?.[1]) {
        // We found a complete JSON object
        const extracted = strictResult[1];

        // Verify extracted JSON is valid
        try {
          JSON.parse(extracted);
          return extracted;
        } catch {
          // If it fails, continue to less strict approaches
        }
      }

      // Next approach: look for any JSON object in the string, even if there's other content
      const jsonObjectMatch =
        /(\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{(?:[^{}])*\}))*\}))*\})/;
      const objectMatch = normalizedStr.match(jsonObjectMatch);

      if (objectMatch?.[1]) {
        try {
          const candidate = objectMatch[1];
          JSON.parse(candidate);
          return candidate;
        } catch {
          // Continue to next approach
        }
      }

      // Last resort: find the positions of the first { and last } and extract everything between
      const firstBrace = normalizedStr.indexOf("{");
      const lastBrace = normalizedStr.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
        try {
          const simpleExtract = normalizedStr.substring(
            firstBrace,
            lastBrace + 1
          );

          // Remove control characters that can break JSON parsing
          const cleaned = Array.from(simpleExtract)
            .filter((char) => {
              const code = char.charCodeAt(0);
              return !(code <= 0x1f || (code >= 0x7f && code <= 0x9f));
            })
            .join("");

          JSON.parse(cleaned);
          return cleaned;
        } catch {
          // If all extraction fails, return the normalized string
        }
      }

      // If we get here, we couldn't extract valid JSON
      return normalizedStr; // Return the normalized string as last resort
    } catch {
      return str;
    }
  }

  /**
   * Helper to format messages for OpenAI API
   */
  private formatMessagesForProvider(messages: any[]): any[] {
    return messages.map((m) => {
      const result: any = { role: m.role, content: m.content };

      if (m.name) {
        result.name = m.name;
      }

      if (m.tool_calls) {
        result.tool_calls = m.tool_calls;
      }

      if (m.tool_call_id) {
        result.tool_call_id = m.tool_call_id;
      }

      return result;
    });
  }

  /**
   * Helper to format tool definitions for OpenAI API
   */
  private formatToolsForProvider(
    toolDefinitions?: ToolConfig[]
  ): any[] | undefined {
    if (!toolDefinitions || toolDefinitions.length === 0) {
      return undefined;
    }

    return toolDefinitions.map((tool) =>
      this.convertToolToOpenAIFunction(tool)
    );
  }

  /**
   * Helper to accumulate tool calls from stream deltas
   */
  private updateExistingToolCall(existingCall: any, delta: any): void {
    if (delta.id) {
      existingCall.id = delta.id;
    }

    if (delta.type) {
      existingCall.type = delta.type;
    }

    if (delta.function) {
      if (!existingCall.function) {
        existingCall.function = { name: "", arguments: "" };
      }

      if (delta.function.name) {
        existingCall.function.name = delta.function.name;
      }

      if (delta.function.arguments) {
        existingCall.function.arguments =
          (existingCall.function.arguments || "") + delta.function.arguments;
      }
    }
  }

  private createNewToolCall(delta: any): any {
    const newCall: any = { index: delta.index };

    if (delta.id) newCall.id = delta.id;
    if (delta.type) newCall.type = delta.type;

    if (delta.function) {
      newCall.function = {
        name: delta.function.name || "",
        arguments: delta.function.arguments || "",
      };
    }

    return newCall;
  }

  private accumulateToolCalls(existing: any[], newDeltas: any[]): any[] {
    if (!newDeltas || newDeltas.length === 0) return existing;

    const toolCallMap = new Map<number, any>();

    for (const call of existing) {
      if (call.index !== undefined) {
        toolCallMap.set(call.index, call);
      }
    }
    for (const delta of newDeltas) {
      if (delta.index === undefined) continue;

      const existingCall = toolCallMap.get(delta.index);
      if (existingCall) {
        this.updateExistingToolCall(existingCall, delta);
      } else {
        toolCallMap.set(delta.index, this.createNewToolCall(delta));
      }
    }

    return Array.from(toolCallMap.values()).filter(
      (call) =>
        !call.function ||
        (call.function.name && call.function.name.trim() !== "")
    );
  }

  /**
   * Format tool calls from OpenAI format to internal format
   */
  private formatToolCallsFromOpenAI(tools: any[]): ToolCall[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => {
      let parameters: Record<string, any> = {};

      if (tool.function?.arguments) {
        try {
          parameters = JSON.parse(tool.function.arguments);
        } catch (e) {
          console.error(`Error parsing tool call arguments: ${e}`);
          parameters = { _raw: tool.function.arguments };
        }
      }

      return {
        toolName: tool.function?.name || "",
        parameters,
        result: null, // Will be populated after execution
        timestamp: Date.now(),
        id: tool.id,
      };
    });
  }

  /**
   * Approximate calculation of prompt tokens
   */
  private calculatePromptTokensApprox(messages: any[]): number {
    // Very simple approximation - 1 token ≈ 4 characters
    const totalChars = messages.reduce((sum: number, message: any) => {
      return sum + (message.content ? message.content.length : 0);
    }, 0);

    return Math.ceil(totalChars / 4);
  }

  /**
   * Approximate calculation of completion tokens
   */
  private calculateCompletionTokensApprox(content: string): number {
    // Very simple approximation - 1 token ≈ 4 characters
    return Math.ceil(content.length / 4);
  }
}
