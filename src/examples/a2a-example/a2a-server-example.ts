import { HelpfulAssistantAgent } from "./agents/helpful-assistant.agent";

async function runA2AServer() {
     
    // Instantiating the agent will start the A2A server automatically
    // (The decorator handles server startup)
    new HelpfulAssistantAgent();

    console.log("A2A servers for all agents started. Press Ctrl+C to stop.");

}

runA2AServer(); 