import * as dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { AgentForge, LLM, loadAgentFromYaml, Agent } from "../index";
import { LLMProvider } from "../types";

// Load environment variables from .env file at the project root
dotenv.config();

// LLM Configuration (global for this example)
const provider = (process.env.LLM_PROVIDER as LLMProvider) || "openai";
const apiKey = process.env.LLM_API_KEY;
const modelFromEnv = process.env.LLM_API_MODEL!;

// Create example YAML files if they don't exist
async function createExampleYamlFiles() {
  const examplesDir = path.join(__dirname, "yaml");
  try {
    await fs.mkdir(examplesDir, { recursive: true });

    // Research agent YAML - ensure model field uses a generic placeholder or is omitted if LLM_MODEL is to be the sole source
    // For this refactor, we'll let LLM_MODEL override, so YAML model can be a default or placeholder.
    const researchAgentYaml = `
name: Researcher
role: Research Specialist
description: A specialized agent for gathering and analyzing information
objective: Find accurate and relevant information on requested topics
model: ${modelFromEnv} # Uses model from .env or its default
temperature: 0.7
`;
// Removed tools from this basic YAML example, they can be added if specific tool integration is tested here.

    const summaryAgentYaml = `
name: Summarizer
role: Concise Summarizer
description: An agent that specializes in distilling information into clear summaries
objective: Create concise, accurate summaries of complex information
model: ${modelFromEnv} # Uses model from .env or its default
temperature: 0.5
`;

    const managerAgentYaml = `
name: Manager
role: Team Manager
description: An agent that coordinates other agents to complete complex tasks
objective: Effectively delegate tasks and synthesize results from specialized agents
model: ${modelFromEnv} # Uses model from .env or its default
temperature: 0.7
`;
    await fs.writeFile(path.join(examplesDir, "researcher.yaml"), researchAgentYaml);
    await fs.writeFile(path.join(examplesDir, "summarizer.yaml"), summaryAgentYaml);
    await fs.writeFile(path.join(examplesDir, "manager.yaml"), managerAgentYaml);
    console.log("Example YAML files written/updated with current model configuration.");
  } catch (error) {
    console.error("Error creating example YAML files:", error);
  }
}

async function main() {
  if (!apiKey) {
    console.error(
        `Error: LLM_API_KEY environment variable not set. ` +
        "Please create a .env file in the project root (from .env.sample) " +
        "and add your LLM_API_KEY (and optionally LLM_PROVIDER, LLM_MODEL)."
    );
    process.exit(1);
  }

  try {
    await createExampleYamlFiles(); // Create/update YAML files with current model

    const llmProviderInstance = new LLM(provider, { apiKey });
    const forge = new AgentForge(llmProviderInstance);

    // Load agents from YAML files
    const examplesDir = path.join(__dirname, "yaml");
    const researcherYamlPath = path.join(examplesDir, "researcher.yaml");
    const summarizerYamlPath = path.join(examplesDir, "summarizer.yaml");
    const managerYamlPath = path.join(examplesDir, "manager.yaml");

    console.log("Loading agents from YAML files...");

    // When loading from YAML, the model in YAML takes precedence.
    // If YAML model is missing, AgentForge/Agent might have a fallback or require it.
    // For consistency with LLM_MODEL env var, we ensure YAMLs are written with it.
    const researchAgent = await loadAgentFromYaml(researcherYamlPath);
    researchAgent.setLLMProvider(llmProviderInstance);

    const summaryAgent = await loadAgentFromYaml(summarizerYamlPath);
    summaryAgent.setLLMProvider(llmProviderInstance);

    const managerAgentLoaded = await loadAgentFromYaml(managerYamlPath);
    managerAgentLoaded.setLLMProvider(llmProviderInstance);
    
    // If an agent is loaded from YAML, its 'model' field from YAML is used.
    // If we want to *override* the YAML model with LLM_MODEL from .env, we'd have to do it post-load:
    // researchAgent.updateConfig({ model: modelFromEnv }); // Example of overriding post-load

    forge.registerAgent(researchAgent);
    forge.registerAgent(summaryAgent);
    forge.registerAgent(managerAgentLoaded);

    console.log("Agents loaded successfully:");
    forge.getAgents().forEach((agent) => {
      console.log(`- ${agent.name} (${agent.role}): Model: ${agent.model}`); // Display model
    });

    // Method 1: Run a single agent
    console.log("\nRunning research agent...");
    const researchResult = await forge.runAgent(
      "Researcher",
      "What are the latest breakthroughs in quantum computing?"
    );
    console.log("\nResearch Result:");
    console.log(researchResult.output);
    console.log(
      `\nToken usage: ${researchResult.metadata.tokenUsage?.total || 0} tokens`
    );

    // Method 2: Create and run a workflow (sequential)
    console.log("\n\nRunning workflow (sequential agents)...");
    const workflow = forge.createWorkflow(
      "Research and Summarize",
      "Research a topic and then summarize the findings"
    );
    workflow.addStep(researchAgent);
    workflow.addStep(summaryAgent);

    const workflowResult = await workflow.run(
      "Explain the current state of AI safety research"
    );
    console.log("\nWorkflow Result:");
    console.log(workflowResult.output);
    console.log(
      `\nToken usage: ${workflowResult.metadata.tokenUsage?.total || 0} tokens`
    );

    // Method 3: Load all agents from a directory
    console.log("\n\nLoading all agents from directory (re-writes YAMLs with current .env model first)...");
    await createExampleYamlFiles(); // Re-write YAMLs to ensure consistency if .env changed
    await forge.loadAgentsFromDirectory(examplesDir); // Load agents
    // After loading, iterate and ensure LLM provider is set to the one from .env
    for (const agent of forge.getAgents()) {
        agent.setLLMProvider(llmProviderInstance); // Unconditionally set to ensure consistency
    }
    console.log("All agents from directory loaded/updated successfully. Current models:");
    forge.getAgents().forEach((agent) => {
        console.log(`- ${agent.name} (${agent.role}): Model: ${agent.model}`);
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
