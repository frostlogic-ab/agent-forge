import type { AgentConfig, LLMProvider } from "../../types";
import { LLM } from "../../llm/llm";
import * as dotenv from 'dotenv';
import { HelpfulAssistantAgent } from "./agents/helpful-assistant.agent";
// Load environment variables from .env file at the project root
dotenv.config();

async function runA2AServer() {
     
    // Instantiating the agent will start the A2A server automatically
    // (The decorator handles server startup)
    new HelpfulAssistantAgent();

    console.log("A2A server started. Press Ctrl+C to stop the server.");

}

runA2AServer(); 