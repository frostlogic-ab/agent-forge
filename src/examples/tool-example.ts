import * as dotenv from "dotenv";
import {
  AgentForge,
  Agent,
  ToolCall,
  agent,
  llmProvider,
  forge,
  tool,
  readyForge,
  LLMProvider,
} from "../index";
import { Tool } from "../tools/tool";
import { ToolParameter } from "../types";

// Load environment variables from .env file at the project root
dotenv.config();

// Create a simple calculator tool for demonstration
class CalculatorTool extends Tool {
  constructor() {
    const parameters: ToolParameter[] = [
      {
        name: "expression",
        type: "string",
        description: "The mathematical expression to evaluate",
        required: true,
      },
    ];

    super(
      "calculate",
      "Evaluate mathematical expressions and perform calculations",
      parameters,
      "The result of the evaluated expression"
    );
  }

  protected async run(params: { expression: string }): Promise<any> {
    try {
      // Basic math operations only for safety
      const cleanExpression = params.expression.replace(/[^0-9+\-*/().\s]/g, '');
      if (cleanExpression !== params.expression) {
        return {
          error: "Expression contains invalid characters. Only numbers, +, -, *, /, and parentheses are allowed.",
        };
      }
      
      // Warning: Using eval is unsafe in a real application. This is just for demonstration.
      // In a real-world scenario, use a proper mathematical expression parser.
      // eslint-disable-next-line no-eval
      const result = eval(cleanExpression);
      return { result: `The answer is ${result}` };
    } catch (error) {
      return {
        error: `Failed to evaluate expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}

// Example of a weather tool
class WeatherTool extends Tool {
  constructor() {
    const parameters: ToolParameter[] = [
      {
        name: "location",
        type: "string",
        description: "The location to get weather for",
        required: true,
      },
    ];

    super(
      "get_weather",
      "Get current weather information for a location",
      parameters,
      "Weather information including temperature, conditions, and forecast"
    );
  }

  protected async run(params: { location: string }): Promise<any> {
    // This is a mock implementation. In a real application, you would call a weather API.
    const locations: Record<string, any> = {
      "new york": {
        temperature: "72°F",
        conditions: "Partly cloudy",
        forecast: "Sunny with a high of 75°F tomorrow",
      },
      london: {
        temperature: "16°C",
        conditions: "Rainy",
        forecast: "Continued rain with a high of 18°C tomorrow",
      },
      tokyo: {
        temperature: "25°C",
        conditions: "Clear",
        forecast: "Sunny with a high of 27°C tomorrow",
      },
    };

    const normalizedLocation = params.location.toLowerCase();

    if (locations[normalizedLocation]) {
      return {
        location: params.location,
        ...locations[normalizedLocation],
      };
    }

    // For unknown locations, generate a random weather
    return {
      location: params.location,
      temperature: `${Math.floor(Math.random() * 30) + 10}°C`,
      conditions: ["Sunny", "Cloudy", "Rainy", "Windy"][
        Math.floor(Math.random() * 4)
      ],
      forecast: "Generated mock forecast for demonstration purposes",
      note: "This is mock data. In a real application, this would come from a weather API.",
    };
  }
}

// Assistant agent with tools using decorators
@tool(CalculatorTool)
@tool(WeatherTool)
@agent({
  name: "Assistant",
  role: "Helpful Assistant",
  description:
    "A helpful assistant that can perform mathematical calculations using the 'calculate' tool and get weather information using the 'get_weather' tool.",
  objective:
    "Help the user with their questions using the available tools when appropriate. Use the calculate tool for math problems and the get_weather tool for weather queries.",
  model: process.env.LLM_API_MODEL!,
  temperature: 0.7,
})
class AssistantAgent extends Agent {}

@llmProvider(process.env.LLM_PROVIDER as LLMProvider, {
  apiKey: process.env.LLM_API_KEY,
})
@forge()
class ToolExample {
  static forge: AgentForge;

  static async run() {
    const agentClasses = [AssistantAgent];
    await readyForge(ToolExample, agentClasses);

    // Run the agent with different queries that would use different tools
    console.log("Running assistant agent with a calculation query...");
    const calculationResult = await ToolExample.forge.runAgent(
      "Assistant",
      "What is 527 * 192?"
    );
    console.log("\nCalculation Result:");
    console.log(calculationResult.output);
    console.log(
      "\nTool calls:",
      calculationResult.metadata.toolCalls?.map(
        (tc: ToolCall) => tc.toolName
      ) || "None"
    );

    console.log("\n\nRunning assistant agent with a weather query...");
    const weatherResult = await ToolExample.forge.runAgent(
      "Assistant",
      "What's the weather like in Tokyo?"
    );
    console.log("\nWeather Result:");
    console.log(weatherResult.output);
    console.log(
      "\nTool calls:",
      weatherResult.metadata.toolCalls?.map((tc: ToolCall) => tc.toolName) ||
        "None"
    );

    console.log("\n\nRunning assistant agent with a search query...");
    const searchResult = await ToolExample.forge.runAgent(
      "Assistant",
      "What are the latest advancements in quantum computing?"
    );
    console.log("\nSearch Result:");
    console.log(searchResult.output);
    console.log(
      "\nTool calls:",
      searchResult.metadata.toolCalls?.map((tc: ToolCall) => tc.toolName) ||
        "None"
    );

    console.log(
      "\n\nRunning assistant agent with a complex query that might use multiple tools..."
    );
    const complexResult = await ToolExample.forge.runAgent(
      "Assistant",
      "I'm planning a trip to New York. What's the weather like there, and what are the top 3 tourist attractions?"
    );
    console.log("\nComplex Result:");
    console.log(complexResult.output);
    console.log(
      "\nTool calls:",
      complexResult.metadata.toolCalls?.map((tc: ToolCall) => tc.toolName) ||
        "None"
    );

    process.exit(0);
  }
}

ToolExample.run().catch(console.error);
