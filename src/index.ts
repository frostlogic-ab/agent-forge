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
export {
  Tool,
  ToolRegistry,
  SECApiTool,
  WebSearchTool,
  WebPageContentTool,
} from "./tools";

// LLM provider exports
export { LLM } from "./llm/llm";

// Streaming exports
export { globalEventEmitter, EventEmitter } from "./utils/event-emitter";
export { enableConsoleStreaming } from "./utils/streaming";

// Types
export * from "./types";
