import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { Agent } from "../core/agent";
import { type AgentConfig, ToolParameter } from "../types";

// Zod schema for tool parameter
const ToolParameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
  required: z.boolean().default(false),
  default: z.any().optional(),
});

// Zod schema for tool configuration
const ToolConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.array(ToolParameterSchema).optional(),
  returnType: z.string().optional(),
});

// Zod schema for agent configuration
const AgentConfigSchema = z.object({
  name: z.string(),
  role: z.string(),
  description: z.string(),
  objective: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().positive().optional(),
  tools: z.array(ToolConfigSchema).optional(),
});

/**
 * Loads agent configuration from a YAML file
 * @param filePath Path to the YAML file
 * @returns Agent configuration object
 */
export async function loadAgentConfigFromYaml(
  filePath: string
): Promise<AgentConfig> {
  try {
    // Read and parse the YAML file
    const fileContent = await fs.readFile(filePath, "utf-8");
    const parsedYaml = YAML.parse(fileContent);

    // Validate the configuration using Zod
    const validatedConfig = AgentConfigSchema.parse(parsedYaml);

    return validatedConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid agent configuration in ${filePath}: ${error.message}`
      );
    }
    if (error instanceof Error) {
      throw new Error(
        `Failed to load agent configuration from ${filePath}: ${error.message}`
      );
    }
    throw new Error(
      `Unknown error loading agent configuration from ${filePath}`
    );
  }
}

/**
 * Loads and creates an agent from a YAML file
 * @param filePath Path to the YAML file
 * @returns Initialized agent instance
 */
export async function loadAgentFromYaml(filePath: string): Promise<Agent> {
  const config = await loadAgentConfigFromYaml(filePath);
  return new Agent(config);
}

/**
 * Loads all agents from a directory of YAML files
 * @param directoryPath Path to directory containing agent YAML files
 * @returns Array of initialized agent instances
 */
export async function loadAgentsFromDirectory(
  directoryPath: string
): Promise<Agent[]> {
  try {
    const files = await fs.readdir(directoryPath);
    const yamlFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return ext === ".yaml" || ext === ".yml";
    });

    const agents: Agent[] = [];

    for (const file of yamlFiles) {
      try {
        const filePath = path.join(directoryPath, file);
        const agent = await loadAgentFromYaml(filePath);
        agents.push(agent);
      } catch (error) {
        console.warn(
          `Error loading agent from ${file}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return agents;
  } catch (error) {
    throw new Error(
      `Failed to load agents from directory ${directoryPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
