import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import { PassThrough, Readable } from "node:stream";
import type { Agent } from "../../core/agent";
import {
  type A2ABASEError,
  A2AErrorCodes,
  type A2AJsonRpcRequest,
  type A2AJsonRpcResponse,
  A2AMethods,
  A2ATaskStates,
  A2A_JSONRPC_VERSION,
} from "../common/A2AProtocol";
import type {
  A2AAgentCard,
  A2AArtifact,
  A2AArtifactUpdateEvent,
  A2AStreamEvent,
  A2ATask,
  A2ATaskCancelParams,
  A2ATaskErrorEvent,
  A2ATaskGetParams,
  A2ATaskSendParams,
  A2ATaskStatus,
  A2ATaskStatusUpdateEvent,
} from "../common/types";
import { defaultAgentToTaskHandlerAdapter } from "./agentAdapter";
import type {
  A2AServerOptions,
  A2ATaskLogEntry,
  ActiveTask,
  AgentToTaskHandlerAdapter,
} from "./types";

const DEFAULT_HOST = "localhost";
const DEFAULT_ENDPOINT = "/a2a";

const NOTIFICATION_METHODS: string[] = [];

export class A2AServer {
  private agent: Agent;
  private server: http.Server | null = null;
  private options: Required<A2AServerOptions>;
  private activeTasks: Map<string, ActiveTask> = new Map();
  private agentToTaskHandlerAdapter: AgentToTaskHandlerAdapter;
  private logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };

  constructor(
    agent: Agent,
    options: A2AServerOptions,
    adapter?: AgentToTaskHandlerAdapter
  ) {
    this.agent = agent;
    this.options = {
      host: options.host || DEFAULT_HOST,
      port: options.port || 3000,
      endpoint: options.endpoint || DEFAULT_ENDPOINT,
      logger: options.logger || console,
      verbose: options.verbose || false,
    };
    this.logger = this.options.logger;
    this.agentToTaskHandlerAdapter =
      adapter || defaultAgentToTaskHandlerAdapter;
    this.requestListener = this.requestListener.bind(this);
  }

  public getAgentCard(): A2AAgentCard {
    return {
      name: this.agent.name,
      description: (this.agent as any).description || "",
      role: (this.agent as any).role || "Agent",
      objective: (this.agent as any).objective || "Perform tasks as directed",
      model: (this.agent as any).model || "default-model",
      protocolVersion: A2A_JSONRPC_VERSION,
      capabilities: [
        A2AMethods.TASK_SEND,
        A2AMethods.TASK_GET,
        A2AMethods.TASK_CANCEL,
        A2AMethods.AGENT_GET_CARD,
        A2AMethods.TASK_SUBSCRIBE_EVENTS,
      ],
      metadata: {
        streamingSupported: true,
        ...(this.agent as any).metadata,
      },
    };
  }

  public start(): Promise<void> {
    if (this.server?.listening) {
      this.logger.warn("[A2AServer] Server is already running.");
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.requestListener);
      this.server.on("error", (err) => {
        this.logger.error("[A2AServer] Failed to start:", err);
        reject(err);
      });
      this.server.listen(this.options.port, this.options.host, () => {
        this.logger.info(
          `[A2AServer] for agent '${this.agent.name}' listening on http://${this.options.host}:${this.options.port}${this.options.endpoint}`
        );
        this.logger.info(
          `[A2AServer] Agent Card available at http://${this.options.host}:${this.options.port}/.well-known/agent.json (if endpoint is root) or via ${this.options.endpoint}/.well-known/agent.json`
        );
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server?.listening) {
        this.activeTasks.forEach((taskEntry) => {
          if (taskEntry.sseStream && !taskEntry.sseStream.closed) {
            taskEntry.sseStream.end();
          }
          if (taskEntry.cancelEmitter) {
            taskEntry.cancelEmitter.emit("cancel");
            taskEntry.cancelEmitter.removeAllListeners();
          }
        });
        this.activeTasks.clear();

        this.server.close((err) => {
          if (err) {
            this.logger.error("[A2AServer] Error stopping server:", err);
            return reject(err);
          }
          this.logger.info("[A2AServer] Server stopped.");
          this.server = null;
          resolve();
        });
      } else {
        this.logger.info("[A2AServer] Server is not running.");
        resolve();
      }
    });
  }

  private async requestListener(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const { method, url } = req;
    this.logger.info(`[A2AServer] Received request: ${method} ${url}`);

    const endpointBase = this.options.endpoint.endsWith("/")
      ? this.options.endpoint.slice(0, -1)
      : this.options.endpoint;
    const wellKnownAgentPath = "/.well-known/agent.json";

    if (
      method === "GET" &&
      (url === wellKnownAgentPath ||
        url === `${endpointBase}${wellKnownAgentPath}`)
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.getAgentCard()));
      return;
    }

    if (url?.startsWith(endpointBase)) {
      let routePath = url.substring(endpointBase.length);
      this.logger.info(
        `[A2AServer] Calculated routePath (pre-normalization): '${routePath}' from endpointBase '${endpointBase}'`
      );

      if (
        endpointBase === "/" &&
        routePath !== "" &&
        !routePath.startsWith("/")
      ) {
        routePath = `/${routePath}`;
        this.logger.info(`[A2AServer] Normalized routePath: '${routePath}'`);
      }

      if (method === "GET" && routePath.match(/^\/tasks\/[^\/]+\/events$/)) {
        const taskId = routePath.split("/")[2];
        this.logger.info(`[A2AServer] Matched SSE route for taskId: ${taskId}`);
        this.handleSseConnection(req, res, taskId);
        return;
      }

      if (method === "POST" && (routePath === "" || routePath === "/")) {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("error", (err) => {
          this.logger.error("[A2AServer] Error reading request body:", err);
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad Request: Error reading request body.");
        });
        req.on("end", async () => {
          let rpcRequest: A2AJsonRpcRequest;
          try {
            if (!body) throw new Error("Request body is empty.");
            rpcRequest = JSON.parse(body);
            if (rpcRequest.jsonrpc !== A2A_JSONRPC_VERSION)
              throw new Error("Invalid jsonrpc version");
            if (typeof rpcRequest.method !== "string")
              throw new Error("Invalid method type");
            if (
              rpcRequest.id !== undefined &&
              rpcRequest.id !== null &&
              typeof rpcRequest.id !== "string" &&
              typeof rpcRequest.id !== "number"
            ) {
              throw new Error("Invalid request ID type");
            }
          } catch (e: any) {
            this.sendJsonRpcResponse(res, "parse-error", undefined, {
              code: A2AErrorCodes.PARSE_ERROR,
              message: `Parse error: ${e.message}`,
            });
            return;
          }

          if (
            rpcRequest.id === undefined &&
            !NOTIFICATION_METHODS.includes(rpcRequest.method)
          ) {
            this.sendJsonRpcResponse(
              res,
              rpcRequest.id ?? "invalid-request-id",
              undefined,
              {
                code: A2AErrorCodes.INVALID_REQUEST,
                message: `Request ID is missing for method '${rpcRequest.method}'.`,
              }
            );
            return;
          }

          switch (rpcRequest.method) {
            case A2AMethods.AGENT_GET_CARD:
              if (rpcRequest.id !== undefined) {
                this.sendJsonRpcResponse(
                  res,
                  rpcRequest.id,
                  this.getAgentCard()
                );
              } else {
                res.writeHead(204).end();
              }
              break;
            case A2AMethods.TASK_SEND:
              await this.handleTaskSend(
                res,
                rpcRequest as A2AJsonRpcRequest<A2ATaskSendParams>
              );
              break;
            case A2AMethods.TASK_GET:
              await this.handleTaskGet(
                res,
                rpcRequest as A2AJsonRpcRequest<A2ATaskGetParams>
              );
              break;
            case A2AMethods.TASK_CANCEL:
              await this.handleTaskCancel(
                res,
                rpcRequest as A2AJsonRpcRequest<A2ATaskCancelParams>
              );
              break;
            default:
              if (rpcRequest.id !== undefined) {
                this.sendJsonRpcResponse(res, rpcRequest.id, undefined, {
                  code: A2AErrorCodes.METHOD_NOT_FOUND,
                  message: `Method not found: ${rpcRequest.method}`,
                });
              } else {
                res.writeHead(204).end();
              }
          }
        });
        return;
      }
    }

    this.logger.warn(
      `[A2AServer] Endpoint not found for ${method} ${url}. Responding with 404.`
    );
    this.sendJsonRpcResponse(res, null, undefined, {
      code: A2AErrorCodes.METHOD_NOT_FOUND,
      message: "Endpoint not found.",
    });
  }

  private sendJsonRpcResponse<TResult, TErrorData>(
    res: http.ServerResponse,
    id: string | number | null,
    result?: TResult,
    error?: A2ABASEError<TErrorData>
  ): void {
    if (res.writableEnded) {
      this.logger.warn(
        "[A2AServer] Attempted to send JSON-RPC response, but stream already ended."
      );
      return;
    }
    const rpcResponse: A2AJsonRpcResponse<TResult, TErrorData> = {
      jsonrpc: A2A_JSONRPC_VERSION,
      id,
      ...(result !== undefined && { result }),
      ...(error && { error }),
    };
    let statusCode = 200;
    if (error) {
      switch (error.code) {
        case A2AErrorCodes.PARSE_ERROR:
        case A2AErrorCodes.INVALID_REQUEST:
          statusCode = 400;
          break;
        case A2AErrorCodes.METHOD_NOT_FOUND:
          statusCode = 404;
          break;
        default:
          statusCode = error.code === A2AErrorCodes.INTERNAL_ERROR ? 500 : 400;
      }
    }
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(rpcResponse));
  }

  private async handleTaskSend(
    res: http.ServerResponse,
    rpcRequest: A2AJsonRpcRequest<A2ATaskSendParams>
  ): Promise<void> {
    const params = rpcRequest.params;

    if (!params || !params.input) {
      if (rpcRequest.id !== undefined) {
        this.sendJsonRpcResponse(res, rpcRequest.id, undefined, {
          code: A2AErrorCodes.INVALID_PARAMS,
          message: "Missing 'input' in task parameters.",
        });
      }
      return;
    }

    const taskId = params.id || randomUUID();

    if (this.activeTasks.has(taskId)) {
      if (rpcRequest.id !== undefined) {
        this.sendJsonRpcResponse(res, rpcRequest.id, undefined, {
          code: A2AErrorCodes.INVALID_REQUEST,
          message: `Task with ID '${taskId}' already exists.`,
        });
      } else {
        res.writeHead(204).end();
      }
      return;
    }

    const initialTaskStatusMessage = "Task received and pending execution.";
    const newTask: A2ATask = {
      id: taskId,
      input: params.input,
      artifacts: [],
      status: {
        state: A2ATaskStates.PENDING,
        message: initialTaskStatusMessage,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        ...params.metadata,
        allowStreaming:
          params.stream || params.metadata?.allowStreaming || false,
      },
    };

    const sseStream = newTask.metadata?.allowStreaming
      ? new PassThrough({ objectMode: false })
      : undefined;
    const cancelController = new AbortController();

    const taskEntry: ActiveTask = {
      task: newTask,
      sseStream,
      isCancelled: false,
      updatesLog: [],
      cancelEmitter: new EventEmitter(),
      cancelSignal: cancelController.signal,
    };
    this.activeTasks.set(taskId, taskEntry);

    taskEntry.cancelEmitter?.on("cancel", () => {
      if (!cancelController.signal.aborted) {
        cancelController.abort();
        this.logger.info(
          `[A2AServer] Cancellation signal aborted for task ${taskId}`
        );
      }
    });

    if (rpcRequest.id !== undefined) {
      this.sendJsonRpcResponse(res, rpcRequest.id, { ...newTask });
    }

    // Ensure the initial event has taskId and timestamp
    const initialEventTimestamp = new Date().toISOString();
    newTask.updatedAt = initialEventTimestamp; // Also update the main task's updatedAt

    this.handleStreamEventForTask(
      taskId,
      {
        type: "statusUpdate",
        taskId: taskId, // Added taskId
        timestamp: initialEventTimestamp, // Added timestamp
        status: newTask.status,
      } as A2ATaskStatusUpdateEvent,
      true
    );

    this.processTask(
      taskId,
      this.agent,
      params.input,
      newTask.metadata,
      (event) => this.handleStreamEventForTask(taskId, event)
    );
  }

  private async handleTaskGet(
    res: http.ServerResponse,
    rpcRequest: A2AJsonRpcRequest<A2ATaskGetParams>
  ): Promise<void> {
    const params = rpcRequest.params;
    if (!params || !params.id) {
      if (rpcRequest.id !== undefined) {
        this.sendJsonRpcResponse(res, rpcRequest.id, undefined, {
          code: A2AErrorCodes.INVALID_PARAMS,
          message: "Missing 'id' in task/get parameters.",
        });
      }
      return;
    }

    const taskEntry = this.activeTasks.get(params.id);
    if (!taskEntry) {
      if (rpcRequest.id !== undefined) {
        this.sendJsonRpcResponse(res, rpcRequest.id, undefined, {
          code: A2AErrorCodes.TASK_NOT_FOUND,
          message: `Task with id ${params.id} not found.`,
        });
      }
      return;
    }
    if (rpcRequest.id !== undefined) {
      this.sendJsonRpcResponse(res, rpcRequest.id, { ...taskEntry.task });
    } else {
      res.writeHead(204).end();
    }
  }

  private async handleTaskCancel(
    res: http.ServerResponse,
    rpcRequest: A2AJsonRpcRequest<A2ATaskCancelParams>
  ): Promise<void> {
    const params = rpcRequest.params;
    if (!params || !params.id) {
      if (rpcRequest.id !== undefined) {
        this.sendJsonRpcResponse(res, rpcRequest.id, undefined, {
          code: A2AErrorCodes.INVALID_PARAMS,
          message: "Missing 'id' in task/cancel parameters.",
        });
      }
      return;
    }

    const taskEntry = this.activeTasks.get(params.id);
    if (!taskEntry) {
      if (rpcRequest.id !== undefined) {
        this.sendJsonRpcResponse(res, rpcRequest.id, undefined, {
          code: A2AErrorCodes.TASK_NOT_FOUND,
          message: `Task with id ${params.id} not found.`,
        });
      }
      return;
    }

    if (
      taskEntry.task.status.state === A2ATaskStates.COMPLETED ||
      taskEntry.task.status.state === A2ATaskStates.FAILED ||
      taskEntry.task.status.state === A2ATaskStates.CANCELLED
    ) {
      if (rpcRequest.id !== undefined) {
        this.sendJsonRpcResponse(res, rpcRequest.id, {
          id: params.id,
          status: taskEntry.task.status.state,
          message: `Task ${params.id} is already ${taskEntry.task.status.state}.`,
        });
      }
      return;
    }

    if (taskEntry.isCancelled) {
      if (rpcRequest.id !== undefined) {
        this.sendJsonRpcResponse(res, rpcRequest.id, {
          id: params.id,
          status: A2ATaskStates.CANCELLED,
          message: `Task ${params.id} cancellation already in progress or completed.`,
        });
      }
      return;
    }

    taskEntry.isCancelled = true;
    taskEntry.cancelEmitter?.emit("cancel");

    const newStatus: A2ATaskStatus = {
      state: A2ATaskStates.CANCELLED,
      message: "Task cancellation initiated by client.",
    };
    taskEntry.task.status = newStatus;
    taskEntry.task.updatedAt = new Date().toISOString();
    this.activeTasks.set(params.id, { ...taskEntry });

    this.handleStreamEventForTask(
      params.id,
      {
        type: "statusUpdate",
        status: newStatus,
      } as A2ATaskStatusUpdateEvent,
      true
    );

    if (rpcRequest.id !== undefined) {
      this.sendJsonRpcResponse(res, rpcRequest.id, {
        id: params.id,
        status: A2ATaskStates.CANCELLED,
        message: "Task cancellation initiated.",
      });
    } else {
      res.writeHead(204).end();
    }
  }

  private async processTask(
    taskId: string,
    agent: Agent,
    input: any,
    metadata: any,
    yieldUpdate: (event: A2AStreamEvent) => void
  ) {
    const taskEntry = this.activeTasks.get(taskId);
    if (!taskEntry) {
      this.logger.error(
        `[A2AServer] processTask: Task ID ${taskId} not found.`
      );
      return;
    }

    try {
      const taskHandler = this.agentToTaskHandlerAdapter(
        agent,
        this.logger,
        this.options.verbose
      );
      const taskHandlerIterator = taskHandler(
        taskId,
        input,
        metadata,
        taskEntry.cancelSignal
      );

      for await (const event of taskHandlerIterator) {
        if (
          taskEntry.cancelSignal?.aborted &&
          taskEntry.task.status.state !== A2ATaskStates.CANCELLED
        ) {
          this.logger.info(
            `[A2AServer] Task ${taskId} processing loop detected external cancellation via AbortSignal.`
          );
          if (
            !(
              event.type === "statusUpdate" &&
              event.status.state === A2ATaskStates.CANCELLED
            )
          ) {
            yieldUpdate({
              type: "statusUpdate",
              taskId: taskId,
              timestamp: new Date().toISOString(),
              status: {
                state: A2ATaskStates.CANCELLED,
                message: "Task processing aborted due to cancellation signal.",
              },
            });
          }
        }

        yieldUpdate(event);

        if (
          taskEntry.task.status.state === A2ATaskStates.COMPLETED ||
          taskEntry.task.status.state === A2ATaskStates.FAILED ||
          taskEntry.task.status.state === A2ATaskStates.CANCELLED
        ) {
          this.logger.info(
            `[A2AServer] Task ${taskId} reached terminal state: ${taskEntry.task.status.state}. Ending processTask loop.`
          );
          break;
        }
      }

      if (
        taskEntry.task.status.state !== A2ATaskStates.COMPLETED &&
        taskEntry.task.status.state !== A2ATaskStates.FAILED &&
        taskEntry.task.status.state !== A2ATaskStates.CANCELLED
      ) {
        this.logger.info(
          `[A2AServer] Task ${taskId} finished processing loop without explicit terminal event. Setting to COMPLETED.`
        );
        yieldUpdate({
          type: "statusUpdate",
          taskId: taskId,
          timestamp: new Date().toISOString(),
          status: {
            state: A2ATaskStates.COMPLETED,
            message: "Task processing completed.",
          },
        });
      }
    } catch (error: any) {
      this.logger.error(
        `[A2AServer] Uncaught error in processTask for ${taskId}:`,
        error
      );
      yieldUpdate({
        type: "statusUpdate",
        taskId: taskId,
        timestamp: new Date().toISOString(),
        status: {
          state: A2ATaskStates.FAILED,
          message: `Task failed: ${error.message}`,
          errorDetails: {
            message: error.message,
            stack: error.stack,
            ...error,
          },
        },
      });
    } finally {
      taskEntry.task.updatedAt = new Date().toISOString();
      this.activeTasks.set(taskId, { ...taskEntry });

      if (taskEntry.sseStream && !taskEntry.sseStream.closed) {
        this.logger.info(
          `[A2AServer] Closing SSE stream for task ${taskId} in processTask.finally`
        );
        taskEntry.sseStream.end();
      }
      taskEntry.cancelEmitter?.removeAllListeners();
      this.logger.info(`[A2AServer] processTask for ${taskId} finished.`);
    }
  }

  private handleSseConnection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ) {
    const taskEntry = this.activeTasks.get(taskId);

    if (!taskEntry || !taskEntry.task.metadata?.allowStreaming) {
      this.logger.warn(
        `[A2AServer] SSE connection attempt for task ${taskId}: Not found or streaming not allowed.`
      );
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Task not found or streaming not enabled for this task.");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":ok connection established\n\n");

    if (!taskEntry.sseStream) {
      this.logger.error(
        `[A2AServer] SSE connection for task ${taskId}: streaming allowed but sseStream is missing.`
      );
      const errorEventData = JSON.stringify({
        type: "error",
        error: { message: "SSE stream setup error on server." },
      });
      res.write(`data: ${errorEventData}\n\n`);
      res.end();
      return;
    }

    const stream = taskEntry.sseStream as PassThrough;
    stream.pipe(res);
    this.logger.info(
      `[A2AServer] SSE connection established and piped for task ${taskId}`
    );

    taskEntry.updatesLog.forEach((logEntry) => {
      let eventToResend: A2AStreamEvent | null = null;
      const eventTimestamp = new Date(logEntry.timestamp).toISOString();
      const currentTaskId = taskEntry.task.id;
      if (
        logEntry.status &&
        (logEntry.status.state !== A2ATaskStates.PENDING ||
          taskEntry.updatesLog.length === 1)
      ) {
        eventToResend = {
          type: "statusUpdate",
          taskId: currentTaskId,
          timestamp: eventTimestamp,
          status: logEntry.status,
        } as A2ATaskStatusUpdateEvent;
      } else if (logEntry.artifactId) {
        const artifact = taskEntry.task.artifacts?.find(
          (a) => a.id === logEntry.artifactId
        );
        if (artifact) {
          eventToResend = {
            type: "artifactUpdate",
            taskId: currentTaskId,
            timestamp: eventTimestamp,
            artifact,
          } as A2AArtifactUpdateEvent;
        }
      } else if (logEntry.error) {
        eventToResend = {
          type: "error",
          taskId: currentTaskId,
          timestamp: eventTimestamp,
          error: logEntry.error,
          final: true,
        } as A2ATaskErrorEvent;
      }

      if (eventToResend) {
        const sseEventId = new Date(logEntry.timestamp).getTime();
        try {
          const eventDataString = JSON.stringify(eventToResend);
          res.write(`id: ${sseEventId}\ndata: ${eventDataString}\n\n`);
        } catch (e: any) {
          this.logger.warn(
            `[A2AServer] Failed to write historical event to SSE stream for task ${taskId}: ${e.message}`
          );
          if (!res.writableEnded) {
            stream.unpipe(res);
            res.end();
          }
          return;
        }
      }
    });

    req.on("close", () => {
      this.logger.info(
        `[A2AServer] SSE client disconnected for task ${taskId}`
      );
      if (!res.writableEnded) {
        stream.unpipe(res);
        res.end();
      }
    });
  }

  private handleStreamEventForTask(
    taskId: string,
    event: A2AStreamEvent,
    isInitialEvent = false
  ) {
    const taskEntry = this.activeTasks.get(taskId);
    if (!taskEntry) {
      this.logger.warn(
        `[A2AServer] handleStreamEventForTask: Task ID ${taskId} not found when trying to process event.`
      );
      return;
    }

    let statusChangedOrSignificantEvent = isInitialEvent;
    const previousState = taskEntry.task.status.state;
    const previousMessage = taskEntry.task.status.message;

    if (event.type === "statusUpdate") {
      const statusUpdate = event as A2ATaskStatusUpdateEvent;
      if (
        taskEntry.task.status.state !== statusUpdate.status.state ||
        taskEntry.task.status.message !== statusUpdate.status.message
      ) {
        taskEntry.task.status = statusUpdate.status;
        statusChangedOrSignificantEvent = true;
      }
    } else if (event.type === "artifactUpdate") {
      const artifactUpdate = event as A2AArtifactUpdateEvent;
      if (!taskEntry.task.artifacts) taskEntry.task.artifacts = [];
      taskEntry.task.artifacts.push(artifactUpdate.artifact);
      statusChangedOrSignificantEvent = true;
    } else if (event.type === "error") {
      const errorEvent = event as A2ATaskErrorEvent;
      const newStatus: A2ATaskStatus = {
        state: A2ATaskStates.FAILED,
        message: errorEvent.error.message,
        errorDetails: errorEvent.error.data as any,
      };
      if (
        taskEntry.task.status.state !== newStatus.state ||
        taskEntry.task.status.message !== newStatus.message
      ) {
        taskEntry.task.status = newStatus;
        statusChangedOrSignificantEvent = true;
      }
    }

    const newTimestamp = event.timestamp;
    taskEntry.task.updatedAt = newTimestamp;

    if (statusChangedOrSignificantEvent) {
      const logEntry: A2ATaskLogEntry = {
        timestamp: newTimestamp,
        status: taskEntry.task.status,
        ...(event.type === "artifactUpdate" && {
          artifactId: (event as A2AArtifactUpdateEvent).artifact.id,
        }),
        ...(event.type === "error" && {
          error: (event as A2ATaskErrorEvent).error,
        }),
        ...(event.type === "statusUpdate" &&
          (previousState !== taskEntry.task.status.state ||
            previousMessage !== taskEntry.task.status.message) && {
            message: `Status: ${taskEntry.task.status.state}`,
          }),
      };
      taskEntry.updatesLog.push(logEntry);
    }

    this.activeTasks.set(taskId, { ...taskEntry });

    if (
      taskEntry.sseStream &&
      !taskEntry.sseStream.closed &&
      statusChangedOrSignificantEvent
    ) {
      const sseEventId = new Date(newTimestamp).getTime();
      try {
        const eventDataString = JSON.stringify(event);
        taskEntry.sseStream.write(
          `id: ${sseEventId}\ndata: ${eventDataString}\n\n`
        );
      } catch (streamError: any) {
        this.logger.warn(
          `[A2AServer] Failed to write to SSE stream for task ${taskId}: ${streamError.message}`
        );
      }
    }
  }
}
