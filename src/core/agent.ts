import type { LLMProvider } from "../llm/llm-provider";
import type { Tool } from "../tools/tool";
import { ToolRegistry } from "../tools/tool-registry";
import type { AgentConfig, AgentResult, Message, ToolCall } from "../types";

/**
 * Represents an agent that can use LLMs and tools to accomplish tasks
 */
export class Agent {
  private config: AgentConfig;
  private tools: ToolRegistry;
  private llmProvider?: LLMProvider;
  private conversation: Message[] = [];

  /**
   * Creates a new agent
   * @param config Configuration for the agent
   * @param tools Optional tools to provide to the agent
   * @param llmProvider Optional LLM provider for the agent
   */
  constructor(
    config: AgentConfig,
    tools: Tool[] = [],
    llmProvider?: LLMProvider
  ) {
    this.config = config;
    this.tools = new ToolRegistry(tools);
    this.llmProvider = llmProvider;

    // Initialize conversation with system message
    this.resetConversation();
  }

  /**
   * Sets the LLM provider for the agent
   * @param provider The LLM provider to use
   */
  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
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
    const systemMessage: Message = {
      role: "system",
      content: `You are ${this.config.name}, a ${this.config.role}. ${this.config.description}\n\nYour objective is: ${this.config.objective}`,
    };

    this.conversation = [systemMessage];
  }

  /**
   * Gets the current conversation history
   */
  getConversation(): Message[] {
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
   * Runs the agent with a user input
   * @param input The user's input
   * @param maxTurns Maximum number of tool use turns allowed
   * @returns The agent's result
   */
  async run(input: string, maxTurns = 10): Promise<AgentResult> {
    if (!this.llmProvider) {
      throw new Error("No LLM provider set for the agent");
    }

    const startTime = Date.now();

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
    let currentTurn = 0;
    let finalAnswer = "";

    while (currentTurn < maxTurns) {
      currentTurn++;

      // Get response from LLM
      const response = await this.llmProvider.chat({
        model: this.config.model,
        messages: this.conversation,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        toolDefinitions: this.tools.getAllConfigs(),
      });

      // Update token usage
      totalPromptTokens += response.tokenUsage.prompt;
      totalCompletionTokens += response.tokenUsage.completion;

      // If there are tool calls, execute them
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add the assistant's message with tool calls
        this.conversation.push({
          role: "assistant",
          content: response.content,
        });

        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          try {
            // Execute the tool
            const result = await this.tools.execute(
              toolCall.toolName,
              toolCall.parameters
            );

            // Add the result to the tool call
            toolCall.result = result;

            // Add the tool response to the conversation
            this.conversation.push({
              role: "tool",
              name: toolCall.toolName,
              content: JSON.stringify(result),
            });

            // Add to our list of tool calls
            toolCalls.push(toolCall);
          } catch (error) {
            // If the tool execution fails, add the error to the conversation
            this.conversation.push({
              role: "tool",
              name: toolCall.toolName,
              content: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });

            // Add the failed tool call to our list
            toolCalls.push({
              ...toolCall,
              result: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }
      } else {
        // No tool calls, so this is the final answer
        finalAnswer = response.content;

        // Add the assistant's final message
        this.conversation.push({
          role: "assistant",
          content: finalAnswer,
        });

        // We're done!
        break;
      }
    }

    // If we ran out of turns, get a final answer
    if (currentTurn >= maxTurns && !finalAnswer) {
      // Get final response from LLM
      const finalResponse = await this.llmProvider.chat({
        model: this.config.model,
        messages: [
          ...this.conversation,
          {
            role: "system",
            content:
              "You have used the maximum number of tool calls. Please provide your final answer based on the information you have.",
          },
        ],
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
      });

      finalAnswer = finalResponse.content;

      // Update token usage
      totalPromptTokens += finalResponse.tokenUsage.prompt;
      totalCompletionTokens += finalResponse.tokenUsage.completion;

      // Add the assistant's final message
      this.conversation.push({
        role: "assistant",
        content: finalAnswer,
      });
    }

    const endTime = Date.now();

    return {
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
  }
}
