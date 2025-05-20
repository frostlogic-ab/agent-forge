import type { ChatCompletionTool } from "../llm/types";
import type { ToolConfig } from "../types";
import type { Tool } from "./tool";

/**
 * Registry for managing and accessing tools
 */
export class ToolRegistry {
  private tools: Map<string, Tool>;

  /**
   * Creates a new tool registry
   * @param initialTools Initial set of tools to register
   */
  constructor(initialTools: Tool[] = []) {
    this.tools = new Map();

    // Register initial tools
    for (const tool of initialTools) {
      this.register(tool);
    }
  }

  /**
   * Registers a tool with the registry
   * @param tool The tool to register
   * @returns The registry instance for method chaining
   */
  register(tool: Tool): ToolRegistry {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name '${tool.name}' is already registered`);
    }

    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Gets a tool by name
   * @param name Name of the tool to get
   * @returns The tool instance
   */
  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool with name '${name}' is not registered`);
    }

    return tool;
  }

  /**
   * Checks if a tool with the given name is registered
   * @param name Name of the tool to check
   * @returns True if the tool is registered, false otherwise
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Unregisters a tool by name
   * @param name Name of the tool to unregister
   * @returns True if the tool was unregistered, false if it wasn't registered
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Gets all registered tools
   * @returns Array of all registered tools
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Gets tool configurations for all registered tools
   * @returns Array of tool configurations
   */
  getAllConfigs(): ToolConfig[] {
    return this.getAll().map((tool) => tool.getConfig());
  }

  getAllConfigChatCompletion(): ChatCompletionTool[] {
    return this.getAll().map((tool) => tool.getChatCompletionConfig());
  }

  /**
   * Executes a tool by name with the given parameters
   * @param name Name of the tool to execute
   * @param params Parameters to execute the tool with
   * @returns Result of the tool execution
   */
  async execute(name: string, params: Record<string, any>): Promise<any> {
    const tool = this.get(name);
    return await tool.execute(params);
  }

  /**
   * Creates a new tool registry with all tools from this registry and the other registry
   * @param other The other registry to merge with
   * @returns A new registry with tools from both registries
   */
  merge(other: ToolRegistry): ToolRegistry {
    const merged = new ToolRegistry(this.getAll());

    for (const tool of other.getAll()) {
      if (!this.has(tool.name)) {
        merged.register(tool);
      }
    }

    return merged;
  }
}
