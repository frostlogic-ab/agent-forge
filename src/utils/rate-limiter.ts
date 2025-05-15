export interface RateLimiterOptions {
  callsPerMinute: number;
  verbose?: boolean;
}

export class RateLimiter {
  private tokensRemaining: number;
  private lastResetTime: number;
  private waitingQueue: Array<() => void> = [];
  private options: RateLimiterOptions;

  constructor(options: RateLimiterOptions) {
    this.options = options;
    this.tokensRemaining = options.callsPerMinute;
    this.lastResetTime = Date.now();
  }

  public async waitForToken(): Promise<void> {
    const now = Date.now();
    const timeSinceReset = now - this.lastResetTime;

    // Reset tokens if a minute has passed
    if (timeSinceReset >= 60000) {
      this.lastResetTime = now;
      this.tokensRemaining = this.options.callsPerMinute;

      // Process waiting queue if tokens are available
      while (this.tokensRemaining > 0 && this.waitingQueue.length > 0) {
        const resolve = this.waitingQueue.shift();
        if (resolve) {
          this.tokensRemaining--; // Consume token for queued item
          resolve();
        }
      }
    }

    // If we have tokens available, use one and proceed
    if (this.tokensRemaining > 0) {
      this.tokensRemaining--;
      return;
    }

    // Otherwise, wait for a token to become available
    if (this.options.verbose) {
      // Check queue length to provide more informative logging, similar to Team.ts original
      const queueLog =
        this.waitingQueue.length > 0
          ? ` ${this.waitingQueue.length + 1} calls in queue.`
          : "";
      const timeUntilReset = Math.max(
        0,
        60000 - (Date.now() - this.lastResetTime)
      ); // Ensure non-negative
      console.log(
        `⏱️ Rate limit reached. Waiting ${Math.ceil(
          timeUntilReset / 1000
        )}s for next available slot.${queueLog}`
      );
    }

    await new Promise<void>((resolve) => {
      this.waitingQueue.push(resolve);
    });

    // After awating, the token might have been granted by the while loop during a reset.
    // If not, it means this call is at the front of the queue and a token became available.
    // The current logic for decrementing tokens (either directly if available, or via the while loop)
    // seems to cover consumption. The verbose log below might be optimistic if the token was consumed by another queued item.
    if (this.options.verbose) {
      console.log(
        "✅ Token potentially received, continuing execution (or processed from queue)."
      );
    }
  }
}
