import { Agent, AgentForge, LLM, Team } from "../index";
import { type AgentConfig, type LLMProvider } from "../types";
import { type A2AClientOptions, RemoteA2AAgent } from "../a2a";
import * as dotenv from 'dotenv';

// Load environment variables from .env file at the project root
dotenv.config();

// This example demonstrates a "manager" agent that uses a remote agent 
// (hosted by the a2a-server-example.ts) to accomplish a task.

async function runA2ATeamRealWorldExample() {
    console.log("INFO: Make sure the A2A Server (a2a-server-example.ts) is running on http://localhost:41241/a2a");

    const configuredProvider = (process.env.LLM_PROVIDER as LLMProvider);
    const configuredApiKey = process.env.LLM_API_KEY;
    const configuredModelForManager = process.env.LLM_API_MODEL!; // Manager might use a more powerful model by default

    if (!configuredApiKey) {
      console.error(
        "ERROR: LLM_API_KEY is not configured. " +
        "Please create a .env file in the project root (from .env.sample) " +
        "and add your LLM_API_KEY (and LLM_PROVIDER, LLM_MODEL)."
      );
      process.exit(1);
    }
    
    const llmProvider = new LLM(configuredProvider, { apiKey: configuredApiKey });

    // 2. AgentForge Instance
    const forge = new AgentForge(llmProvider);

    // 3. Define and Instantiate Manager Agent
    // The manager's objective is crucial. It needs to understand it has team members it can delegate to.
    // The Team class will make member agents (name & description) available to the manager's LLM.
    const managerAgentConfig: AgentConfig = {
        name: "OrchestrationManagerAgent",
        role: "Orchestration Manager",
        description: "A manager agent that delegates tasks to specialized assistant agents in its team.",
        objective: "Your goal is to answer the user\'s query by appropriately delegating tasks to your team members. You have a team member who is a general helpful assistant. Use that assistant for general queries.",
        model: configuredModelForManager,
    };
    const managerAgent = new Agent(managerAgentConfig, [], llmProvider); // No tools for manager, it delegates
    forge.registerAgent(managerAgent); // Register with forge if you were loading it through forge methods elsewhere

    // 4. Instantiate RemoteA2AAgent (connects to the server agent)
    let helpfulAssistantRemoteAgent: RemoteA2AAgent;

    try {
        const clientOptions: A2AClientOptions = {
            serverUrl: "http://localhost:41241/a2a",
        };
        // Create the remote agent client.
        // The agent's name, description, and other core properties will be fetched from the remote agent's card.
        // An optional second argument to RemoteA2AAgent.create() can be used as a localAlias to override the fetched name.
        // Here, we are omitting it, so the name defined on the server will be used.
        helpfulAssistantRemoteAgent = await RemoteA2AAgent.create(
            clientOptions
            // No localAlias provided; name will be fetched from the server.
            // Example of providing an alias:
            // helpfulAssistantRemoteAgent = await RemoteA2AAgent.create(
            // clientOptions,
            // "MyLocallyNamedAssistant"
            // );
        );
        console.log(`INFO: Remote agent '${helpfulAssistantRemoteAgent.name}' initialized. Description: ${helpfulAssistantRemoteAgent.description}`);
    } catch (error) {
        console.error("ERROR: Failed to create RemoteA2AAgent.");
        if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
        } else {
            console.error("An unknown error occurred:", error);
        }
        process.exit(1);
    }

    // 5. Create a Team
    // The Team class will make the RemoteHelpfulAssistant (by its name and description)
    // available to the OrchestrationManagerAgent's LLM context.
    const team = new Team(managerAgent).addAgent(helpfulAssistantRemoteAgent);
    
    // 6. Define a task for the Team (which the Manager should delegate)
    const taskForTeam = "What is the capital of France?";
    console.log(`INFO: Sending task to Team (Manager: ${managerAgent.name}): "${taskForTeam}"`);

    try {
        // Running the team. The manager agent will get the task and details of team members.
        // Its LLM should decide to delegate to "RemoteHelpfulAssistant".
        const result = await team.run(taskForTeam, { verbose: true}); // verbose true to see manager's reasoning

        console.log("\n--- Team Final Output ---");
        if (result.output) {
            console.log(result.output);
        } else {
            console.log("(Team did not provide a final textual output)");
        }

        // Metadata from the manager's perspective
        if (result.metadata?.toolCalls && result.metadata.toolCalls.length > 0) {
            console.log("\n(Manager Agent tool calls/delegations during its execution - if any direct tools were used by manager):");
            result.metadata.toolCalls.forEach(tc => {
                console.log(`  Tool: ${tc.toolName}, Params: ${JSON.stringify(tc.parameters)}, Result: ${tc.result}`);
            });
        }

    } catch (error) {
        console.error("\n--- ERROR during Team execution ---");
        if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
        } else {
            console.error("An unknown error occurred:", error);
        }
        process.exit(1);
    }

    console.log("\nTeam example finished.");
}

runA2ATeamRealWorldExample(); 