import type { Message } from "../../types"; // Message is available
import type { A2ABASEError, A2ATaskStates } from "./A2AProtocol";

// Based on A2A TypeScript Guide: https://a2aprotocol.ai/docs/guide/a2a-typescript-guide.html

// Simple part structure, can be expanded if agent-forge supports multipart messages directly.
export interface A2AMessagePart {
  text?: string;
  // In the future, could add other types like image_url, binary_data, etc.
  mimeType?: string; // Good practice to include if not text/plain
}

// #region Core Task and Message Structures
export interface A2AMessage extends Message {}

export interface A2ATask {
  id: string;
  status: A2ATaskStatusUpdate; // The current overall status
  input?: any; // Renamed from message.content for clarity, representing primary task input
  artifacts?: A2AArtifact[];
  createdAt?: string; // ISO 8601 timestamp
  updatedAt?: string; // ISO 8601 timestamp
  metadata?: Record<string, any>; // Added metadata field
}

export interface A2ATaskStatus {
  state: A2ATaskStates;
  message?: string; // Changed from A2AMessage to string for simpler status updates
  progress?: number; // Optional progress indicator (0-100)
  errorDetails?: any; // Added for storing error specific info
}

export interface A2ATaskStatusUpdate extends A2ATaskStatus {}

export interface A2AArtifact {
  id: string; // Unique identifier for the artifact
  name?: string; // Filename or identifier
  mimeType: string;
  parts: A2AMessagePart[]; // Using our defined A2AMessagePart
  uri?: string; // Optional URI for large artifacts
  createdAt?: string; // ISO 8601 timestamp
}
// #endregion

// #region Method-Specific Params & Results

// tasks/send & tasks/sendSubscribe
export interface A2ATaskSendParams {
  id: string; // Task ID, typically a UUID
  input: any; // Changed from message to input to match A2ATask.input
  metadata?: Record<string, any>; // Added metadata
  stream?: boolean; // Added stream flag
  [key: string]: any; // Allow for extensibility
}

// Result for tasks/send is typically the initial Task object or null/error
export type A2ATaskSendResult = A2ATask | null;

// tasks/get
export interface A2ATaskGetParams {
  id: string;
}
export type A2ATaskGetResult = A2ATask | null;

// tasks/cancel
export interface A2ATaskCancelParams {
  id: string;
}
export type A2ATaskCancelResult = { success: boolean; message?: string } | null;

// tasks/pushNotification/set
export interface A2APushNotificationConfig {
  endpoint: string; // URL to send notifications to
  // Optional: headers, method (POST/PUT), etc.
  [key: string]: any;
}
export interface A2ATaskPushNotificationSetParams {
  id: string;
  config: A2APushNotificationConfig;
}
export type A2ATaskPushNotificationSetResult = { success: boolean } | null;

// tasks/pushNotification/get
export interface A2ATaskPushNotificationGetParams {
  id: string;
}
export type A2ATaskPushNotificationGetResult = A2APushNotificationConfig | null;

// tasks/resubscribe
export interface A2ATaskResubscribeParams {
  id: string;
  // Optional: lastEventId for resuming stream
  lastEventId?: string;
}
// Streaming result, handled by event types below

// #endregion

// #region Streaming Event Payloads (for tasks/sendSubscribe, tasks/resubscribe)

export interface A2ATaskYieldUpdateBase {
  taskId: string;
  timestamp: string; // ISO 8601
}

// Type guard property: 'status'
export interface A2ATaskStatusUpdateEvent extends A2ATaskYieldUpdateBase {
  type: "statusUpdate"; // Added literal type property
  status: A2ATaskStatusUpdate;
  final?: boolean; // Indicates if this is the terminal status update for the stream
}

// Type guard property: 'artifact'
export interface A2AArtifactUpdateEvent extends A2ATaskYieldUpdateBase {
  type: "artifactUpdate"; // Added literal type property
  artifact: A2AArtifact;
}

// Type guard property: 'error'
export interface A2ATaskErrorEvent extends A2ATaskYieldUpdateBase {
  type: "error"; // Added literal type property
  error: A2ABASEError;
  final: true; // Errors are always final for a stream
}

// Union type for events from sendSubscribe/resubscribe streams
export type A2AStreamEvent =
  | A2ATaskStatusUpdateEvent
  | A2AArtifactUpdateEvent
  | A2ATaskErrorEvent;

// #endregion

// #region Agent Card (for .well-known/agent.json)

export interface A2AAgentCard {
  name: string;
  description?: string;
  role?: string; // Added: Agent's role
  objective?: string; // Added: Agent's primary objective
  model?: string; // Added: Model identifier used by the agent (can be conceptual)
  version?: string;
  protocolVersion?: typeof import("./A2AProtocol").A2A_JSONRPC_VERSION;
  capabilities?: string[]; // List of supported high-level capabilities or methods
  // Other relevant agent metadata
  [key: string]: any;
}

// #endregion
