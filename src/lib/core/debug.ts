// Debug logging utility -- writes to stderr so it never contaminates tool output.
// Activate by setting the environment variable BKIT_DEBUG=1.

const isDebug = (process.env.BKIT_DEBUG ?? "") === "1"

/** Whether debug logging is enabled (BKIT_DEBUG=1) */
export const isDebugEnabled = isDebug

/**
 * Log a debug message to stderr.
 *
 * @param module  Short module/subsystem name (e.g. "config", "cache", "pdca")
 * @param message Human-readable message
 * @param data    Optional structured payload (will be JSON-serialized)
 */
export function debugLog(module: string, message: string, data?: unknown): void {
  if (!isDebug) return

  const timestamp = new Date().toISOString()
  const prefix = `[bkit:${module}]`

  if (data !== undefined) {
    let serialized: string
    try {
      serialized = JSON.stringify(data, null, 2)
    } catch {
      serialized = String(data)
    }
    process.stderr.write(`${timestamp} ${prefix} ${message}\n${serialized}\n`)
  } else {
    process.stderr.write(`${timestamp} ${prefix} ${message}\n`)
  }
}
