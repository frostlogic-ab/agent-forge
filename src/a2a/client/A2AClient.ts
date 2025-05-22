import { randomUUID } from "node:crypto"; // For generating request IDs if not provided
import {
  type EventSourceMessage,
  EventStreamContentType,
  fetchEventSource,
} from "@microsoft/fetch-event-source";
import * as eventsource from "eventsource"; // Import namespace
import {
  type A2ABASEError,
  A2AErrorCodes,
  type A2AJsonRpcRequest,
  type A2AJsonRpcResponse,
  A2AMethods,
  A2A_JSONRPC_VERSION,
} from "../common/A2AProtocol";
import type {
  A2AAgentCard,
  A2AArtifactUpdateEvent,
  A2AStreamEvent,
  A2ATask,
  A2ATaskCancelParams,
  A2ATaskCancelResult,
  A2ATaskErrorEvent,
  A2ATaskGetParams,
  A2ATaskGetResult,
  A2ATaskSendParams,
  A2ATaskSendResult,
  A2ATaskStatusUpdateEvent,
} from "../common/types";
import type { A2AClientOptions } from "./types";

export class A2AClientError extends Error {
  constructor(
    message: string,
    public code?: number,
    public data?: any
  ) {
    super(message);
    this.name = "A2AClientError";
  }
}

export class A2AClient {
  private options: A2AClientOptions;
  private _fetch: typeof fetch;

  constructor(options: A2AClientOptions) {
    this.options = {
      ...options,
      serverUrl: options.serverUrl.replace(/\/$/, ""),
    };
    this._fetch = this.options.fetch || globalThis.fetch;

    if (!this._fetch) {
      throw new Error(
        "Fetch API is not available. Please provide a fetch implementation in A2AClientOptions or ensure it is globally available."
      );
    }
  }

  private async makeRpcRequest<TResult>(
    method: string,
    params: unknown,
    id?: string | number | null
  ): Promise<TResult> {
    const requestId = id ?? randomUUID();
    const rpcRequest: A2AJsonRpcRequest = {
      jsonrpc: A2A_JSONRPC_VERSION,
      id: requestId,
      method,
      params,
    };

    try {
      const response = await this._fetch(this.options.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(rpcRequest),
      });

      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch (_e) {
          /* Ignore if body isn't JSON */
        }
        throw new A2AClientError(
          `A2A RPC request failed with status ${response.status}: ${response.statusText}`,
          response.status,
          (errorData as A2AJsonRpcResponse)?.error
        );
      }

      const rpcResponse: A2AJsonRpcResponse = await response.json();

      if (rpcResponse.id !== requestId) {
        throw new A2AClientError("A2A RPC response ID mismatch.");
      }

      if (rpcResponse.error) {
        throw new A2AClientError(
          rpcResponse.error.message || "A2A RPC Error",
          rpcResponse.error.code,
          rpcResponse.error.data
        );
      }
      return rpcResponse.result as TResult;
    } catch (error) {
      if (error instanceof A2AClientError) throw error;
      // Wrap other errors (network etc.)
      throw new A2AClientError(
        error instanceof Error ? error.message : String(error),
        A2AErrorCodes.INTERNAL_ERROR
      );
    }
  }

  async sendTask(params: A2ATaskSendParams): Promise<A2ATaskSendResult> {
    return this.makeRpcRequest<A2ATaskSendResult>(
      A2AMethods.TASK_SEND,
      params,
      params.id
    );
  }

  async getTask(params: A2ATaskGetParams): Promise<A2ATaskGetResult> {
    return this.makeRpcRequest<A2ATaskGetResult>(
      A2AMethods.TASK_GET,
      params,
      params.id
    );
  }

  async cancelTask(params: A2ATaskCancelParams): Promise<A2ATaskCancelResult> {
    return this.makeRpcRequest<A2ATaskCancelResult>(
      A2AMethods.TASK_CANCEL,
      params,
      params.id
    );
  }

  async *sendTaskSubscribe(
    params: A2ATaskSendParams
  ): AsyncIterable<A2AStreamEvent> {
    if (!params.id) {
      throw new A2AClientError(
        "Task ID must be provided in A2ATaskSendParams for sendTaskSubscribe.",
        A2AErrorCodes.INVALID_PARAMS
      );
    }

    console.log(
      `[A2AClient] sendTaskSubscribe: this.options.serverUrl = '${this.options.serverUrl}'`
    );

    // Construct the SSE URL relative to the server's full A2A endpoint URL
    // const ssePath = `tasks/${params.id}/events`;
    // const sseUrl = new URL(ssePath, this.options.serverUrl).toString();

    // Manual URL construction for diagnostics
    const sseBase = this.options.serverUrl.endsWith("/")
      ? this.options.serverUrl
      : `${this.options.serverUrl}/`;
    const sseUrl = `${sseBase}tasks/${params.id}/events`;

    console.log(
      `[A2AClient] Attempting to connect to SSE URL (manual construction): ${sseUrl}`
    );

    const eventSource = new eventsource.EventSource(sseUrl);

    const eventQueue: (A2AStreamEvent | Error | null)[] = [];
    let resolveNextPromise: (() => void) | null = null;
    let errorOccurred: Error | null = null;

    const pushToQueueAndSignal = (item: A2AStreamEvent | Error | null) => {
      eventQueue.push(item);
      if (resolveNextPromise) {
        resolveNextPromise();
        resolveNextPromise = null;
      }
    };

    eventSource.onopen = () => {
      // console.log(`[A2AClient] SSE connection opened for task ${params.id}`);
    };

    eventSource.onmessage = (event: MessageEvent) => {
      try {
        if (event.data) {
          const streamEvent = JSON.parse(event.data) as A2AStreamEvent;
          pushToQueueAndSignal(streamEvent);
        }
      } catch (e) {
        const parseError = new A2AClientError(
          "Failed to parse SSE event data.",
          A2AErrorCodes.INTERNAL_ERROR,
          e
        );
        errorOccurred = parseError;
        pushToQueueAndSignal(parseError);
      }
    };

    eventSource.onerror = (err: Event) => {
      let clientError: A2AClientError;
      // The error object from 'eventsource' can be generic. Attempt to provide more specific error codes.
      // Note: (err as any).status is not standard for EventSource errors but some implementations might add it.
      if (
        (err as any).status === 401 ||
        (err as any).message?.includes("401")
      ) {
        clientError = new A2AClientError(
          `SSE connection failed: Unauthorized (401) for task ${params.id}`,
          A2AErrorCodes.AUTHORIZATION_FAILED,
          err
        );
      } else if (err instanceof Error && (err as any).code === "ECONNREFUSED") {
        clientError = new A2AClientError(
          `SSE connection failed: Connection refused for task ${params.id}`,
          A2AErrorCodes.NETWORK_ERROR,
          err
        );
      } else if ((err as any).message) {
        clientError = new A2AClientError(
          `SSE connection error for task ${params.id}: ${(err as any).message}`,
          A2AErrorCodes.NETWORK_ERROR,
          err
        );
      } else {
        clientError = new A2AClientError(
          `Unknown SSE connection error for task ${params.id}`,
          A2AErrorCodes.INTERNAL_ERROR,
          err
        );
      }
      errorOccurred = clientError;
      pushToQueueAndSignal(clientError);
      eventSource.close();
    };

    try {
      while (true) {
        if (errorOccurred) {
          throw errorOccurred;
        }

        if (eventQueue.length > 0) {
          const item = eventQueue.shift();
          if (item === undefined) continue;
          if (item === null) {
            return;
          }
          if (item instanceof Error) {
            throw item;
          }
          yield item as A2AStreamEvent;
        } else {
          await new Promise<void>((resolve) => {
            resolveNextPromise = resolve;
          });
        }
      }
    } finally {
      eventSource.close();
    }
  }

  // Method to fetch the Agent Card
  async getAgentCard(): Promise<A2AAgentCard | null> {
    // The Agent Card is typically fetched via a GET request to a well-known URI,
    // not as a standard JSON-RPC method call to the A2A endpoint.
    const baseServerUrl = new URL(this.options.serverUrl);
    // Construct the URL to /.well-known/agent.json relative to the server's origin
    const cardUrl = new URL("/.well-known/agent.json", baseServerUrl.origin);

    try {
      const response = await this._fetch(cardUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        let errorBody: any = { message: response.statusText }; // Default error if body isn't JSON
        try {
          errorBody = await response.json();
        } catch (_e) {
          // Ignore if the error response body is not JSON
        }
        throw new A2AClientError(
          `Fetching agent card from ${cardUrl.toString()} failed with status ${response.status}: ${response.statusText}`,
          response.status,
          errorBody
        );
      }
      return (await response.json()) as A2AAgentCard;
    } catch (error) {
      // Log the error for debugging
      // console.error(`[A2AClient] Error fetching agent card from ${cardUrl.toString()}:`, error);
      if (error instanceof A2AClientError) throw error; // Re-throw if already an A2AClientError
      // Wrap other errors (network, parsing, etc.) in A2AClientError
      throw new A2AClientError(
        `Network or unexpected error fetching agent card from ${cardUrl.toString()}: ${error instanceof Error ? error.message : String(error)}`,
        A2AErrorCodes.INTERNAL_ERROR, // Generic internal error code for client-side issues
        error
      );
    }
  }
}
