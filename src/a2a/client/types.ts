export interface A2AClientOptions {
  serverUrl: string; // Base URL of the A2A agent server (e.g., "http://localhost:41241/a2a")
  fetch?: typeof fetch; // Optional custom fetch implementation (for Node.js or specific environments)
  taskStatusRetries?: number; // Number of retries to get task status
  taskStatusRetryDelay?: number; // Delay between retries in milliseconds
}

export interface A2AClientSubscription {
  unsubscribe: () => void; // Method to stop listening to SSE events
  // Optionally, the async iterable itself could be part of this interface if needed elsewhere
}
