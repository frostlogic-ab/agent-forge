import { agent, llmProvider } from "../../../core/decorators";
import { Agent } from "../../../core/agent";
import { configuredProvider, configuredApiKey, configuredModel } from "../provider";

@llmProvider(configuredProvider, {apiKey: configuredApiKey})
@agent({
    name: "Team manager",
    role: "Team manager",
    description: "You are a world class financial project manager",
    objective: 
    `
    Use your team of agents to complete the research report for the requested company. 

    ## Workflow
      1. Plan and assign tasks to the agents.
      2. If you need to, you can ask the agents to do a job multiple times.
      3. Don't let the agents work on the same job at the same time.
      5. If the financial analyst agent returns a report, ask the report writer agent to write the report.
      6. If the report writer agent returns a report, return the final report to the user.

    ## Important
    - Return final response as-is from Report Writer agent.
    `,
    model: configuredModel,
    temperature: 0.4
  })
export class ManagerAgent extends Agent {}
