import type { EventEmitter } from "node:events";
import type http from "node:http";
import type { PassThrough, Readable } from "node:stream";
import type { Agent } from "../../core/agent";
import type {
  A2AArtifact,
  A2AMessage,
  A2AStreamEvent,
  A2ATask,
  A2ATaskCancelParams,
  A2ATaskCancelResult,
  A2ATaskGetParams,
  A2ATaskGetResult,
  A2ATaskSendParams,
  A2ATaskSendResult,
  A2ATaskStatus,
} from "../common/types";

/**
 * Options for configuring the A2A Server.
 */
export interface A2AServerOptions {
  host?: string;
  port?: number;
  endpoint?: string;
  logger?: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  /**
   * If true, the server will log detailed information about agent interactions,
   * including the input to and output from the underlying LLM calls for tasks.
   * Defaults to false.
   * @type {boolean}
   */
  verbose?: boolean;
  // Other options like SSL/TLS certificates, etc.
}

export interface A2ATaskLogEntry {
  timestamp: string;
  status: A2ATaskStatus;
  message?: string; // Optional detailed message for the log entry itself
  artifactId?: string;
  error?: any; // Error details if the status is FAILED
}

export interface ActiveTask {
  task: A2ATask;
  sseStream?: PassThrough; // Stream for Server-Sent Events
  isCancelled: boolean;
  updatesLog: A2ATaskLogEntry[];
  cancelEmitter?: EventEmitter; // Added for explicit cancellation signaling
  cancelSignal?: AbortSignal; // Added for AbortController based cancellation
  // May include other runtime state, e.g., reference to the running agent process/handler
}

export type A2ATaskHandler = (
  taskId: string,
  input: any,
  metadata: any | undefined,
  cancellationSignal?: AbortSignal
) => AsyncGenerator<A2AStreamEvent, void, undefined>;

/**
 * Defines the shape of an adapter that takes an Agent instance, a logger, and a verbose flag,
 * and returns a task handler function.
 * The task handler is an async generator that processes the task and yields A2AStreamEvents.
 */
export type AgentToTaskHandlerAdapter = (
  agent: Agent,
  logger: Required<A2AServerOptions>["logger"],
  verbose: boolean
) => A2ATaskHandler;
