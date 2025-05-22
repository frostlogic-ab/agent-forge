export interface RateLimiterOptions {
  callsPerMinute?: number;
  callsPerSecond?: number;
  verbose?: boolean;
  toolName?: string; // Track which tool is being rate limited
}

export class RateLimiter {
  private tokensRemaining: number;
  private lastResetTime: number;
  private waitingQueue: Array<() => void> = [];
  public options: RateLimiterOptions;
  private intervalMs: number;
  private maxTokens: number;
  private toolName: string;

  constructor(options: RateLimiterOptions) {
    this.options = options;

    // Allow specification of either calls per minute or calls per second
    if (options.callsPerSecond) {
      this.maxTokens = options.callsPerSecond;
      this.intervalMs = 1000; // 1 second in ms
    } else if (options.callsPerMinute) {
      this.maxTokens = options.callsPerMinute;
      this.intervalMs = 60000; // 1 minute in ms
    } else {
      // Default to 10 calls per minute
      this.maxTokens = 10;
      this.intervalMs = 60000;
    }

    this.tokensRemaining = this.maxTokens;
    this.lastResetTime = Date.now();
    this.toolName = options.toolName || "Unknown";
  }

  public async waitForToken(): Promise<void> {
    const now = Date.now();
    const timeSinceReset = now - this.lastResetTime;
    const toolInfo = this.options.toolName ? `[${this.options.toolName}]` : "";

    // Reset tokens if interval has passed
    if (timeSinceReset >= this.intervalMs) {
      const resetCount = Math.floor(timeSinceReset / this.intervalMs);
      this.lastResetTime += resetCount * this.intervalMs;

      // Add tokens, but don't exceed max
      const tokensToAdd = resetCount * this.maxTokens;
      this.tokensRemaining = Math.min(
        this.maxTokens,
        this.tokensRemaining + tokensToAdd
      );

      if (this.options.verbose) {
        console.log(
          `${toolInfo} Rate limit reset. ${this.tokensRemaining} tokens available.`
        );
      }

      // Process waiting queue if tokens are available
      while (this.tokensRemaining > 0 && this.waitingQueue.length > 0) {
        const resolve = this.waitingQueue.shift();
        if (resolve) {
          this.tokensRemaining--; // Consume token for queued item
          if (this.options.verbose) {
            console.log(
              `${toolInfo} Token granted to queued request. ${this.tokensRemaining}/${this.maxTokens} tokens remaining.`
            );
          }
          resolve();
        }
      }
    }

    // If we have tokens available, use one and proceed
    if (this.tokensRemaining > 0) {
      this.tokensRemaining--;
      if (this.options.verbose) {
        console.log(
          `${toolInfo} Token granted immediately. ${this.tokensRemaining}/${this.maxTokens} tokens remaining.`
        );
      }
      return;
    }

    // Otherwise, wait for a token to become available
    if (this.options.verbose) {
      // Check queue length to provide more informative logging
      const queueLog =
        this.waitingQueue.length > 0
          ? ` ${this.waitingQueue.length + 1} calls in queue.`
          : "";
      const timeUntilReset = Math.max(
        0,
        this.intervalMs - (Date.now() - this.lastResetTime)
      ); // Ensure non-negative
      console.log(
        `${toolInfo} Rate limit reached. Waiting ${Math.ceil(timeUntilReset / 1000)}s for next available slot.${queueLog}`
      );
    }

    await new Promise<void>((resolve) => {
      this.waitingQueue.push(resolve);
    });

    if (this.options.verbose) {
      console.log(
        `${toolInfo} Token received after waiting, continuing execution.`
      );
    }
  }
}
