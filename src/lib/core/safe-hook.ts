/**
 * Safe Hook Wrapper
 *
 * Provides error isolation and conditional enable/disable for hooks.
 */

import { debugLog } from "./debug"

/**
 * Set of disabled hook names. Populated from bkit.config.json
 * `disabledHooks` field or BKIT_DISABLED_HOOKS env variable.
 */
const disabledHooks = new Set<string>(
  (process.env.BKIT_DISABLED_HOOKS ?? "").split(",").map(s => s.trim()).filter(Boolean)
)

/**
 * Register hook names to disable at runtime.
 */
export function disableHook(name: string): void {
  disabledHooks.add(name)
}

/**
 * Check if a hook is enabled (not in disabled set).
 */
export function isHookEnabled(name: string): boolean {
  return !disabledHooks.has(name)
}

/**
 * Wraps a hook handler factory with:
 * 1. Conditional enable/disable check
 * 2. Error isolation (catches thrown errors, logs them, never crashes the plugin)
 *
 * Returns `undefined` if the hook is disabled.
 *
 * Usage:
 * ```ts
 * const handler = guardedHookFactory("session", () => createSessionHandler(input))
 * // handler is either the handler function or undefined
 * ```
 */
export function guardedHookFactory<T>(
  name: string,
  factory: () => T,
): T | undefined {
  if (!isHookEnabled(name)) {
    debugLog("SafeHook", `Hook "${name}" is disabled, skipping`)
    return undefined
  }

  try {
    return factory()
  } catch (e: any) {
    debugLog("SafeHook", `Failed to create hook "${name}"`, { error: e.message })
    return undefined
  }
}

/**
 * Wraps an async hook handler function with error isolation.
 * The returned function will never throw — errors are caught and logged.
 *
 * Usage:
 * ```ts
 * return safeHandler("permission", async (perm, output) => {
 *   // actual logic
 * })
 * ```
 */
export function safeHandler<TArgs extends any[]>(
  name: string,
  fn: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    try {
      await fn(...args)
    } catch (e: any) {
      debugLog("SafeHook", `Handler "${name}" threw error (non-fatal)`, { error: e.message })
    }
  }
}
