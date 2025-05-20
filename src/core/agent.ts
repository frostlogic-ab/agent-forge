import type { LLM } from "../llm/llm";
import type { LLMResponse } from "../llm/llm";
import type { ChatCompletionMessageParam } from "../llm/types";
import type { Tool } from "../tools/tool";
import { ToolRegistry } from "../tools/tool-registry";
import {
  type AgentConfig,
  AgentForgeEvents,
  type AgentResult,
  type ToolCall,
} from "../types";
import { globalEventEmitter } from "../utils/event-emitter";

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
  constructor(config: AgentConfig, tools: Tool[] = [], llmProvider?: LLM) {
    this.config = config;

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
      throw new Error("No LLM provider set for the agent");
    }
    const currentLlmProvider = this.llmProvider;

    const stream = options?.stream || false;
    const maxTurns = options?.maxTurns || 10;
    const startTime = Date.now();
    const maxExecutionTime = options?.maxExecutionTime || 120000; // Default 2 minute timeout

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
          reject(
            new Error(`Agent execution timed out after ${maxExecutionTime}ms`)
          );
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
      if (error instanceof Error && error.message.includes("timed out")) {
        finalAnswer = `The agent process was terminated due to timeout (${
          maxExecutionTime / 1000
        }s). Here's what was determined so far: ${
          finalAnswer || "No conclusion reached yet."
        }`;
      } else {
        throw error; // Re-throw other errors
      }
    }

    const endTime = Date.now();

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

      // Get response from LLM - choose between streaming and non-streaming
      let response: LLMResponse;

      if (stream) {
        // Use streaming chat
        // Define the agent name for use in the callback
        const agentName = this.name;

        response = await llmProvider.chatStream({
          model: this.config.model,
          messages: this.conversation,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          tools: this.tools.getAllConfigChatCompletion(),

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
        });
      } else {
        // Use regular chat
        response = await llmProvider.chat({
          model: this.config.model,
          messages: this.conversation,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          tools: this.tools.getAllConfigChatCompletion(),
        });
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

          try {
            // Extract parameters
            const params = responseToolCall.parameters;

            // Execute the tool
            const result = await this.tools.execute(
              toolCall.function.name,
              params
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
            // If the tool execution fails, add an error message
            const errorMessage = `Error: ${
              error instanceof Error ? error.message : String(error)
            }`;

            this.conversation.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: errorMessage,
            });

            // Find the responseToolCall
            const responseToolCall = response.toolCalls.find(
              (tc) => tc.toolName === toolCall.function.name
            );

            if (responseToolCall) {
              // Add to our list of tool calls with the error
              agentToolCalls.push({
                ...responseToolCall,
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

      if (stream) {
        // Use streaming for final response
        finalLLMResponse = await llmProvider.chatStream({
          model: this.config.model,
          messages: [...this.conversation, finalMessage],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,

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
}
