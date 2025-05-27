import type { ConfigOptions } from "token.js";
import { LLM } from "../llm/llm";
import {
  type MCPClientWrapper,
  type MCPProtocolType,
  type MCPSseConfig,
  type MCPStdioConfig,
  type MCPStreamableHttpConfig,
  MCPToolWrapper,
  createMCPClient,
} from "../tools/mcp-tool";
import type { AgentConfig, LLMProvider, RateLimiterConfig } from "../types";
import { RateLimiter as RateLimiterClass } from "../utils/rate-limiter";
import { Agent } from "./agent";
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
    // Runtime check: ensure target is an Agent constructor
    if (typeof target !== "function" || !(target.prototype instanceof Agent)) {
      throw new Error(
        "@MCP decorator can only be applied to classes extending Agent"
      );
    }

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
    // Attach a flag to indicate llmProvider was set (for decorator order safety)
    target.__hasLlmProvider = true;
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
        const rateLimiterConfig = (this.constructor as any).rateLimiterConfig;
        if (!provider || !providerConfig) {
          throw new Error(
            "LLM provider and config must be set via @llmProvider on the class before using @forge"
          );
        }
        // Only initialize static forge once
        if (!(this.constructor as any).forge) {
          (this.constructor as any).forgeReady = (async () => {
            const llm = await LLM.create(provider, providerConfig);
            // If a rate limiter config is present, wrap LLM methods
            if (rateLimiterConfig) {
              const limiter = new RateLimiterClass({
                callsPerSecond: rateLimiterConfig.rateLimitPerSecond,
                callsPerMinute: rateLimiterConfig.rateLimitPerMinute,
                verbose: rateLimiterConfig.verbose,
                toolName: provider,
              });
              // Patch LLM methods to await the limiter
              for (const method of ["chat", "chatStream", "complete"]) {
                const orig = (llm as any)[method];
                (llm as any)[method] = async function (...args: any[]) {
                  await limiter.waitForToken();
                  return orig.apply(this, args);
                };
              }
              (llm as any).__rateLimiter = limiter;
            }
            const forge = new AgentForge(llm);
            // Transfer __visualizerEnabled flag from the decorated class to the AgentForge instance
            if ((this.constructor as any).__visualizerEnabled) {
              (forge.constructor as any).__visualizerEnabled = true;
            }
            (this.constructor as any).forge = forge;
          })();
        }
      }
    };
  };
}

export function RateLimiter(config: RateLimiterConfig): ClassDecorator {
  return (target: any) => {
    target.rateLimiterConfig = config;
    return target;
  };
}

// Update MCP decorator to use rateLimiterConfig if present
export function MCP(
  protocol: MCPProtocolType,
  config: MCPStdioConfig | MCPSseConfig | MCPStreamableHttpConfig
): ClassDecorator {
  return (target: any): any => {
    if (typeof target !== "function" || !(target.prototype instanceof Agent)) {
      throw new Error(
        "@MCP decorator can only be applied to classes extending Agent"
      );
    }
    if (!(target as any).mcpConfigs) {
      (target as any).mcpConfigs = [];
    }
    (target as any).mcpConfigs.push({ protocol, config });

    return class extends target {
      private __mcpClients: MCPClientWrapper[] = [];
      constructor(...args: any[]) {
        super(...args);
        if (
          (this as any).tools &&
          ((target as any).mcpConfigs?.length ?? 0) > 0
        ) {
          (async () => {
            for (const { protocol, config } of (target as any).mcpConfigs) {
              const client = createMCPClient(protocol, config);
              await client.initialize();
              const mcpTools = await client.listTools();
              // Get rate limiter config from the class
              const rateLimiterConfig: RateLimiterConfig | undefined = (
                target as any
              ).rateLimiterConfig;
              for (const mcpTool of mcpTools) {
                let rateLimiter: any;
                // Tool-specific limits
                for (const [pattern, limit] of Object.entries(
                  rateLimiterConfig?.toolSpecificLimits || {}
                ) as [string, any][]) {
                  if (
                    mcpTool.name.includes(pattern) &&
                    typeof limit === "object" &&
                    limit !== null
                  ) {
                    rateLimiter =
                      new (require("../utils/rate-limiter").RateLimiter)({
                        ...(limit as object),
                        verbose: rateLimiterConfig?.verbose,
                        toolName: mcpTool.name,
                      });
                    break;
                  }
                }
                // Global limits if no tool-specific
                if (
                  !rateLimiter &&
                  (rateLimiterConfig?.rateLimitPerSecond ||
                    rateLimiterConfig?.rateLimitPerMinute)
                ) {
                  rateLimiter =
                    new (require("../utils/rate-limiter").RateLimiter)({
                      callsPerSecond: rateLimiterConfig.rateLimitPerSecond,
                      callsPerMinute: rateLimiterConfig.rateLimitPerMinute,
                      verbose: rateLimiterConfig.verbose,
                      toolName: mcpTool.name,
                    });
                }
                const wrapper = new MCPToolWrapper(
                  mcpTool,
                  client,
                  rateLimiter,
                  { cacheTTL: rateLimiterConfig?.cacheTTL }
                );
                this.addTool(wrapper);
              }
              this.__mcpClients.push(client);
            }
          })();
        }
      }
      async closeMCPClients() {
        for (const client of this.__mcpClients) {
          await client.close();
        }
        this.__mcpClients = [];
      }
    };
  };
}
