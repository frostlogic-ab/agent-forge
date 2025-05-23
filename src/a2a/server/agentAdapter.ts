import { randomUUID } from "node:crypto";
import type { Agent } from "../../core/agent";
import {
  AgentForgeEvents,
  type AgentResult,
  type LLMStreamEvent,
  type Message,
} from "../../types";
import { globalEventEmitter } from "../../utils/event-emitter";
import { A2AErrorCodes, A2ATaskStates } from "../common/A2AProtocol";
import type {
  A2AArtifact,
  A2AArtifactUpdateEvent,
  A2AMessage,
  A2AMessagePart,
  A2AStreamEvent,
  A2ATaskErrorEvent,
  A2ATaskStatusUpdateEvent,
} from "../common/types";
import type {
  A2AServerOptions,
  A2ATaskHandler,
  AgentToTaskHandlerAdapter,
} from "./types";

/**
 * Default adapter to make an agent-forge Agent compatible with the A2A server's task handling.
 */
export const defaultAgentToTaskHandlerAdapter: AgentToTaskHandlerAdapter = (
  agent: Agent,
  logger: Required<A2AServerOptions>["logger"],
  verbose: boolean
): A2ATaskHandler => {
  return async function* (
    taskId: string,
    input: any,
    _metadata: any | undefined,
    cancellationSignal?: AbortSignal
  ): AsyncGenerator<A2AStreamEvent> {
    const startTime = new Date().toISOString();

    const llmStreamHandler = (event: LLMStreamEvent) => {
      if (event.agentName === agent.name && !cancellationSignal?.aborted) {
        // Streaming updates are frequent; consider if A2A status should reflect every chunk
      }
    };

    try {
      const initialStatus: A2ATaskStatusUpdateEvent = {
        type: "statusUpdate",
        taskId,
        timestamp: startTime,
        status: {
          state: A2ATaskStates.RUNNING,
          message: "Processing request...",
        },
      };
      yield initialStatus;

      if (cancellationSignal?.aborted) {
        const event: A2ATaskStatusUpdateEvent = {
          type: "statusUpdate",
          taskId,
          timestamp: new Date().toISOString(),
          status: {
            state: A2ATaskStates.CANCELLED,
            message: "Task cancelled before execution.",
          },
          final: true,
        };
        yield event;
        return;
      }

      globalEventEmitter.on(
        AgentForgeEvents.LLM_STREAM_CHUNK,
        llmStreamHandler
      );

      const agentInputContent =
        typeof input === "string" ? input : JSON.stringify(input);

      if (verbose) {
        logger.info(
          `[A2AServer][Task:${taskId}][Agent:${agent.name}] LLM Input: ${agentInputContent}`
        );
      }

      const agentRunResult: AgentResult = await agent.run(agentInputContent, {
        stream: true,
      });

      if (verbose) {
        logger.info(
          `[A2AServer][Task:${taskId}][Agent:${agent.name}] LLM Output: ${agentRunResult.output}`
        );
      }

      globalEventEmitter.off(
        AgentForgeEvents.LLM_STREAM_CHUNK,
        llmStreamHandler
      );

      if (cancellationSignal?.aborted) {
        const event: A2ATaskStatusUpdateEvent = {
          type: "statusUpdate",
          taskId,
          timestamp: new Date().toISOString(),
          status: {
            state: A2ATaskStates.CANCELLED,
            message: "Task cancelled after execution finished.",
          },
          final: true,
        };
        yield event;
        return;
      }

      if (agentRunResult.metadata?.toolCalls) {
        for (const toolCall of agentRunResult.metadata.toolCalls) {
          if (cancellationSignal?.aborted) break;
          const toolMimeType =
            typeof toolCall.result === "string"
              ? "text/plain"
              : "application/json";
          const toolArtifactPart: A2AMessagePart = {
            text:
              typeof toolCall.result === "string"
                ? toolCall.result
                : JSON.stringify(toolCall.result),
            mimeType: toolMimeType,
          };
          const toolArtifact: A2AArtifact = {
            id: randomUUID(),
            name: `tool_${toolCall.toolName}_result.${toolMimeType === "application/json" ? "json" : "txt"}`,
            mimeType: toolMimeType,
            parts: [toolArtifactPart],
            createdAt: new Date().toISOString(),
          };
          const toolArtifactEvent: A2AArtifactUpdateEvent = {
            type: "artifactUpdate",
            taskId,
            timestamp: new Date().toISOString(),
            artifact: toolArtifact,
          };
          yield toolArtifactEvent;
        }
      }
      if (cancellationSignal?.aborted) {
        const event: A2ATaskStatusUpdateEvent = {
          type: "statusUpdate",
          taskId,
          timestamp: new Date().toISOString(),
          status: {
            state: A2ATaskStates.CANCELLED,
            message: "Task cancelled during artifact processing.",
          },
          final: true,
        };
        yield event;
        return;
      }

      const finalOutputArtifact: A2AArtifact = {
        id: randomUUID(),
        name: "final_output.txt",
        mimeType: "text/plain",
        parts: [
          {
            text: agentRunResult.output,
            mimeType: "text/plain",
          },
        ],
        createdAt: new Date(
          agentRunResult.metadata?.executionTime
            ? startTime
            : new Date().toISOString()
        ).toISOString(),
      };
      const finalOutputArtifactEvent: A2AArtifactUpdateEvent = {
        type: "artifactUpdate",
        taskId,
        timestamp: new Date().toISOString(),
        artifact: finalOutputArtifact,
      };
      yield finalOutputArtifactEvent;

      const completedStatus: A2ATaskStatusUpdateEvent = {
        type: "statusUpdate",
        taskId,
        timestamp: new Date().toISOString(),
        status: {
          state: A2ATaskStates.COMPLETED,
          message: "Task completed successfully.",
        },
        final: true,
      };
      yield completedStatus;
    } catch (error: any) {
      if (verbose) {
        logger.error(
          `[A2AServer][Task:${taskId}][Agent:${agent.name}] Error during agent.run: ${error.message}`,
          error.stack
        );
      }
      globalEventEmitter.off(
        AgentForgeEvents.LLM_STREAM_CHUNK,
        llmStreamHandler
      );
      const failedEvent: A2ATaskErrorEvent = {
        type: "error",
        taskId,
        timestamp: new Date().toISOString(),
        error: {
          code: A2AErrorCodes.INTERNAL_ERROR,
          message: error.message || "Agent execution failed.",
          data: { stack: error.stack, ...error },
        },
        final: true,
      };
      yield failedEvent;
    } finally {
      globalEventEmitter.off(
        AgentForgeEvents.LLM_STREAM_CHUNK,
        llmStreamHandler
      );
    }
  };
};
