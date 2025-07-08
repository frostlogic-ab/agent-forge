import type { MCPClientWrapper } from "./mcp-tool";

import { Agent } from "../core/agent";
import type { RateLimiterConfig } from "../types";
import {
  type MCPProtocolType,
  type MCPSseConfig,
  type MCPStdioConfig,
  type MCPStreamableHttpConfig,
  MCPToolWrapper,
  createMCPClient,
  MCPManager,
} from "./mcp-tool";
import type { Tool } from "./tool";

/**
 * Tool decorator. Adds a tool to an agent class.
 *
 * @param ToolClass Tool class constructor
 *
 * Usage:
 *   @tool(WebSearchTool)
 *   @tool(CalculatorTool)
 *   @agent(config)
 *   class MyAgent extends Agent {}
 */
export function tool<T extends Tool>(
  ToolClass: new (...args: any[]) => T
): ClassDecorator {
  return (target: any): any => {
    // Runtime check: ensure target is an Agent constructor
    if (typeof target !== "function" || !(target.prototype instanceof Agent)) {
      throw new Error(
        "@tool decorator can only be applied to classes extending Agent"
      );
    }

    // Store tool classes on the constructor
    if (!(target as any).toolClasses) {
      (target as any).toolClasses = [];
    }
    (target as any).toolClasses.push(ToolClass);

    // Only wrap the class once - check if we already have a tool wrapper
    if ((target as any).__hasToolWrapper) {
      return target;
    }

    // Mark that we've wrapped this class
    (target as any).__hasToolWrapper = true;

    // Return a subclass that adds tools on instantiation
    return class extends target {
      constructor(...args: any[]) {
        super(...args);

        // Add all tools from the static toolClasses array
        if ((this.constructor as any).toolClasses) {
          for (const ToolClassToAdd of (this.constructor as any).toolClasses) {
            try {
              const toolInstance = new ToolClassToAdd();
              this.addTool(toolInstance);
            } catch (error) {
              console.warn(
                `Failed to instantiate tool ${ToolClassToAdd.name}:`,
                error
              );
            }
          }
        }
      }
    };
  };
}

/**
 * MCP decorator. Attaches MCP tools from a remote MCP server to the agent instance at construction time.
 *
 * Usage:
 *   @MCP(MCPProtocolType.STDIO, { ... })
 *   @agent({...})
 *   class MyAgent extends Agent {}
 *
 * Multiple @MCP decorators can be used to add tools from multiple MCP sources.
 */
// Update MCP decorator to use rateLimiterConfig if present
export function MCP(
  protocol: MCPProtocolType,
  config: MCPStdioConfig | MCPSseConfig | MCPStreamableHttpConfig
): ClassDecorator {
  return (target: any): any => {
    if (typeof target !== "function" || !(target.prototype instanceof Agent)) {
      throw new Error(
        "@MCP decorator can only be applied to classes extending Agent"
      );
    }
    if (!(target as any).mcpConfigs) {
      (target as any).mcpConfigs = [];
    }
    (target as any).mcpConfigs.push({ protocol, config });

    // Check if the class has already been wrapped
    if ((target as any).__hasMCPWrapper) {
      return target;
    }
    (target as any).__hasMCPWrapper = true;

    return class extends target {
      private __mcpManager?: MCPManager;

      constructor(...args: any[]) {
        super(...args);

        if ((target as any).mcpConfigs?.length > 0) {
          this.initializeMCPTools();
        }
      }

      private async initializeMCPTools() {
        const rateLimiterConfig: RateLimiterConfig | undefined = (
          this.constructor as any
        ).rateLimiterConfig;

        this.__mcpManager = new MCPManager({
          rateLimitPerSecond: rateLimiterConfig?.rateLimitPerSecond,
          rateLimitPerMinute: rateLimiterConfig?.rateLimitPerMinute,
          toolSpecificLimits: rateLimiterConfig?.toolSpecificLimits,
          verbose: rateLimiterConfig?.verbose,
        });

        for (const { protocol, config } of (this.constructor as any)
          .mcpConfigs) {
          const client = createMCPClient(protocol, config);
          await this.__mcpManager.addClient(client);
        }

        const mcpTools = this.__mcpManager.getTools();
        for (const mcpTool of mcpTools) {
          this.addTool(mcpTool);
        }
      }

      async closeMCPClients() {
        if (this.__mcpManager) {
          await this.__mcpManager.close();
          this.__mcpManager = undefined;
        }
      }
    };
  };
}
