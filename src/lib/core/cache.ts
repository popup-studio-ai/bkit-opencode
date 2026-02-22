// Simple in-memory cache with TTL support

interface CacheEntry<T = unknown> {
  value: T
  expiresAt: number
}

const store = new Map<string, CacheEntry>()

/**
 * Retrieve a cached value. Returns undefined if the key is missing or expired.
 */
function get<T = unknown>(key: string): T | undefined {
  const entry = store.get(key)
  if (!entry) return undefined

  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return undefined
  }

  return entry.value as T
}

/**
 * Store a value with a time-to-live in milliseconds.
 * If ttlMs is 0 or not provided, the entry never expires.
 */
function set<T = unknown>(key: string, value: T, ttlMs: number = 0): void {
  const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : Number.MAX_SAFE_INTEGER
  store.set(key, { value, expiresAt })
}

/** Remove a single key from the cache. */
function invalidate(key: string): void {
  store.delete(key)
}

/** Remove all entries from the cache. */
function clear(): void {
  store.clear()
}

/** Check if a key exists and is not expired. */
function has(key: string): boolean {
  const entry = store.get(key)
  if (!entry) return false
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return false
  }
  return true
}

/** Get the number of entries in the cache (including potentially expired ones). */
function size(): number {
  return store.size
}

/**
 * Invalidate all keys matching a glob-like pattern.
 * Supports trailing wildcard: "skill-*" matches "skill-pdca", "skill-code-review", etc.
 * Returns the number of invalidated entries.
 * OpenCode enhancement: not available in Claude Code or Gemini versions.
 */
function invalidatePattern(pattern: string): number {
  if (!pattern.includes("*")) {
    // Exact match
    const had = store.has(pattern)
    store.delete(pattern)
    return had ? 1 : 0
  }

  const prefix = pattern.replace(/\*.*$/, "")
  let count = 0
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key)
      count++
    }
  }
  return count
}

export const cache = { get, set, invalidate, clear, has, size, invalidatePattern }
