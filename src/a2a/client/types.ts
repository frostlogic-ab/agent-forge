export interface A2AClientOptions {
  serverUrl: string; // Base URL of the A2A agent server (e.g., "http://localhost:41241/a2a")
  fetch?: typeof fetch; // Optional custom fetch implementation (for Node.js or specific environments)
  // Optional: custom logger, default request headers, etc.
}

export interface A2AClientSubscription {
  unsubscribe: () => void; // Method to stop listening to SSE events
  // Optionally, the async iterable itself could be part of this interface if needed elsewhere
}
