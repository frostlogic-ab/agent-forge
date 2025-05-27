import fs from "node:fs/promises";
import path from "node:path";
import type { extendedModelFeatureSupport } from "token.js";
import type { LLMProvider } from "token.js/dist/chat";

const CONFIG_FILENAME = "agentforge.config.json";

/**
 * Entry for custom model extension, matching TokenJS's extendedModelList type.
 */
export interface ExtendedModelListEntry {
  provider: LLMProvider;
  name: string;
  featureSupport: extendedModelFeatureSupport<any>;
}

export interface AgentForgeConfig {
  extendModelList?: ExtendedModelListEntry[];
}

let cachedConfig: AgentForgeConfig | null = null;

/**
 * Loads agentforge.config.json from the project root.
 * @returns Parsed AgentForgeConfig object
 */
export async function loadAgentForgeConfig(): Promise<AgentForgeConfig> {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), CONFIG_FILENAME);
  try {
    const fileContent = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(fileContent);
    cachedConfig = parsed;
    return parsed;
  } catch (err) {
    // If file not found, return empty config
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Failed to load ${CONFIG_FILENAME}: ${(err as Error).message}`
    );
  }
}

/**
 * Returns the list of custom model extensions from config, or an empty array.
 */
export async function getExtendedModelList(): Promise<
  ExtendedModelListEntry[]
> {
  const config = await loadAgentForgeConfig();
  return config.extendModelList || [];
}
