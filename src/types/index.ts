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
  timestamp: number;
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
  toolDefinitions?: ToolConfig[];
}

/**
 * Response from an LLM
 */
export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
  model: string;
}

/**
 * Types of execution modes for agents
 */
export enum ExecutionMode {
  SEQUENTIAL = "sequential",
  HIERARCHICAL = "hierarchical",
}
