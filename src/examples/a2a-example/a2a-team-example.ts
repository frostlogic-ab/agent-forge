import { forge, llmProvider } from "../../core/decorators";
import { ManagerAgent } from "./agents/manager.agent";
import { ResearcherAgent } from "./agents/researcher.agent";
import { SummarizerAgent } from "./agents/summarizer.agent";
import { RemoteHelpfulAssistant } from "./agents/remote.agent";
import * as dotenv from 'dotenv';
import { LLMProvider } from "../../types";
import { AgentForge } from "../../core/agent-forge";
import { Agent } from "../../core/agent";
import { configuredProvider, configuredApiKey } from "./provider";
// Load environment variables from .env file at the project root
dotenv.config();

@llmProvider(configuredProvider, { apiKey: configuredApiKey })
@forge()
class TeamExample {
  // Static property to store the AgentForge instance
  static forge: AgentForge;

  static async run() {
    new TeamExample();
  
    let helpfulAssistantRemoteAgent: RemoteHelpfulAssistant;
    try {
      helpfulAssistantRemoteAgent = await new RemoteHelpfulAssistant();
      console.log(`INFO: Remote agent '${helpfulAssistantRemoteAgent.name}' initialized. Description: ${helpfulAssistantRemoteAgent.description}`);
    } catch (error) {
      console.error(`ERROR: Failed to create RemoteHelpfulAssistant via @a2aClient: ${error}`);
      process.exit(1);
    }
    const agents = [new ManagerAgent(), new ResearcherAgent(), new SummarizerAgent()];

    TeamExample.forge.registerAgents(agents);

    const team = TeamExample.forge.createTeam("ManagerAgent", "Team", "A team of agents that can help with a variety of tasks.")
      .addAgents(agents)
      .addAgent(helpfulAssistantRemoteAgent);
    try {
      const result = await team.run("What is the status of AI in 2025? Make a full report and summarzied", { verbose: true });
      console.log(result);
    } catch (error) {
      console.error("An unknown error occurred:", error);
      process.exit(1);
    }
  }
}

TeamExample.run(); 