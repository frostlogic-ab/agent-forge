import { a2aClient } from "../../../a2a/decorators";
import { Agent } from "../../../core/agent";

/**
 * Example of using the @a2aClient decorator to connect an agent to a remote A2A server.
 *
 * @example
 * @a2aClient({ serverUrl: "http://localhost:41241/a2a" })
 * class RemoteHelpfulAssistant extends Agent { ... }
 */
@a2aClient({ serverUrl: "http://localhost:41241/a2a" })
export class RemoteHelpfulAssistant extends Agent {}