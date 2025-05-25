import type { ConfigOptions } from "token.js";
import { LLM } from "../llm/llm";
import type { AgentConfig, LLMProvider } from "../types";
import { AgentForge } from "./agent-forge";

/**
 * Agent config decorator. Attaches the config and LLM provider as static properties to the class.
 *
 * @param config AgentConfig object
 *
 * Usage:
 *   @agent(config)
 *   class MyAgent extends Agent {}
 */
export function agent(config: AgentConfig): ClassDecorator {
  return (target: any) => {
    target.agentConfig = config;
    return target;
  };
}

/**
 * LLM Provider decorator. Sets static properties for provider and config on the class.
 *
 * @param provider LLM provider name
 * @param config LLM provider config
 *
 * Usage:
 *   @llmProvider("openai", { apiKey: "..." })
 *   class MyClass {}
 */
export function llmProvider(
  provider: LLMProvider,
  config: ConfigOptions
): ClassDecorator {
  return (target: any) => {
    target.llmProvider = provider;
    target.llmConfig = config;
    return target;
  };
}

/**
 * Forge decorator. Attaches a static AgentForge instance to the class in a type-safe way.
 *
 * Requires @llmProvider to be used on the class to set the LLM provider and config.
 *
 * Usage:
 *   @llmProvider("openai", { apiKey: "..." })
 *   @forge()
 *   class MyForge {}
 */
export function forge() {
  return <T extends { new (...args: any[]): object }>(target: T) => {
    return class extends target {
      static forge: AgentForge;
      constructor(...args: any[]) {
        super(...args);
        // Lazy read of static properties at runtime
        const provider = (this.constructor as any).llmProvider;
        const providerConfig = (this.constructor as any).llmConfig;
        if (!provider || !providerConfig) {
          throw new Error(
            "LLM provider and config must be set via @llmProvider on the class before using @forge"
          );
        }
        // Only initialize static forge once
        if (!(this.constructor as any).forge) {
          (this.constructor as any).forge = new AgentForge(
            new LLM(provider, providerConfig)
          );
        }
      }
    };
  };
}
