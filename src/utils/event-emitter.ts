/**
 * Simple event emitter for handling stream events
 */
export class EventEmitter {
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  /**
   * Register an event listener
   * @param event Event name
   * @param listener Function to call when the event is emitted
   */
  on(event: string, listener: (...args: any[]) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  /**
   * Emit an event with arguments
   * @param event Event name
   * @param args Arguments to pass to listeners
   */
  emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners[event];
    if (eventListeners) {
      for (const listener of eventListeners) {
        listener(...args);
      }
    }
  }

  /**
   * Remove an event listener
   * @param event Event name
   * @param listener The listener function to remove
   */
  off(event: string, listener: (...args: any[]) => void): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((l) => l !== listener);
  }

  /**
   * Remove all listeners for an event
   * @param event Event name (optional - if not provided, removes all listeners)
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners[event] = [];
    } else {
      this.listeners = {};
    }
  }
}

/**
 * Global event emitter instance for application-wide events
 */
export const globalEventEmitter = new EventEmitter();
