import type { ChatCompletionMessageParam } from "token.js";
import type { LLM } from "../llm/llm";
import type { LLMResponse } from "../llm/llm";
import type { Tool } from "../tools/tool";
import { ToolRegistry } from "../tools/tool-registry";
import {
  type AgentConfig,
  AgentForgeEvents,
  type AgentResult,
  type ToolCall,
} from "../types";
import { globalEventEmitter } from "../utils/event-emitter";
import { logger } from "./agent-logger";
import { ErrorRecovery } from "./error-recovery";
import {
  AgentConfigurationError,
  AgentForgeError,
  AgentTimeoutError,
  LLMConnectionError,
  LLMResponseError,
  RateLimitError,
  ToolConfigurationError,
  ToolExecutionError,
} from "./errors";

/**
 * Agent run options
 */
export interface AgentRunOptions {
  /**
   * Enable streaming of LLM responses (default: false)
   */
  stream?: boolean;

  /**
   * Maximum number of turns to run
   */
  maxTurns?: number;

  /**
   * Maximum execution time in milliseconds (default: 2 minutes)
   */
  maxExecutionTime?: number;
}

/**
 * Represents an agent that can use LLMs and tools to accomplish tasks
 */
export class Agent {
  private config: AgentConfig;
  private tools: ToolRegistry;
  private llmProvider?: LLM;
  private conversation: ChatCompletionMessageParam[] = [];

  /**
   * Creates a new agent
   * @param config Configuration for the agent
   * @param tools Optional additional tools to provide to the agent
   * @param llmProvider Optional LLM provider for the agent
   */
  constructor(config?: AgentConfig, tools: Tool[] = [], llmProvider?: LLM) {
    // If config is not provided, try to get it from a static property (for decorator use)
    if (config) {
      this.config = config;
    } else {
      // @ts-ignore
      const staticConfig = (this.constructor as any).agentConfig;
      if (!staticConfig) {
        throw new AgentConfigurationError(
          "AgentConfig must be provided either via constructor or @agent decorator."
        );
      }
      this.config = staticConfig;
    }

    // Initialize the tool registry with provided tools
    this.tools = new ToolRegistry(tools);

    this.llmProvider = llmProvider;

    // Initialize conversation with system message
    this.resetConversation();
  }

  /**
   * Sets the LLM provider for the agent
   * @param provider The LLM provider to use
   */
  setLLMProvider(provider: LLM): void {
    this.llmProvider = provider;
  }

  /**
   * Gets the LLM provider for the agent
   * @returns The LLM provider or undefined if not set
   */
  getLLMProvider(): LLM | undefined {
    return this.llmProvider;
  }

  /**
   * Gets the name of the agent
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Gets the description of the agent
   */
  get description(): string {
    return this.config.description;
  }

  /**
   * Gets the role of the agent
   */
  get role(): string {
    return this.config.role;
  }

  /**
   * Gets the objective of the agent
   */
  get objective(): string {
    return this.config.objective;
  }

  /**
   * Gets the model the agent is configured to use
   */
  get model(): string {
    return this.config.model;
  }

  /**
   * Gets the agent's configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Resets the agent's conversation history
   */
  resetConversation(): void {
    // Create the system message that defines the agent's behavior
    const systemMessage: ChatCompletionMessageParam = {
      role: "system",
      content: `You are ${this.config.name}, a ${this.config.role}. ${this.config.description}\n\nYour objective is: ${this.config.objective}`,
    };

    this.conversation = [systemMessage];
  }

  /**
   * Gets the current conversation history
   */
  getConversation(): ChatCompletionMessageParam[] {
    return [...this.conversation];
  }

  /**
   * Adds a tool to the agent
   * @param tool The tool to add
   */
  addTool(tool: Tool): void {
    this.tools.register(tool);
  }

  /**
   * Gets all tools available to the agent
   */
  getTools(): Tool[] {
    return this.tools.getAll();
  }

  /**
   * Runs the agent on the given input
   * @param input The input to the agent
   * @param options Options for agent execution
   * @returns A promise that resolves to the result of the agent's execution
   */
  async run(input: string, options?: AgentRunOptions): Promise<AgentResult> {
    if (!this.llmProvider) {
      const error = new LLMConnectionError(
        "No LLM provider set for the agent",
        this.config.model,
        { agentName: this.name }
      );
      logger.critical(
        "Agent execution failed: No LLM provider",
        this.name,
        {},
        error
      );
      throw error;
    }

    const currentLlmProvider = this.llmProvider;
    const stream = options?.stream || false;
    const maxTurns = options?.maxTurns || 10;
    const startTime = Date.now();
    const maxExecutionTime = options?.maxExecutionTime || 120000; // Default 2 minute timeout

    // Start execution logging
    const executionId = logger.logExecutionStart(this.name, input, {
      stream,
      maxTurns,
      maxExecutionTime: `${maxExecutionTime}ms`,
    });

    // Add user message to conversation
    this.conversation.push({
      role: "user",
      content: input,
    });

    // Track token usage across turns
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const toolCalls: ToolCall[] = [];

    // Agent loop: generate a response, maybe use tools, repeat until done
    let finalAnswer = "";

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          const timeoutError = new AgentTimeoutError(
            `Agent execution timed out after ${maxExecutionTime}ms`,
            maxExecutionTime,
            Date.now() - startTime,
            {
              agentName: this.name,
              conversationLength: this.conversation.length,
            }
          );
          reject(timeoutError);
        }, maxExecutionTime);
      });

      const agentPromise = this.runAgentLoop(
        stream,
        maxTurns,
        toolCalls,
        totalPromptTokens,
        totalCompletionTokens,
        currentLlmProvider
      );

      // Race between agent execution and timeout
      const { finalResponse, promptTokens, completionTokens, agentToolCalls } =
        await Promise.race([agentPromise, timeoutPromise]);

      finalAnswer = finalResponse;
      totalPromptTokens = promptTokens;
      totalCompletionTokens = completionTokens;

      // Copy tool calls
      for (const call of agentToolCalls) {
        toolCalls.push(call);
      }
    } catch (error) {
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      logger.error(
        `Agent execution failed: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        {
          executionTime: `${executionTime}ms`,
          conversationLength: this.conversation.length,
          totalPromptTokens,
          totalCompletionTokens,
        },
        error instanceof AgentForgeError ? error : undefined
      );

      // Handle specific error types
      if (error instanceof AgentTimeoutError) {
        finalAnswer = `The agent process was terminated due to timeout (${
          maxExecutionTime / 1000
        }s). Here's what was determined so far: ${
          finalAnswer || "No conclusion reached yet."
        }`;

        // Log completion with timeout
        logger.logExecutionComplete(executionId, this.name, finalAnswer, {
          prompt: totalPromptTokens,
          completion: totalCompletionTokens,
          total: totalPromptTokens + totalCompletionTokens,
        });
      } else if (error instanceof Error) {
        // Transform generic errors into specific error types
        if (
          error.message.includes("503 Service Unavailable") ||
          error.message.includes("Service Unavailable")
        ) {
          const llmError = new LLMConnectionError(
            "LLM provider service is temporarily unavailable (503). This is usually a temporary issue with the provider.",
            this.config.model,
            {
              agentName: this.name,
              additionalData: { originalError: error.message },
            }
          );
          logger.error("LLM service unavailable", this.name, {}, llmError);
          throw llmError;
        }

        if (
          error.message.includes("rate limit") ||
          error.message.includes("Rate limit")
        ) {
          const rateLimitError = new RateLimitError(
            `Rate limit exceeded for model ${this.config.model}`,
            undefined,
            undefined,
            { agentName: this.name, model: this.config.model }
          );
          logger.error("Rate limit exceeded", this.name, {}, rateLimitError);
          throw rateLimitError;
        }

        if (
          error.message.includes(
            "Cannot read properties of undefined (reading 'filter')"
          )
        ) {
          const toolConfigError = new ToolConfigurationError(
            "Tool configuration error detected. This appears to be a compatibility issue with the Token.js library. Please check your tool configurations and ensure they are properly formatted.",
            undefined,
            {
              agentName: this.name,
              additionalData: { originalError: error.message },
            }
          );
          logger.error(
            "Tool configuration error",
            this.name,
            {},
            toolConfigError
          );
          throw toolConfigError;
        }

        // Wrap unknown errors in AgentForgeError
        const wrappedError = new AgentForgeError(
          `Unexpected error during agent execution: ${error.message}`,
          "AGENT_EXECUTION_ERROR",
          undefined,
          {
            agentName: this.name,
            additionalData: { originalError: error.message },
          }
        );
        logger.error(
          "Unexpected agent execution error",
          this.name,
          {},
          wrappedError
        );
        throw wrappedError;
      }

      // Re-throw AgentForgeError instances, wrap everything else
      if (error instanceof AgentForgeError) {
        throw error;
      }

      // Handle any other error types that weren't caught above
      const wrappedError = new AgentForgeError(
        `Unhandled error during agent execution: ${error instanceof Error ? error.message : String(error)}`,
        "AGENT_EXECUTION_ERROR",
        undefined,
        {
          agentName: this.name,
          additionalData: {
            originalError:
              error instanceof Error ? error.message : String(error),
            errorType: typeof error,
          },
        }
      );
      logger.error(
        "Unhandled agent execution error",
        this.name,
        {},
        wrappedError
      );
      throw wrappedError;
    }

    const endTime = Date.now();

    // Log successful completion
    logger.logExecutionComplete(executionId, this.name, finalAnswer, {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens,
    });

    // Create the final result
    const result: AgentResult = {
      output: finalAnswer,
      metadata: {
        tokenUsage: {
          prompt: totalPromptTokens,
          completion: totalCompletionTokens,
          total: totalPromptTokens + totalCompletionTokens,
        },
        executionTime: endTime - startTime,
        modelName: this.config.model,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    };

    return result;
  }

  /**
   * Runs the main agent loop
   * @private
   */
  private async runAgentLoop(
    stream: boolean,
    maxTurns: number,
    toolCalls: ToolCall[],
    totalPromptTokens: number,
    totalCompletionTokens: number,
    llmProvider: LLM
  ): Promise<{
    finalResponse: string;
    promptTokens: number;
    completionTokens: number;
    agentToolCalls: ToolCall[];
  }> {
    let finalResponse = "";
    let currentTurn = 0;
    let promptTokens = totalPromptTokens;
    let completionTokens = totalCompletionTokens;
    const agentToolCalls: ToolCall[] = [...toolCalls];

    while (currentTurn < maxTurns) {
      currentTurn++;

      // Get optimized tools configuration for the current model
      const toolsConfig = this.getValidatedToolsConfig();

      // Get response from LLM - choose between streaming and non-streaming
      let response: LLMResponse;
      const llmStartTime = Date.now();

      try {
        if (stream) {
          // Use streaming chat
          // Define the agent name for use in the callback
          const agentName = this.name;

          response = await ErrorRecovery.withRetry(
            () =>
              llmProvider.chatStream({
                model: this.config.model,
                messages: this.conversation,
                temperature: this.config.temperature,
                max_tokens: this.config.maxTokens,
                tools: toolsConfig,
                agentName: this.name, // Pass the agent name to the LLM

                onChunk: (chunk) => {
                  // Process the chunk to remove common formatting issues
                  // This is just for convenience - events will also be emitted
                  // from the provider for more advanced use cases
                  globalEventEmitter.emit(AgentForgeEvents.LLM_STREAM_CHUNK, {
                    agentName: agentName, // Use the captured agent name
                    chunk: chunk.choices?.[0]?.delta?.content,
                    isDelta: true,
                    isComplete: false,
                  });
                },
              }),
            {
              agentName: this.name,
              operationName: `llm-chat-stream-${this.config.model}`,
            }
          );
        } else {
          // Use regular chat
          response = await ErrorRecovery.withRetry(
            () =>
              llmProvider.chat({
                model: this.config.model,
                messages: this.conversation,
                temperature: this.config.temperature,
                max_tokens: this.config.maxTokens,
                tools: toolsConfig,
              }),
            {
              agentName: this.name,
              operationName: `llm-chat-${this.config.model}`,
            }
          );
        }

        const llmExecutionTime = Date.now() - llmStartTime;

        // Log successful LLM interaction
        logger.logLLMInteraction(
          this.name,
          this.config.model,
          response.tokenUsage,
          llmExecutionTime
        );
      } catch (error) {
        const llmExecutionTime = Date.now() - llmStartTime;

        // Create specific LLM error
        const llmError =
          error instanceof LLMConnectionError ||
          error instanceof LLMResponseError
            ? error
            : new LLMConnectionError(
                error instanceof Error ? error.message : String(error),
                this.config.model,
                {
                  agentName: this.name,
                  executionTime: llmExecutionTime,
                  additionalData: {
                    originalError:
                      error instanceof Error ? error.message : String(error),
                  },
                }
              );

        // Log LLM interaction error
        logger.logLLMInteraction(
          this.name,
          this.config.model,
          undefined,
          llmExecutionTime,
          llmError
        );

        throw llmError;
      }

      // Update token usage
      promptTokens += response.tokenUsage?.prompt ?? 0;
      completionTokens += response.tokenUsage?.completion ?? 0;

      // If there are tool calls, execute them
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Create properly formatted tool calls for the assistant message
        const formattedToolCalls = response.toolCalls.map((call) => {
          // Ensure each tool call has a unique ID
          const id =
            call.id ||
            `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
          return {
            id,
            type: "function" as const,
            function: {
              name: call.toolName,
              arguments: JSON.stringify(call.parameters),
            },
          };
        });

        // Add the assistant's message with properly formatted tool_calls
        this.conversation.push({
          role: "assistant",
          content: response.content,
          tool_calls: formattedToolCalls,
        });

        if (stream) {
          // Emit agent communication event if streaming
          globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
            sender: this.name,
            message: `I'll use the following tools: ${response.toolCalls
              .map((tc) => tc.toolName)
              .join(", ")}`,
            timestamp: Date.now(),
          });
        }

        // Process each tool call
        for (const toolCall of formattedToolCalls) {
          // Find the corresponding toolCall from the response
          const responseToolCall: any = response.toolCalls.find(
            (tc) => tc.toolName === toolCall.function.name
          );

          if (!responseToolCall) {
            throw new Error(
              `Tool call for ${toolCall.function.name} not found in response`
            );
          }

          // Extract parameters
          const params = responseToolCall.parameters;
          const toolStartTime = Date.now();

          try {
            // Execute the tool with error recovery
            const result = await ErrorRecovery.withRetry(
              () => this.tools.execute(toolCall.function.name, params),
              {
                agentName: this.name,
                operationName: `tool-execution-${toolCall.function.name}`,
              }
            );

            const toolExecutionTime = Date.now() - toolStartTime;

            // Log successful tool execution
            logger.logToolExecution(
              this.name,
              toolCall.function.name,
              params,
              result,
              undefined,
              toolExecutionTime
            );

            // Add the tool response as a properly formatted tool message
            this.conversation.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });

            // Store the result in the original tool call
            responseToolCall.result = result;

            // Add to our list of tool calls
            agentToolCalls.push({
              ...responseToolCall,
              id: toolCall.id,
            });

            if (stream) {
              // Emit tool call result if streaming
              globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
                sender: `Tool: ${toolCall.function.name}`,
                recipient: this.name,
                message:
                  typeof result === "object"
                    ? JSON.stringify(result, null, 2)
                    : String(result),
                timestamp: Date.now(),
              });
            }
          } catch (error) {
            const toolExecutionTime = Date.now() - toolStartTime;

            // Create specific tool execution error
            const toolError =
              error instanceof ToolExecutionError
                ? error
                : new ToolExecutionError(
                    error instanceof Error ? error.message : String(error),
                    toolCall.function.name,
                    responseToolCall.parameters,
                    {
                      agentName: this.name,
                      executionTime: toolExecutionTime,
                      additionalData: {
                        originalError:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      },
                    }
                  );

            // Log tool execution error
            logger.logToolExecution(
              this.name,
              toolCall.function.name,
              responseToolCall.parameters,
              undefined,
              toolError,
              toolExecutionTime
            );

            const errorMessage = `Error: ${toolError.message}`;

            this.conversation.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: errorMessage,
            });

            // Find the responseToolCall
            const foundResponseToolCall = response.toolCalls.find(
              (tc) => tc.toolName === toolCall.function.name
            );

            if (foundResponseToolCall) {
              // Add to our list of tool calls with the error
              agentToolCalls.push({
                ...foundResponseToolCall,
                id: toolCall.id,
                result: errorMessage,
              });

              if (stream) {
                // Emit tool error if streaming
                globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
                  sender: `Tool: ${toolCall.function.name}`,
                  recipient: this.name,
                  message: errorMessage,
                  timestamp: Date.now(),
                });
              }
            }
          }
        }
      } else {
        // No tool calls, so this is the final answer
        finalResponse = response.content;

        // Add the assistant's final message
        this.conversation.push({
          role: "assistant",
          content: finalResponse,
        });

        if (stream) {
          // Emit final answer communication if streaming
          globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
            sender: this.name,
            message: finalResponse,
            timestamp: Date.now(),
          });
        }

        // We're done!
        break;
      }
    }

    // If we ran out of turns, get a final answer
    if (currentTurn >= maxTurns && !finalResponse) {
      // Get final response from LLM
      const finalMessage = {
        role: "system" as const,
        content:
          "You have used the maximum number of tool calls. Please provide your final answer based on the information you have.",
      };

      let finalLLMResponse: LLMResponse;

      // Get optimized tools configuration for final response
      const finalToolsConfig = this.getValidatedToolsConfig();

      if (stream) {
        // Use streaming for final response
        finalLLMResponse = await llmProvider.chatStream({
          model: this.config.model,
          messages: [...this.conversation, finalMessage],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          tools: finalToolsConfig,
          agentName: this.name, // Pass the agent name to the LLM

          onChunk: (chunk) => {
            globalEventEmitter.emit(AgentForgeEvents.LLM_STREAM_CHUNK, {
              agentName: this.name,
              chunk: this.cleanStreamedText(
                chunk.choices?.[0]?.delta?.content ?? ""
              ),
              isDelta: true,
              isComplete: false,
            });
          },
        });
      } else {
        // Use regular chat
        finalLLMResponse = await llmProvider.chat({
          model: this.config.model,
          messages: [...this.conversation, finalMessage],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          tools: finalToolsConfig,
        });
      }

      finalResponse = finalLLMResponse.content;

      // Update token usage
      promptTokens += finalLLMResponse.tokenUsage?.prompt ?? 0;
      completionTokens += finalLLMResponse.tokenUsage?.completion ?? 0;

      // Add the assistant's final message
      this.conversation.push({
        role: "assistant",
        content: finalResponse,
      });

      if (stream) {
        // Emit final answer communication if streaming
        globalEventEmitter.emit(AgentForgeEvents.AGENT_COMMUNICATION, {
          sender: this.name,
          message: `Final answer (max turns reached): ${finalResponse}`,
          timestamp: Date.now(),
        });
      }
    }

    return {
      finalResponse,
      promptTokens,
      completionTokens,
      agentToolCalls,
    };
  }

  /**
   * Cleans streamed text to fix common formatting issues
   */
  private cleanStreamedText(text: string): string {
    if (!text) {
      return "";
    }

    // Fix repeated words with periods (e.g., "word.word.")
    let cleaned = text.replace(/(\w+)\.(\1)\./g, "$1.");

    // Fix cases where words are duplicated with a space (e.g., "word word")
    cleaned = cleaned.replace(/\b(\w+)(\s+\1)+\b/g, "$1");

    // Remove excessive punctuation
    cleaned = cleaned.replace(/\.{2,}/g, ".");
    cleaned = cleaned.replace(/\,{2,}/g, ",");

    return cleaned;
  }

  /**
   * Gets tools configuration with compatibility warnings
   * @private
   */
  private getValidatedToolsConfig(): any {
    const tools = this.tools.getAll();

    if (tools.length === 0) {
      return undefined;
    }

    const allConfigs = this.tools.getAllConfigChatCompletion();

    // Show warnings for potential compatibility issues with any model
    this.validateToolConfigsAndWarn(allConfigs);

    // Always return all tools - don't filter based on model
    return allConfigs;
  }

  /**
   * Validate tool configurations and show warnings for all models
   * @private
   */
  private validateToolConfigsAndWarn(configs: any[]): void {
    if (configs.length > 8) {
      console.warn(
        `⚠️  You have ${configs.length} tools. Some LLMs perform better with fewer tools (≤8). Consider grouping related functionality.`
      );
    }

    if (configs.length > 15) {
      console.warn(
        `⚠️  You have ${configs.length} tools which is quite high. This may impact LLM performance significantly.`
      );
    }

    // Check for overly complex tools
    configs.forEach((config) => {
      const toolName = config?.function?.name || "unnamed";
      const params = config?.function?.parameters;

      if (params?.properties && Object.keys(params.properties).length > 10) {
        console.warn(
          `⚠️  Tool "${toolName}" has ${Object.keys(params.properties).length} parameters. LLMs may struggle with very complex schemas.`
        );
      }

      // Check for missing descriptions
      if (
        !config?.function?.description ||
        config.function.description.trim() === ""
      ) {
        console.warn(
          `⚠️  Tool "${toolName}" has no description. This will significantly impact LLM tool selection accuracy.`
        );
      }

      // Check for very long descriptions
      if (
        config?.function?.description &&
        config.function.description.length > 500
      ) {
        console.warn(
          `⚠️  Tool "${toolName}" has a very long description (${config.function.description.length} chars). Consider shortening for better LLM comprehension.`
        );
      }
    });
  }
}
