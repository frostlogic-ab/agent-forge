import { randomUUID } from "node:crypto";
import {
  Agent,
  type AgentRunOptions as CoreAgentRunOptions,
} from "../../core/agent";
import type {
  AgentConfig,
  AgentResult,
  LLMStreamEvent,
  ToolCall,
} from "../../types";
import { AgentForgeEvents } from "../../types/index";
import { globalEventEmitter } from "../../utils/event-emitter";
import { A2ATaskStates } from "../common/A2AProtocol";
import type {
  A2AAgentCard,
  A2AArtifactUpdateEvent,
  A2AMessage,
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
import { A2AClient } from "./A2AClient";
import type { A2AClientOptions } from "./types";

// Define AgentRunOptions for RemoteA2AAgent, extending the one from core Agent
export interface RemoteAgentRunOptions extends CoreAgentRunOptions {}

export class RemoteA2AAgent extends Agent {
  private a2aClient: A2AClient;
  private taskStatusRetries: number;
  private taskStatusRetryDelay: number;

  // Private constructor to be called by the static factory method
  private constructor(
    configForSuper: AgentConfig,
    clientOptions: A2AClientOptions
  ) {
    // Tools and LLM provider for the superclass are not directly used by RemoteA2AAgent.
    // It delegates all core agent logic (LLM calls, tool execution) to the remote A2A server.
    // Passing undefined for llmProvider to super, as RemoteA2AAgent doesn't use a local LLM.
    super(configForSuper, [], undefined);
    this.a2aClient = new A2AClient(clientOptions);
    this.taskStatusRetries = clientOptions.taskStatusRetries ?? 10;
    this.taskStatusRetryDelay = clientOptions.taskStatusRetryDelay ?? 1000;
  }

  public static async create(
    clientOptions: A2AClientOptions,
    localAlias?: string // Optional alias for this instance
  ): Promise<RemoteA2AAgent> {
    const tempClient = new A2AClient(clientOptions);
    const agentCard: A2AAgentCard | null = await tempClient.getAgentCard();

    if (!agentCard) {
      throw new Error(
        `Could not fetch agent card from ${clientOptions.serverUrl}`
      );
    }

    // Construct the AgentConfig for the super() call using fetched card details
    const configForSuper: AgentConfig = {
      name: localAlias || agentCard.name || "RemoteAgent", // Use alias, then card name, then default
      description: agentCard.description || "A remote agent accessed via A2A.",
      role: agentCard.role || "Remote Assistant",
      objective: agentCard.objective || "To fulfill tasks delegated via A2A.",
      model: agentCard.model || "remote-a2a", // Model from card or a generic identifier
      // Other AgentConfig fields like temperature, maxTokens are not directly relevant
      // for the proxy itself. Tools are also handled remotely.
    };

    return new RemoteA2AAgent(configForSuper, clientOptions);
  }

  // Override the run method to delegate to the remote A2A agent
  override async run(
    input: string, // Input is now a simple string as per Agent.run signature
    options?: RemoteAgentRunOptions
  ): Promise<AgentResult> {
    const taskId = randomUUID();
    const a2aMessage: A2AMessage = {
      // Ensure A2AMessage is compatible with Message from "../../types"
      // If A2AMessage needs 'parts', then content needs to be structured accordingly
      // For simplicity, assuming A2AMessage directly uses 'content' like base Message
      role: "user",
      content: input,
    };

    const startTime = Date.now();
    let finalOutput = "";
    const toolCalls: ToolCall[] = [];
    let accumulatedLlmResponseForAgentResult = "";

    // Define taskSendParams once, modify for streaming if needed
    const baseTaskSendParams: A2ATaskSendParams = {
      id: taskId,
      input: a2aMessage,
    };

    try {
      if (options?.stream) {
        const streamingTaskSendParams: A2ATaskSendParams = {
          ...baseTaskSendParams,
          stream: true, // Explicitly enable streaming for the task creation
        };
        // Ensure the task is created on the server with streaming enabled
        const initialTask: A2ATaskSendResult = await this.a2aClient.sendTask(
          streamingTaskSendParams
        );
        if (!initialTask || !initialTask.id) {
          throw new Error(
            "Failed to send task (with streaming) to remote agent or received invalid response."
          );
        }

        // Track whether we received a final output artifact
        let finalOutputFromArtifact = "";
        let hasReceivedFinalOutput = false;

        // Now subscribe to the events for the task ID
        const stream = this.a2aClient.sendTaskSubscribe(
          streamingTaskSendParams
        ); // Pass full params
        for await (const event of stream) {
          if (isCancelledDuringStream(options)) {
            throw new Error(
              "Remote agent task cancelled by client during stream."
            );
          }
          this.processA2AEvent(
            event,
            toolCalls,
            (chunk) => {
              accumulatedLlmResponseForAgentResult += chunk;
              globalEventEmitter.emit(AgentForgeEvents.LLM_STREAM_CHUNK, {
                agentName: this.name,
                chunk: chunk,
                isDelta: true,
                isComplete: false,
              } as LLMStreamEvent);
            },
            (finalOutput) => {
              // Callback for when we receive final output artifact
              finalOutputFromArtifact = finalOutput;
              hasReceivedFinalOutput = true;
            }
          );
          if (
            (event as A2ATaskStatusUpdateEvent).final ||
            (event as A2ATaskErrorEvent).final
          ) {
            if ((event as A2ATaskErrorEvent).error) {
              throw new Error(
                `Remote agent task failed: ${(event as A2ATaskErrorEvent).error.message}`
              );
            }
            break;
          }
        }

        // Prefer final output from artifact if available, otherwise use accumulated response
        finalOutput = hasReceivedFinalOutput
          ? finalOutputFromArtifact
          : accumulatedLlmResponseForAgentResult;
      } else {
        // Non-streaming: send task without stream flag (or stream:false implicitly)
        const initialTask: A2ATaskSendResult =
          await this.a2aClient.sendTask(baseTaskSendParams);
        if (!initialTask || !initialTask.id) {
          throw new Error(
            "Failed to send task to remote agent or received invalid response."
          );
        }

        let currentTask: A2ATaskGetResult = initialTask;
        let attempts = 0;
        const maxAttempts = this.taskStatusRetries;

        while (attempts < maxAttempts) {
          if (isCancelledDuringStream(options)) {
            throw new Error(
              "Remote agent task cancelled by client during polling."
            );
          }
          const getParams: A2ATaskGetParams = { id: taskId };
          currentTask = await this.a2aClient.getTask(getParams);
          if (!currentTask)
            throw new Error("Failed to get task status from remote agent.");

          if (
            currentTask.status.state === A2ATaskStates.COMPLETED ||
            currentTask.status.state === A2ATaskStates.FAILED ||
            currentTask.status.state === A2ATaskStates.CANCELLED
          ) {
            break;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, this.taskStatusRetryDelay)
          );
          attempts++;
        }

        if (!currentTask)
          throw new Error("Remote agent task status could not be determined.");

        if (currentTask.status.state === A2ATaskStates.FAILED) {
          throw new Error(
            currentTask.status.message ||
              "Remote agent task failed without a message."
          );
        }
        if (currentTask.status.state === A2ATaskStates.CANCELLED) {
          throw new Error(
            currentTask.status.message || "Remote agent task was canceled."
          );
        }
        if (currentTask.status.state !== A2ATaskStates.COMPLETED) {
          if (attempts >= maxAttempts) {
            const timeoutSeconds =
              (this.taskStatusRetryDelay * maxAttempts) / 1000;
            throw new Error(
              `Polling for remote agent task status timed out after ${maxAttempts} attempts (${timeoutSeconds}s). Final state: ${currentTask.status.state}`
            );
          }
          throw new Error(
            `Remote agent task did not complete for an unexpected reason. Final state: ${currentTask.status.state}`
          );
        }

        // Extract final output and tool calls from artifacts
        // Prefer a dedicated "final_output" artifact if available
        let outputArtifactFound = false;
        currentTask.artifacts?.forEach((artifact) => {
          if (
            artifact.name === "final_output.txt" ||
            (artifact.mimeType === "text/plain" && !outputArtifactFound)
          ) {
            finalOutput = artifact.parts.map((p) => p.text).join("\n");
            outputArtifactFound = true;
          }
          if (artifact.name?.startsWith("tool_call_")) {
            // Assuming a convention for tool call artifacts
            try {
              const toolCallData = JSON.parse(
                artifact.parts.map((p) => p.text).join("")
              );
              if (
                toolCallData.toolName &&
                toolCallData.parameters &&
                toolCallData.result !== undefined
              ) {
                toolCalls.push({
                  toolName: toolCallData.toolName,
                  parameters: toolCallData.parameters,
                  result: toolCallData.result,
                });
              }
            } catch (e) {
              console.warn(
                `Could not parse tool call artifact: ${artifact.name}`,
                e
              );
            }
          }
        });
        // Fallback to status message content if no explicit output artifact
        if (!outputArtifactFound && currentTask.status.message) {
          finalOutput = currentTask.status.message;
        }
      }
    } catch (error) {
      console.error(
        `[RemoteA2AAgent:${this.name}] Error during run for task input "${input.substring(0, 50)}...":`,
        error
      );

      // Re-throw the error to be handled by the caller of agent.run()
      // It's generally better for the caller to decide how to handle failed agent runs.
      if (error instanceof Error) {
        // Add more context if desired, or just re-throw
        // error.message = `RemoteA2AAgent (${this.name}) failed: ${error.message}`;
        throw error;
      }
      throw new Error(
        `RemoteA2AAgent (${this.name}) encountered an unknown error: ${String(error)}`
      );
    }

    if (options?.stream) {
      globalEventEmitter.emit(AgentForgeEvents.LLM_STREAM_CHUNK, {
        agentName: this.name,
        chunk: "",
        isDelta: false,
        isComplete: true,
      } as LLMStreamEvent);
    }

    return {
      output: finalOutput,
      metadata: {
        executionTime: Date.now() - startTime,
        modelName: this.model, // Use the model from the agent's own config
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    };
  }

  private processA2AEvent(
    event: A2AStreamEvent,
    toolCalls: ToolCall[], // Allow modification
    emitChunk: (chunk: string) => void,
    emitFinalOutput?: (finalOutput: string) => void
  ) {
    if ("status" in event) {
      const statusEvent = event as A2ATaskStatusUpdateEvent;
      if (
        statusEvent.status.message &&
        statusEvent.status.state === A2ATaskStates.RUNNING
      ) {
        emitChunk(statusEvent.status.message);
      }
    } else if ("artifact" in event) {
      const artifactEvent = event as A2AArtifactUpdateEvent;
      if (artifactEvent.artifact.name?.startsWith("tool_call_")) {
        try {
          const toolCallData = JSON.parse(
            artifactEvent.artifact.parts.map((p) => p.text).join("")
          );
          if (
            toolCallData.toolName &&
            toolCallData.parameters &&
            toolCallData.result !== undefined
          ) {
            toolCalls.push({
              // Modify the passed-in toolCalls array
              toolName: toolCallData.toolName,
              parameters: toolCallData.parameters,
              result: toolCallData.result,
            });
          }
        } catch (e) {
          console.warn(
            `Could not parse tool call artifact during stream: ${artifactEvent.artifact.name}`,
            e
          );
        }
      } else if (
        artifactEvent.artifact.name === "final_output.txt" ||
        (artifactEvent.artifact.mimeType === "text/plain" &&
          artifactEvent.artifact.name?.includes("final"))
      ) {
        // Handle final output artifacts by emitting their content as chunks
        const finalContent = artifactEvent.artifact.parts
          .map((p) => p.text)
          .join("");
        if (finalContent) {
          emitChunk(finalContent);
          if (emitFinalOutput) {
            emitFinalOutput(finalContent);
          }
        }
      }
      // Other artifacts are handled above or can be ignored for streaming
    }
  }
}

// Helper function (can be moved to a utility if shared)
function isCancelledDuringStream(options?: RemoteAgentRunOptions): boolean {
  // This is a placeholder. Real cancellation would involve an AbortSignal
  // or similar mechanism passed down and checked.
  // For now, it demonstrates where such a check would be.
  if (options) {
    // e.g. if (options.abortSignal?.aborted) return true;
  }
  return false;
}
