import { forge, llmProvider } from "../../core/decorators";
import { ManagerAgent } from "./agents/manager.agent";
import { ResearcherAgent } from "./agents/researcher.agent";
import { SummarizerAgent } from "./agents/summarizer.agent";
import { RemoteHelpfulAssistant } from "./agents/remote.agent";
import { AgentForge, readyForge } from "../../core/agent-forge";
import { configuredProvider, configuredApiKey } from "./provider";
import { Visualizer } from "../../";

@Visualizer()
@llmProvider(configuredProvider, { apiKey: configuredApiKey })
@forge()
class TeamExample {
  // Static property to store the AgentForge instance
  static forge: AgentForge;

  static async run() {
    try {
      // Pass agent classes to readyForge - it will handle instantiation
      const agentClasses = [ManagerAgent, ResearcherAgent, SummarizerAgent, RemoteHelpfulAssistant];
      await readyForge(TeamExample, agentClasses);

      const team = TeamExample.forge.createTeam("ManagerAgent", "Team", "A team of agents that can help with a variety of tasks.")
        .addAgent(TeamExample.forge.getAgent("ResearcherAgent"))
        .addAgent(TeamExample.forge.getAgent("SummarizerAgent"))
        .addAgent(TeamExample.forge.getAgent("RemoteHelpfulAssistant"));

      const result = await team.run("What is the status of AI in 2025? Make a full report and summarized", { verbose: true });
      console.log(result);
    } catch (error) {
      console.error("An error occurred:", error);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  TeamExample.run().catch(console.error);
} 
