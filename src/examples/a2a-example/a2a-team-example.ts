import { AgentForge, LLM, Team } from "../../index";
import { type LLMProvider } from "../../types";
import * as dotenv from 'dotenv';
import { RemoteHelpfulAssistant } from "./agents/remote.agent";
import { ManagerAgent } from "./agents/manager.agent";
import { llmProvider } from "./provider";

// Load environment variables from .env file at the project root
dotenv.config();

async function runA2ATeamRealWorldExample() {
    console.log("INFO: Make sure the A2A Server (a2a-server-example.ts) is running on http://localhost:41241/a2a");

    const forge = new AgentForge(llmProvider);

    const managerAgent = new ManagerAgent(); 
    forge.registerAgent(managerAgent); // Register with forge if you were loading it through forge methods elsewhere

    // 4. Use the decorated class to create the remote agent (returns a Promise)
    let helpfulAssistantRemoteAgent: RemoteHelpfulAssistant;
    try {
        // Type assertion to 'any' to allow zero-argument construction; safe because decorator intercepts
        helpfulAssistantRemoteAgent = await new RemoteHelpfulAssistant();
        console.log(`INFO: Remote agent '${helpfulAssistantRemoteAgent.name}' initialized. Description: ${helpfulAssistantRemoteAgent.description}`);
    } catch (error) {
        console.error(`ERROR: Failed to create RemoteHelpfulAssistant via @a2aClient: ${error}`);
        process.exit(1);
    }

    const team = new Team(managerAgent).addAgent(helpfulAssistantRemoteAgent);

    try {
        // Running the team. The manager agent will get the task and details of team members.
        // Its LLM should decide to delegate to "RemoteHelpfulAssistant".
        const result = await team.run("What is the capital of France?", { verbose: true}); // verbose true to see manager's reasoning
        console.log(result.output);
    } catch (error) {
        console.error("An unknown error occurred:", error);
        process.exit(1);
    }
}

runA2ATeamRealWorldExample(); 