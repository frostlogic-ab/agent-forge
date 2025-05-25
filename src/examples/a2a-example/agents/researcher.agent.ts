import { agent } from "../../../core/decorators";
import { Agent } from "../../../core/agent";
import { configuredModel } from "../provider";

@agent({
  name: "ResearcherAgent",
  role: "Research Specialist",
  description: "An agent that specializes in gathering and analyzing information.",
  objective: "Find accurate and relevant information on requested topics.",
  model: configuredModel,
})
export class ResearcherAgent extends Agent {} 