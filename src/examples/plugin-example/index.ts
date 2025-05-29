import * as dotenv from "dotenv";
import {
  forge,
  llmProvider,
  agent,
  plugin,
  tool,
  readyForge,
  AgentForge,
  Agent,
  LLMProvider,
  LoggingPlugin,
  MetricsPlugin,
  WebSearchTool,
  type PluginMetrics,
  type Plugin,
} from "../../index";
import { SecurityPlugin } from "./plugins/security-plugin";
import { CachingPlugin } from "./plugins/caching-plugin";

dotenv.config();

// Define our agents
@tool(WebSearchTool)
@agent({
  name: "ResearchAgent",
  role: "Research Specialist",
  description: "An agent that can search the web and analyze information.",
  objective: "Find accurate and relevant information on requested topics.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.4,
})
class ResearchAgent extends Agent {}

@agent({
  name: "SummarizerAgent",
  role: "Summarizer",
  description: "An agent that creates concise summaries.",
  objective: "Create clear, concise summaries of complex information.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.3,
})
class SummarizerAgent extends Agent {}

@agent({
  name: "ManagerAgent",
  role: "Team Manager",
  description: "An agent that coordinates other agents.",
  objective: "Effectively delegate tasks and synthesize results.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.7,
})
class ManagerAgent extends Agent {}

// Configure the forge with plugins
@plugin(new LoggingPlugin())
@plugin(new MetricsPlugin())
@plugin(new SecurityPlugin())
@plugin(new CachingPlugin())
@llmProvider(process.env.LLM_PROVIDER as LLMProvider, {
  apiKey: process.env.LLM_API_KEY,
})
@forge()
class PluginExample {
  static forge: AgentForge;

  static async run() {
    // Register our agents
    const agents = [
      new ManagerAgent(),
      new ResearchAgent(),
      new SummarizerAgent(),
    ];

    // Initialize the framework with agents
    await readyForge(PluginExample, agents);
    await PluginExample.forge.initialize();

    console.log("🚀 Plugin Example Starting\n");

    console.log("\n📊 Plugin Status:");
    const enabledPlugins = PluginExample.forge.getPluginManager().getEnabledPlugins();
    enabledPlugins.forEach((plugin: Plugin) => {
      console.log(`  ✅ ${plugin.name} v${plugin.version} (Priority: ${plugin.priority})`);
    });

    console.log("\n🔍 Running individual agent tasks...\n");

    // Test individual agent runs (with plugin hooks)
    try {
      const researchResult = await PluginExample.forge.runAgent(
        "ResearchAgent",
        "What are the latest developments in quantum computing?"
      );

      const summaryResult = await PluginExample.forge.runAgent(
        "SummarizerAgent",
        `Please summarize this research: ${researchResult.output}`
      );

      console.log("\n📈 Final Results:");
      console.log("Research Result:", researchResult.output.substring(0, 200) + "...");
      console.log("Summary Result:", summaryResult.output);

    } catch (error) {
      console.error("❌ Error during agent execution:", error);
      process.exit(1);
    }

    console.log("\n🏢 Running team workflow...\n");

    // Test team workflow (with plugin hooks)
    try {
      const team = PluginExample.forge
        .createTeam("ManagerAgent", "Research Team", "A team that researches and summarizes")
        .addAgents(agents);

      const teamResult = await team.run(
        "Research the impact of AI on software development and provide a comprehensive summary.",
        { verbose: true }
      );

      console.log("\n🎯 Team Result:", teamResult.output);

    } catch (error) {
      console.error("❌ Error during team execution:", error);
      process.exit(1);
    }

    // Display metrics collected by the MetricsPlugin
    console.log("\n📊 Plugin Metrics:");
    const metricsPlugin = PluginExample.forge.getPluginManager().getPlugin('metrics') as MetricsPlugin;
    if (metricsPlugin) {
      const metrics: PluginMetrics = metricsPlugin.getMetrics();
      console.log(`  🏃 Agent Runs: ${metrics.agentRuns}`);
      console.log(`  ⏱️  Total Execution Time: ${metrics.totalExecutionTime}ms`);
      console.log(`  ⚡ Average Execution Time: ${metricsPlugin.getAverageExecutionTime().toFixed(2)}ms`);
      console.log(`  🔧 Tool Calls: ${metrics.toolCalls}`);
      console.log(`  ❌ Errors: ${metrics.errors}`);
      console.log(`  🎫 Total Tokens: ${metricsPlugin.getTotalTokens()}`);
      console.log(`    📝 Prompt Tokens: ${metrics.tokenUsage.prompt}`);
      console.log(`    💬 Completion Tokens: ${metrics.tokenUsage.completion}`);
    }

    // Demonstrate plugin management
    console.log("\n🔧 Plugin Management Demo:");
    
    // Disable and re-enable a plugin
    const loggingPlugin = PluginExample.forge.getPluginManager().getPlugin('logging');
    if (loggingPlugin) {
      console.log(`  📝 Logging Plugin Status: ${loggingPlugin.enabled ? 'Enabled' : 'Disabled'}`);
      loggingPlugin.disable();
      console.log(`  📝 Logging Plugin Status: ${loggingPlugin.enabled ? 'Enabled' : 'Disabled'}`);
      loggingPlugin.enable();
      console.log(`  📝 Logging Plugin Status: ${loggingPlugin.enabled ? 'Enabled' : 'Disabled'}`);
    }

    // Shutdown framework
    await PluginExample.forge.shutdown();
    console.log("\n✅ Plugin Example Complete");
    process.exit(0);
  }
}

// Run the example
if (require.main === module) {
  PluginExample.run().catch(console.error);
}

export { PluginExample }; 