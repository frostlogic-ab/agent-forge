import { a2aServer,  } from "../../../a2a/decorators";
import { Agent } from "../../../core/agent";
import { agent, llmProvider } from "../../../core/decorators";
import { configuredProvider, configuredModel, configuredApiKey } from "../provider";

/**
 * Example of using the @a2aServer decorator to expose an agent via A2A protocol.
 * The server will start automatically when the agent is instantiated.
 */
@llmProvider(configuredProvider, { apiKey: configuredApiKey })
@a2aServer({ port: 41241, host: "localhost", endpoint: "/a2a", verbose: true })
@agent({
    name: "HelpfulAssistantAgent",
    role: "Helpful Assistant",
    description: "An AI assistant that tries to be helpful, hosted via A2A.",
    objective: "To answer questions and perform tasks as a helpful AI assistant.",
    model: configuredModel,
})
export class HelpfulAssistantAgent extends Agent {}