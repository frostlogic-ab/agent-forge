import { configuredApiKey } from "./provider";
import { forge, llmProvider } from "../../core/decorators";
import { configuredProvider } from "./provider";
import { ensureDockerContainers } from "./setup-docker";
import { AgentForge } from "../../core/agent-forge";
import { AnalystAgent } from "./agents/analyst.agent";
import { ManagerAgent } from "./agents/manager.agent";
import { WriterAgent } from "./agents/writer.agent";
import { ResearchAgent } from "./agents/research.agent";

@llmProvider(configuredProvider, {apiKey: configuredApiKey})
@forge()
class StockAnalysisTeam {
  static forge: AgentForge;

  static async run() {
    await ensureDockerContainers();
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Ensure forge is initialized
    new StockAnalysisTeam();

    const agents = [
      new AnalystAgent(),
      new WriterAgent(),
      new ManagerAgent(),
      new ResearchAgent(),
    ]

    StockAnalysisTeam.forge.registerAgents(agents);

    const team = StockAnalysisTeam.forge.createTeam("Team manager", "Stock Analysis Team", "A team of agents to analyze stock prices")
    team.addAgents(agents);

    const report = await team.run("Write a report on the stock price of Apple", { verbose: true });
    console.log(report);
  }
}

StockAnalysisTeam.run();