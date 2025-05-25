import { agent } from "../../../core/decorators";
import { Agent } from "../../../core/agent";
import { configuredModel } from "../provider";

@agent({
  name: "SummarizerAgent",
  role: "Summarizer",
  description: "An agent that specializes in summarizing information.",
  objective: "Create concise, accurate summaries of complex information.",
  model: configuredModel,
})
export class SummarizerAgent extends Agent {} 