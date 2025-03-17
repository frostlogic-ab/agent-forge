import { ChatCompletionMessageParam } from "token.js";

/**
 * Core type definitions for Agent Forge
 */

/**
 * Agent configuration object
 */
export interface AgentConfig {
  name: string;
  role: string;
  description: string;
  objective: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolConfig[];
}

/**
 * Tool configuration object
 */
export interface ToolConfig {
  name: string;
  description: string;
  parameters?: ToolParameter[];
  returnType?: string;
}

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: any;
}

/**
 * Result of an agent run
 */
export interface AgentResult {
  output: string;
  metadata: {
    tokenUsage?: {
      prompt: number;
      completion: number;
      total: number;
    };
    executionTime: number;
    modelName: string;
    toolCalls?: ToolCall[];
  };
}

/**
 * Record of a tool being called by an agent
 */
export interface ToolCall {
  toolName: string;
  parameters: Record<string, any>;
  result: any;
  id?: string;
}

/**
 * Configuration for an LLM provider
 */
export interface LLMProviderConfig {
  apiKey?: string;
  organizationId?: string;
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * Structure of a message in a conversation
 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;

  // For assistant messages with tool calls
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;

  // For tool messages (responses to tool calls)
  tool_call_id?: string;
}

/**
 * Options for an LLM request
 */
export interface LLMRequestOptions {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  toolDefinitions?: ChatCompletionMessageParam;
}

/**
 * Types of execution modes for agents
 */
export enum ExecutionMode {
  SEQUENTIAL = "sequential",
  HIERARCHICAL = "hierarchical",
}

/**
 * Event types for Agent Forge
 */
export enum AgentForgeEvents {
  AGENT_COMMUNICATION = "agent:communication",
  WORKFLOW_STEP_COMPLETE = "workflow:step_complete",
  TEAM_TASK_COMPLETE = "team:task_complete",
  EXECUTION_COMPLETE = "execution:complete",
  LLM_STREAM_CHUNK = "llm:stream_chunk",
  LLM_STREAM_COMPLETE = "llm:stream_complete",
}

/**
 * Agent communication event structure
 */
export interface AgentCommunicationEvent {
  sender: string;
  recipient?: string;
  message: string;
  timestamp: number;
}

/**
 * LLM stream event structure
 */
export interface LLMStreamEvent {
  agentName: string;
  chunk: string;
  isDelta: boolean;
  isComplete: boolean;
}

/**
 * Streaming options for LLM requests
 */
export interface StreamingOptions {
  stream: boolean;
  onChunk?: (chunk: string) => void;
}

/**
 * Options for workflow execution
 */
export interface WorkflowRunOptions {
  /**
   * Maximum number of LLM calls allowed per minute (default: no limit)
   * Used to prevent hitting API rate limits
   */
  rate_limit?: number;

  /**
   * Enable detailed logging of workflow execution (default: false)
   * Useful for debugging workflow steps
   */
  verbose?: boolean;

  /**
   * Enable streaming of agent communications and LLM responses (default: false)
   */
  stream?: boolean;

  /**
   * Enable built-in console visualization of streams (default: false)
   * Only applicable when stream is true
   */
  enableConsoleStream?: boolean;
}

/**
 * Options for team execution
 */
export interface TeamRunOptions {
  /**
   * Maximum number of LLM calls allowed per minute (default: no limit)
   * Used to prevent hitting API rate limits
   */
  rate_limit?: number;

  /**
   * Enable detailed logging of communication between manager and agents (default: false)
   * Useful for debugging team interactions
   */
  verbose?: boolean;

  /**
   * Enable streaming of agent communications and LLM responses (default: false)
   */
  stream?: boolean;

  /**
   * Enable built-in console visualization of streams (default: false)
   * Only applicable when stream is true
   */
  enableConsoleStream?: boolean;
}
