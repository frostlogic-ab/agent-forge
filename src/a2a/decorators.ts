import type { Agent } from "../core/agent";
import { LLM } from "../llm/llm";
import { RemoteA2AAgent } from "./client/RemoteA2AAgent";
import type { A2AClientOptions } from "./client/types";
import { A2AServer } from "./server/A2AServer";
import type { A2AServerOptions } from "./server/types";

/**
 * Class decorator to make an Agent class use a remote A2A agent via the A2A protocol.
 * Usage: @a2aClient({ serverUrl: "http://localhost:41241/a2a" })
 *
 * The decorated class can be instantiated with any arguments (including none),
 * and will always return a RemoteA2AAgent instance.
 *
 * This decorator also overrides the constructor signature so that TypeScript does not require AgentConfig.
 */
export function a2aClient(
  options: A2AClientOptions,
  localAlias?: string
): ClassDecorator {
  return (target: any): any => {
    // Return a function constructor that allows any arguments and returns the remote agent
    function A2AClientProxy(..._args: any[]) {
      return RemoteA2AAgent.create(options, localAlias);
    }
    // Set up prototype chain for instanceof checks
    Object.setPrototypeOf(A2AClientProxy.prototype, target.prototype);
    // Type assertion to 'any' to override the constructor signature for TS
    return A2AClientProxy as any;
  };
}

/**
 * Class decorator to expose an Agent as an A2A server.
 * Usage: @a2aServer({ port: 41241 })
 *
 * Always uses static llmProvider/llmConfig from the class (set by @llmProvider).
 */
export function a2aServer(
  options: A2AServerOptions = {},
  adapter?: any
): ClassDecorator {
  return (target: any): any => {
    return class extends target {
      private __a2aServerInstance?: A2AServer;
      constructor(...args: any[]) {
        super(...args);
        // Lazy read of static properties at runtime
        const provider = (this.constructor as any).llmProvider;
        const providerConfig = (this.constructor as any).llmConfig;
        if (!provider || !providerConfig) {
          throw new Error(
            "LLM provider and config must be set via @llmProvider on the class before using @a2aServer"
          );
        }
        if (provider && typeof this.setLLMProvider === "function") {
          (async () => {
            this.setLLMProvider(await LLM.create(provider, providerConfig));
          })();
        }
        this.__a2aServerInstance = new A2AServer(
          this as unknown as Agent,
          options,
          adapter
        );
        this.__a2aServerInstance.start().then(() => {
          if (options.verbose) {
            // eslint-disable-next-line no-console
            console.log(
              `[A2A] Server started for agent '${this.name}' on port ${options.port || 3000}`
            );
          }
        });
      }
      get a2aServer() {
        return this.__a2aServerInstance;
      }
    };
  };
}
