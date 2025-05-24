import type { LLM } from "../llm/llm";
import type { AgentConfig } from "../types";

/**
 * Agent config decorator. Attaches the config and LLM provider as static properties to the class.
 *
 * @param config AgentConfig object
 * @param llmProvider LLM provider instance or class (required)
 *
 * Usage:
 *   @agent(config, llmProvider)
 *   class MyAgent extends Agent {}
 */
export function agent(config: AgentConfig, llmProvider: LLM): ClassDecorator {
  return (target: any) => {
    target.agentConfig = config;
    target.agentLLMProvider = llmProvider;
    return target;
  };
}
