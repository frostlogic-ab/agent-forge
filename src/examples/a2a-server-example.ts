import { Agent } from "../core/agent";
import type { AgentConfig, LLMProvider } from "../types";
import { A2AServer } from "../a2a"; // Import A2AServer from the main A2A export
import { defaultAgentToTaskHandlerAdapter } from "../a2a/server/agentAdapter"; 
import { LLM } from "../llm/llm"; 
import * as dotenv from 'dotenv';

// Load environment variables from .env file at the project root
dotenv.config();

async function runA2AServer() {
    const configuredProvider = (process.env.LLM_PROVIDER as LLMProvider) || "openai";
    const configuredApiKey = process.env.LLM_API_KEY;
    const configuredModel = process.env.LLM_API_MODEL!; // Default model adjustment

    if (!configuredApiKey) {
      console.error(
        "LLM_API_KEY is not configured. " +
        "Please create a .env file in the project root (from .env.sample) " +
        "and add your LLM_API_KEY (and optionally LLM_PROVIDER, LLM_MODEL)."
      );
      process.exit(1);
    }

    // 1. Define an agent-forge agent
    const agentConfig: AgentConfig = {
        name: "HelpfulAssistantAgent",
        role: "Helpful Assistant",
        description: "An AI assistant that tries to be helpful, hosted via A2A.",
        objective: "To answer questions and perform tasks as a helpful AI assistant.",
        model: configuredModel,
    };

    const llmConfig = { apiKey: configuredApiKey };
    const llmProvider = new LLM(configuredProvider, llmConfig);

    const helpfulAgent = new Agent(agentConfig, [], llmProvider);

    // 2. Configure and instantiate A2AServer
    const serverOptions = {
        port: 41241,
        host: "localhost",
        endpoint: "/a2a",
        verbose: true,
    };

    const a2aServer = new A2AServer(
        helpfulAgent, 
        serverOptions, 
        defaultAgentToTaskHandlerAdapter
    );

    // 3. Start the server
    try {
        await a2aServer.start();
        console.log("Press Ctrl+C to stop the server.");

        process.on('SIGINT', async () => {
            console.log("\nShutting down A2A server...");
            await a2aServer.stop();
            console.log("Server stopped.");
            process.exit(0);
        });

    } catch (error) {
        console.error("Failed to start A2A server:", error);
        process.exit(1);
    }
}

runA2AServer(); 