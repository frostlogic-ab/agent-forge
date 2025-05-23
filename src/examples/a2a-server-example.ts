import { Agent } from "../core/agent";
import type { AgentConfig, LLMProvider } from "../types";
import { a2aServer } from "../a2a/decorators";
import { LLM } from "../llm/llm";
import * as dotenv from 'dotenv';

// Load environment variables from .env file at the project root
dotenv.config();

/**
 * Example of using the @a2aServer decorator to expose an agent via A2A protocol.
 * The server will start automatically when the agent is instantiated.
 *
 * @example
 * @a2aServer({ port: 41241, host: "localhost", endpoint: "/a2a", verbose: true })
 * class HelpfulAssistantAgent extends Agent { ... }
 */
@a2aServer({ port: 41241, host: "localhost", endpoint: "/a2a", verbose: true })
class HelpfulAssistantAgent extends Agent {}

async function runA2AServer() {
    const configuredProvider = (process.env.LLM_PROVIDER as LLMProvider) || "openai";
    const configuredApiKey = process.env.LLM_API_KEY;
    const configuredModel = process.env.LLM_API_MODEL!;

    if (!configuredApiKey) {
      console.error(
        "LLM_API_KEY is not configured. " +
        "Please create a .env file in the project root (from .env.sample) " +
        "and add your LLM_API_KEY (and optionally LLM_PROVIDER, LLM_MODEL)."
      );
      process.exit(1);
    }

    const agentConfig: AgentConfig = {
        name: "HelpfulAssistantAgent",
        role: "Helpful Assistant",
        description: "An AI assistant that tries to be helpful, hosted via A2A.",
        objective: "To answer questions and perform tasks as a helpful AI assistant.",
        model: configuredModel,
    };

    const llmConfig = { apiKey: configuredApiKey };
    const llmProvider = new LLM(configuredProvider, llmConfig);

    // Instantiating the agent will start the A2A server automatically
    // (The decorator handles server startup)
    const helpfulAgent = new HelpfulAssistantAgent(agentConfig, [], llmProvider);

    console.log("A2A server started. Press Ctrl+C to stop the server.");
    process.on('SIGINT', async () => {
        console.log("\nShutting down A2A server...");
        const agentWithServer = helpfulAgent as any;
        if (agentWithServer.a2aServer) {
            await agentWithServer.a2aServer.stop();
            console.log("Server stopped.");
        }
        process.exit(0);
    });
}

runA2AServer(); 