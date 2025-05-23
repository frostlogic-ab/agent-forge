export const A2A_JSONRPC_VERSION = "2.0";

export enum A2ATaskStates {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export enum A2AMethods {
  // Agent Discovery
  AGENT_GET_CARD = "agent/getCard", // Kept for potential direct RPC, though /.well-known/ is preferred

  // Task Management
  TASK_SEND = "task/send",
  TASK_GET = "task/get",
  TASK_CANCEL = "task/cancel",
  TASK_LIST = "task/list", // Optional: For listing all tasks managed by the server
  TASK_SUBSCRIBE_EVENTS = "task/subscribeEvents", // For SSE
}

export enum A2AErrorCodes {
  // Standard JSON-RPC Error Codes
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // A2A Specific Error Codes
  TASK_NOT_FOUND = -32000,
  TASK_ALREADY_COMPLETED = -32001,
  TASK_CANCELLED_BY_CLIENT = -32002,
  TASK_EXECUTION_ERROR = -32003, // Generic error during task execution by the agent
  AGENT_UNAVAILABLE = -32004,
  STREAMING_NOT_SUPPORTED = -32005,
  AUTHORIZATION_FAILED = -32006,
  NETWORK_ERROR = -32007,
  // Add more specific A2A error codes as needed
}

/**
 * Base interface for JSON-RPC requests.
 */
export interface A2AJsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: T;
  id?: string | number | null;
}

/**
 * Base interface for JSON-RPC responses.
 */
export interface A2AJsonRpcResponse<T = unknown, E = unknown> {
  jsonrpc: "2.0";
  result?: T;
  error?: A2ABASEError<E>;
  id: string | number | null;
}

/**
 * Interface for JSON-RPC error objects.
 */
export interface A2ABASEError<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

// Generic parameter types, will be specialized in types.ts
export interface A2ATaskIdParams {
  id: string;
}
