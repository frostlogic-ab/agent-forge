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

    return class extends target {
      private __mcpClients: MCPClientWrapper[] = [];
      constructor(...args: any[]) {
        super(...args);
        if (
          (this as any).tools &&
          ((target as any).mcpConfigs?.length ?? 0) > 0
        ) {
          (async () => {
            for (const { protocol, config } of (target as any).mcpConfigs) {
              const client = createMCPClient(protocol, config);
              await client.initialize();
              const mcpTools = await client.listTools();
              // Get rate limiter config from the class
              const rateLimiterConfig: RateLimiterConfig | undefined = (
                target as any
              ).rateLimiterConfig;
              for (const mcpTool of mcpTools) {
                let rateLimiter: any;
                // Tool-specific limits
                for (const [pattern, limit] of Object.entries(
                  rateLimiterConfig?.toolSpecificLimits || {}
                ) as [string, any][]) {
                  if (
                    mcpTool.name.includes(pattern) &&
                    typeof limit === "object" &&
                    limit !== null
                  ) {
                    rateLimiter =
                      new (require("../utils/rate-limiter").RateLimiter)({
                        ...(limit as object),
                        verbose: rateLimiterConfig?.verbose,
                        toolName: mcpTool.name,
                      });
                    break;
                  }
                }
                // Global limits if no tool-specific
                if (
                  !rateLimiter &&
                  (rateLimiterConfig?.rateLimitPerSecond ||
                    rateLimiterConfig?.rateLimitPerMinute)
                ) {
                  rateLimiter =
                    new (require("../utils/rate-limiter").RateLimiter)({
                      callsPerSecond: rateLimiterConfig.rateLimitPerSecond,
                      callsPerMinute: rateLimiterConfig.rateLimitPerMinute,
                      verbose: rateLimiterConfig.verbose,
                      toolName: mcpTool.name,
                    });
                }
                const wrapper = new MCPToolWrapper(
                  mcpTool,
                  client,
                  rateLimiter,
                  { cacheTTL: rateLimiterConfig?.cacheTTL }
                );
                this.addTool(wrapper);
              }
              this.__mcpClients.push(client);
            }
          })();
        }
      }
      async closeMCPClients() {
        for (const client of this.__mcpClients) {
          await client.close();
        }
        this.__mcpClients = [];
      }
    };
  };
}
