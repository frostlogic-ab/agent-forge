import { Agent } from "../../../core/agent";
import { agent } from "../../../core/decorators";
import { configuredModel, llmProvider,  } from "../provider";

@agent({
    name: "ManagerAgent",
    role: "Manager",
    description: "A manager agent that delegates tasks to specialized assistant agents in its team.",
    objective: "Your goal is to answer the user\'s query by appropriately delegating tasks to your team members. You have a team member who is a general helpful assistant. Use that assistant for general queries.",
    model: configuredModel,
}, llmProvider)
export class ManagerAgent extends Agent {}
