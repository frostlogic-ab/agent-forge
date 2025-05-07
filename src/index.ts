/**
 * Agent Forge - A TypeScript framework for creating and orchestrating AI agents
 */

// Core exports
export { Agent } from "./core/agent";
export { Workflow } from "./core/workflow";
export { Team } from "./core/team";
export { loadAgentFromYaml } from "./config/yaml-loader";
export { AgentForge } from "./core/agent-forge";

// Tool system exports
export { Tool } from "./tools/tool";
export { ToolRegistry } from "./tools/tool-registry";
export { SECApiTool } from "./tools/sec-api-tool";
export { WebSearchTool } from "./tools/web-search-tool";
export { WebPageContentTool } from "./tools/web-page-content-tool";
export {
  MCPServerConnection,
  MCPStdioConnection,
  MCPSseConnection,
  MCPTool,
  MCPToolWrapper,
  createMCPConnection,
  MCPManager,
  MCPProtocolType,
} from "./tools/mcp-tool";

// LLM provider exports
export { LLM } from "./llm/llm";

// Streaming exports
export { globalEventEmitter, EventEmitter } from "./utils/event-emitter";
export { enableConsoleStreaming } from "./utils/streaming";

// Types
export * from "./types";
