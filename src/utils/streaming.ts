import { AgentForgeEvents } from "../types";
import { globalEventEmitter } from "./event-emitter";

// Keep track of streaming state to avoid duplication
const streamState = {
  pendingChunks: new Map<string, string>(),
  mostRecentSender: "",
  deduplicationCache: new Set<string>(), // To prevent duplicate messages
};

/**
 * Enables console-based visualization of streaming agent communications and LLM responses
 */
export function enableConsoleStreaming(): void {
  // Clear previous listeners to avoid duplicates if called multiple times
  globalEventEmitter.removeAllListeners(AgentForgeEvents.AGENT_COMMUNICATION);
  globalEventEmitter.removeAllListeners(AgentForgeEvents.LLM_STREAM_CHUNK);
  globalEventEmitter.removeAllListeners(AgentForgeEvents.LLM_STREAM_COMPLETE);
  globalEventEmitter.removeAllListeners(
    AgentForgeEvents.WORKFLOW_STEP_COMPLETE
  );
  globalEventEmitter.removeAllListeners(AgentForgeEvents.TEAM_TASK_COMPLETE);
  globalEventEmitter.removeAllListeners(AgentForgeEvents.EXECUTION_COMPLETE);

  // Reset streaming state
  streamState.pendingChunks.clear();
  streamState.mostRecentSender = "";
  streamState.deduplicationCache.clear();

  // Handle agent communication events
  globalEventEmitter.on(AgentForgeEvents.AGENT_COMMUNICATION, (event) => {
    try {
      const sender = event.sender;
      const recipient = event.recipient ? ` → ${event.recipient}` : "";

      // Create a unique key for this message to avoid duplicates
      const messageKey = `${sender}${recipient}:${event.message.substring(
        0,
        50
      )}`;

      // Skip if we've seen this message recently
      if (streamState.deduplicationCache.has(messageKey)) {
        return;
      }

      // Add to deduplication cache (with cleanup to prevent memory leaks)
      streamState.deduplicationCache.add(messageKey);
      if (streamState.deduplicationCache.size > 100) {
        // Keep only the 50 most recent messages to prevent unlimited growth
        const iterator = streamState.deduplicationCache.values();
        for (let i = 0; i < 50; i++) {
          const value = iterator.next().value;
          if (value !== undefined) {
            streamState.deduplicationCache.delete(value);
          }
        }
      }

      console.log(`\n<agents>${sender}${recipient}:</agents>`);
      console.log(event.message);
    } catch (error) {
      console.error("Error handling agent communication event:", error);
    }
  });

  // Handle LLM streaming chunks
  globalEventEmitter.on(AgentForgeEvents.LLM_STREAM_CHUNK, (event) => {
    try {
      const { agentName, chunk } = event;

      // If we're starting with a new agent, print the header
      if (agentName !== streamState.mostRecentSender) {
        // Flush any pending chunks from the previous agent
        if (streamState.pendingChunks.has(streamState.mostRecentSender)) {
          process.stdout.write("\n");
          streamState.pendingChunks.delete(streamState.mostRecentSender);
        }

        streamState.mostRecentSender = agentName;
        console.log(`\n<agents>${agentName}:</agents>`);
        process.stdout.write(""); // Start a new line for streaming
      }

      // Check if this is a tool call message (they typically start with '[Using tool')
      const isToolCallMessage = chunk?.startsWith("[Using tool") ?? false;

      // Accumulate chunks for this agent to detect and fix formatting issues
      const existingChunk = streamState.pendingChunks.get(agentName) || "";
      const updatedChunk = existingChunk + (chunk || "");
      streamState.pendingChunks.set(agentName, updatedChunk);

      // Print the chunk
      if (chunk) {
        // If it's a tool call message, print it differently
        if (isToolCallMessage) {
          process.stdout.write(`\n${chunk}\n`);
        } else {
          process.stdout.write(chunk);
        }
      }
    } catch (error) {
      console.error("Error handling LLM stream chunk:", error);
    }
  });

  // Handle stream completion
  globalEventEmitter.on(AgentForgeEvents.LLM_STREAM_COMPLETE, () => {
    try {
      // End the stream with a new line
      console.log("\n");

      // Reset state
      streamState.pendingChunks.clear();
      streamState.mostRecentSender = "";
    } catch (error) {
      console.error("Error handling LLM stream complete event:", error);
    }
  });

  // Handle workflow step completion events
  globalEventEmitter.on(AgentForgeEvents.WORKFLOW_STEP_COMPLETE, (event) => {
    try {
      if (event?.stepIndex !== undefined && event?.totalSteps) {
        console.log(
          `Step ${event.stepIndex + 1}/${event.totalSteps} completed (${
            event.duration
          }ms)`
        );
      }
    } catch (error) {
      console.error("Error handling workflow step complete event:", error);
    }
  });

  // Handle team task completion events
  globalEventEmitter.on(AgentForgeEvents.TEAM_TASK_COMPLETE, (event) => {
    try {
      if (event?.taskId && event?.agentName && event?.description) {
        console.log(
          `Task "${event.description}" completed by ${event.agentName}`
        );
      }
    } catch (error) {
      console.error("Error handling team task complete event:", error);
    }
  });

  // Handle execution completion events
  globalEventEmitter.on(AgentForgeEvents.EXECUTION_COMPLETE, (event) => {
    try {
      if (event?.type && event?.name) {
        const typeName =
          event.type.charAt(0).toUpperCase() + event.type.slice(1);
        console.log(`\n${typeName} "${event.name}" execution completed\n`);
      }
    } catch (error) {
      console.error("Error handling execution complete event:", error);
    }
  });
}
