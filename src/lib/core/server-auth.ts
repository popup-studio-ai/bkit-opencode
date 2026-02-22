/**
 * OpenCode Server Auth Injection
 *
 * When OPENCODE_SERVER_PASSWORD is set, the OpenCode server requires HTTP Basic Auth.
 * However, the SDK client passed to plugins (input.client) does not include these
 * credentials automatically (see: https://github.com/anomalyco/opencode/issues/12846).
 *
 * This module patches the SDK client using @hey-api/openapi-ts's public APIs:
 *   1. setConfig({ auth }) — official auth callback (hey-api docs)
 *   2. interceptors.request.use() — official request interceptor
 *   3. client fetch wrapper — last-resort for older SDK versions
 *
 * References:
 *   - hey-api Fetch client docs: https://heyapi.dev/openapi-ts/clients/fetch
 *   - OpenCode issue #12846: Plugin client missing Authorization header
 */

/**
 * Build a Basic Auth header value from environment variables.
 * Returns undefined if OPENCODE_SERVER_PASSWORD is not set.
 */
function buildBasicAuth(): string | undefined {
  const password = process.env["OPENCODE_SERVER_PASSWORD"]
  if (!password) return undefined
  const username = process.env["OPENCODE_SERVER_USERNAME"] ?? "opencode"
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
}

/**
 * Attempt auth injection via setConfig({ auth }) — hey-api's recommended approach.
 * The `auth` field accepts a string or function returning the token value.
 */
function injectViaSetConfig(client: any, authHeader: string): boolean {
  const internal = client?._client
  if (typeof internal?.setConfig !== "function") return false
  try {
    // hey-api auth expects just the token portion for Bearer, but for Basic
    // we use the headers approach which is more explicit
    internal.setConfig({ headers: { Authorization: authHeader } })
    return true
  } catch {
    return false
  }
}

/**
 * Attempt auth injection via interceptors.request.use() — hey-api's interceptor API.
 * Each request passes through the interceptor before being sent.
 */
function injectViaInterceptor(client: any, authHeader: string): boolean {
  const interceptors = client?._client?.interceptors
  if (typeof interceptors?.request?.use !== "function") return false
  try {
    interceptors.request.use((request: Request) => {
      if (!request.headers.has("Authorization")) {
        request.headers.set("Authorization", authHeader)
      }
      return request
    })
    return true
  } catch {
    return false
  }
}

/**
 * Last-resort: patch client's own fetch property if exposed at top level.
 * Does NOT touch globalThis.fetch — that would leak credentials to all HTTP requests.
 */
function injectViaClientFetch(client: any, authHeader: string): boolean {
  const internal = client?._client
  if (!internal) return false
  const getConfig = internal.getConfig
  const setConfig = internal.setConfig
  if (typeof getConfig !== "function" || typeof setConfig !== "function") return false
  try {
    const config = getConfig()
    const originalFetch = config?.fetch
    if (typeof originalFetch !== "function") return false
    setConfig({
      fetch: async (request: Request): Promise<Response> => {
        const headers = new Headers(request.headers)
        if (!headers.has("Authorization")) {
          headers.set("Authorization", authHeader)
        }
        return originalFetch(new Request(request, { headers }))
      },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Inject HTTP Basic Auth into the OpenCode SDK client.
 *
 * Reads OPENCODE_SERVER_PASSWORD (and optional OPENCODE_SERVER_USERNAME)
 * from environment variables. Does nothing if password is not set.
 *
 * Tries three injection methods in order of preference:
 *   1. setConfig({ headers }) — cleanest, uses hey-api's config merge
 *   2. interceptors.request.use() — per-request header injection
 *   3. client fetch wrapper — fallback for unknown SDK versions
 */
export function patchClientAuth(client: unknown): void {
  const authHeader = buildBasicAuth()
  if (!authHeader) return

  try {
    if (injectViaSetConfig(client, authHeader)) return
    if (injectViaInterceptor(client, authHeader)) return
    if (injectViaClientFetch(client, authHeader)) return

    console.warn("[bkit] OPENCODE_SERVER_PASSWORD is set but auth injection failed — SDK client structure not recognized")
  } catch (e) {
    console.warn(`[bkit] Auth injection error: ${e instanceof Error ? e.message : String(e)}`)
  }
}
