import { Plugin, PluginLifecycleHooks, type PluginHookData } from '../../../plugins/plugin-manager';

interface CacheEntry {
  result: any;
  timestamp: number;
  ttl: number;
}

export class CachingPlugin extends Plugin {
  readonly name = 'caching';
  readonly version = '1.0.0';
  readonly priority = 50;

  private cache = new Map<string, CacheEntry>();
  private defaultTTL = 60000; // 1 minute
  private cacheHits = 0;
  private cacheMisses = 0;

  getHooks() {
    return {
      [PluginLifecycleHooks.AGENT_BEFORE_RUN]: this.checkCache.bind(this),
      [PluginLifecycleHooks.AGENT_AFTER_RUN]: this.storeInCache.bind(this),
    };
  }

  private checkCache(data: PluginHookData): any {
    const { agent, input } = data.payload;
    const cacheKey = this.generateCacheKey(agent.name, input);
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      this.cacheHits++;
      this.log(`💨 Cache hit for agent ${agent.name} (${this.formatCacheStats()})`);
      
      // Return special payload that indicates we should use cached result
      return { 
        ...data.payload, 
        _useCachedResult: true,
        _cachedResult: cached.result 
      };
    }

    this.cacheMisses++;
    this.log(`🔍 Cache miss for agent ${agent.name} (${this.formatCacheStats()})`);
    return data.payload;
  }

  private storeInCache(data: PluginHookData): any {
    const { agent, input, result } = data.payload;
    
    // Don't cache if this was a cached result
    if (data.payload._useCachedResult) {
      return data.payload;
    }

    const cacheKey = this.generateCacheKey(agent.name, input);
    
    this.cache.set(cacheKey, {
      result,
      timestamp: Date.now(),
      ttl: this.defaultTTL
    });

    this.log(`💾 Cached result for agent ${agent.name}`);
    
    // Clean up old entries periodically
    if (this.cache.size > 100) {
      this.cleanupExpiredEntries();
    }

    return data.payload;
  }

  private generateCacheKey(agentName: string, input: string): string {
    // Create a hash-like key from agent name and input
    const inputHash = Buffer.from(input).toString('base64').substring(0, 50);
    return `${agentName}:${inputHash}`;
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= entry.ttl) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.log(`🧹 Cleaned up ${cleanedCount} expired cache entries`);
    }
  }

  private formatCacheStats(): string {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? ((this.cacheHits / total) * 100).toFixed(1) : '0';
    return `${this.cacheHits}/${total} hits, ${hitRate}% hit rate`;
  }

  // Public methods for cache management
  clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.log(`🗑️ Cleared cache (${size} entries removed)`);
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  getCacheStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.cache.size,
      hitRate: total > 0 ? (this.cacheHits / total) * 100 : 0
    };
  }

  setDefaultTTL(ttl: number): void {
    this.defaultTTL = ttl;
    this.log(`⏰ Cache TTL set to ${ttl}ms`);
  }
} 