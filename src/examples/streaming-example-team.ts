import * as dotenv from "dotenv";
// Load environment variables from .env file at the project root
dotenv.config();

import { AgentForge } from "../core/agent-forge";
import { WebSearchTool } from "../tools/web-search-tool";
import { globalEventEmitter } from "../utils/event-emitter";
import { Agent } from "../core/agent";
import { exit } from "process";
import { WebPageContentTool } from "../tools/web-page-content-tool";
import { LLM } from "../llm/llm";
import { LLMProvider } from "../types";
import { Team } from "../core/team";

async function main() {
  const provider = (process.env.LLM_PROVIDER as LLMProvider) || "openai";
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_API_MODEL!;

  if (!apiKey) {
    throw new Error("LLM_API_KEY environment variable not set.");
  }

  // Use async LLM.create
  const llm = await LLM.create(provider, { apiKey });

  const manager = new Agent({
    name: "Manager",
    role: "Team Manager",
    description: "Coordinates the team.",
    objective: "Manage the team to solve the task.",
    model,
    temperature: 0.5,
  }, [], llm);

  const researcher = new Agent({
    name: "Researcher",
    role: "Research Specialist",
    description: "Finds information.",
    objective: "Research the topic.",
    model,
    temperature: 0.4,
  }, [], llm);

  const summarizer = new Agent({
    name: "Summarizer",
    role: "Summarizer",
    description: "Summarizes information.",
    objective: "Summarize the research.",
    model,
    temperature: 0.3,
  }, [], llm);

  const team = new Team(manager, "Research Team", "A team to research and summarize");
  team.addAgent(researcher);
  team.addAgent(summarizer);

  const result = await team.run("What are the latest trends in AI research?", { verbose: true });
  console.log(result.output);
}

main(); 