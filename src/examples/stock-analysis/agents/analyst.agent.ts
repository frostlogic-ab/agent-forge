import { Agent } from "../../../core/agent";
import { agent, llmProvider } from "../../../core/decorators";
import { configuredProvider, configuredApiKey, configuredModel } from "../provider";

@llmProvider(configuredProvider, {apiKey: configuredApiKey})
@agent({
    name: "Financial analyst",
    role: "You are a world class financial analyst.",
    description: "Analyzes financial data on a company and returns a report of the analysis.",
    objective:
    `
      Analyze the key financial data for the company:
        1. Note if stock is up or down and by how much (percentage and dollar amount)
        2. Check if earnings beat or missed expectations (by how much)
        3. List 1-2 main strengths and concerns based on the data
        4. Include any analyst recommendations mentioned in the data
        5. Include any other relevant information that is not covered in the other criteria
        Be specific with numbers and cite any sources of information
    `,
    model: configuredModel,
    temperature: 0.4
  })
export class AnalystAgent extends Agent {}