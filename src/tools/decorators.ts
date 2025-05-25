import type { MCPClientWrapper } from "./mcp-tool";

import { Agent } from "../core/agent";
import {
  type MCPProtocolType,
  type MCPSseConfig,
  type MCPStdioConfig,
  type MCPStreamableHttpConfig,
  MCPToolWrapper,
  createMCPClient,
} from "./mcp-tool";

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
export function MCP(
  protocol: MCPProtocolType,
  config: MCPStdioConfig | MCPSseConfig | MCPStreamableHttpConfig
): ClassDecorator {
  return (target: any): any => {
    // Runtime check: ensure target is an Agent constructor
    if (typeof target !== "function" || !(target.prototype instanceof Agent)) {
      throw new Error(
        "@MCP decorator can only be applied to classes extending Agent"
      );
    }
    // Keep a list of MCP configs on the class
    if (!(target as any).mcpConfigs) {
      (target as any).mcpConfigs = [];
    }
    (target as any).mcpConfigs.push({ protocol, config });

    // Return a subclass that loads MCP tools on instantiation
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
              for (const mcpTool of mcpTools) {
                const wrapper = new MCPToolWrapper(mcpTool, client);
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
