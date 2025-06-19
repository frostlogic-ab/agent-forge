/**
 * Agent Forge - A TypeScript framework for creating and orchestrating AI agents
 */

// Core exports
export { Agent } from "./core/agent";
export { Workflow } from "./core/workflow";
export { Team } from "./core/team";
export { loadAgentFromYaml } from "./config/yaml-loader";
export { AgentForge } from "./core/agent-forge";

// A2A Protocol exports
export {
  A2AServer,
  defaultAgentToTaskHandlerAdapter,
  A2AClient,
  RemoteA2AAgent,
} from "./a2a";
export type {
  A2AClientOptions,
  A2AServerOptions,
  A2ATaskHandler,
  AgentToTaskHandlerAdapter,
  A2AAgentCard,
  A2ATask,
  A2AMessage,
  A2AStreamEvent,
  A2ATaskSendParams,
  A2ATaskGetParams,
  A2ATaskCancelParams,
} from "./a2a";

// Tool system exports
export { Tool } from "./tools/tool";
export { ToolRegistry } from "./tools/tool-registry";
export { WebSearchTool } from "./tools/web-search-tool";
export { WebPageContentTool } from "./tools/web-page-content-tool";
export {
  MCPClientWrapper,
  MCPSdkClientWrapper,
  createMCPClient,
  MCPToolWrapper,
  MCPManager,
  MCPProtocolType,
} from "./tools/mcp-tool";
export type { MCPTool } from "./tools/mcp-tool";

// LLM provider exports
export { LLM } from "./llm/llm";

// RAG exports
export {
  ChromaDbClient,
  RAGTool,
  DocumentIndexer,
} from "./rag";
export type {
  RAGChromaDbConfig,
  DocumentChunk,
  RAGSearchResult,
  RAGQueryOptions,
  DocumentIndexingResult,
  ChromaDbClientConfig,
  EmbeddingResponse,
} from "./rag";

// Plugin system exports
export {
  Plugin,
  PluginManager,
  PluginLifecycleHooks,
  LoggingPlugin,
  MetricsPlugin,
} from "./plugins";
export type {
  PluginContext,
  PluginHookData,
  PluginHookHandler,
  PluginMetrics,
} from "./plugins";

// Streaming exports
export { globalEventEmitter, EventEmitter } from "./utils/event-emitter";
export { enableConsoleStreaming } from "./utils/streaming";

// Types
export type { LLMProvider } from "./types";
export type { AgentConfig } from "./types";
export type { ToolConfig } from "./types";
export type { ToolParameter } from "./types";
export type { AgentResult } from "./types";
export type { ToolCall } from "./types";
export type { LLMProviderConfig } from "./types";
export type { Message } from "./types";
export type { LLMRequestOptions } from "./types";
export { ExecutionMode } from "./types";
export { AgentForgeEvents } from "./types";
export type { AgentCommunicationEvent } from "./types";
export type { LLMStreamEvent } from "./types";
export type { StreamingOptions } from "./types";
export type { WorkflowRunOptions } from "./types";
export type { TeamRunOptions } from "./types";
export type { Task } from "./types";
export type { RateLimiterConfig } from "./types";

// Decorators
export { agent, llmProvider, forge } from "./core/decorators";
export type { ForgeConfig } from "./core/decorators";
export { RateLimiter, Visualizer } from "./utils/decorators";
export { a2aClient, a2aServer } from "./a2a/decorators";
export { MCP, tool } from "./tools/decorators";
export { RAGChromaDb } from "./rag/decorators";
export { plugin } from "./plugins/decorators";

export {
  loadAgentForgeConfig,
  getExtendedModelList,
} from "./config/json-config-loader";

export { readyForge } from "./core/agent-forge";

// Error handling and logging exports
export {
  AgentForgeError,
  LLMConnectionError,
  ToolExecutionError,
  AgentConfigurationError,
  PluginError,
  ToolConfigurationError,
  AgentTimeoutError,
  RateLimitError,
  LLMResponseError,
  ErrorSeverity,
  DEFAULT_RECOVERY_STRATEGIES,
} from "./core/errors";
export type {
  ErrorContext,
  ErrorLogObject,
  ErrorRecoveryStrategy,
} from "./core/errors";

export { AgentLogger, LogLevel } from "./core/agent-logger";
export type { LogEntry, LoggerConfig } from "./core/agent-logger";

export { ErrorRecovery, ErrorAnalyzer } from "./core/error-recovery";
export type { ErrorAnalysisResult, ErrorTrends } from "./core/error-recovery";
