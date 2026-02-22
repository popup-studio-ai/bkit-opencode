/**
 * File Type Detection & Classification
 * Ported from bkit-claude-code lib/core/file.js
 */

import { extname, basename } from "path"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TIER_EXTENSIONS: Record<number | string, string[]> = {
  1: [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt"],
  2: [".vue", ".svelte", ".astro", ".php", ".rb", ".swift", ".scala"],
  3: [".c", ".cpp", ".h", ".hpp", ".cs", ".m", ".mm"],
  4: [".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd"],
  experimental: [".zig", ".nim", ".v", ".odin", ".jai"],
}

export const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  "vendor", "target", ".cache", ".turbo", "coverage",
]

export const DEFAULT_FEATURE_PATTERNS = [
  "features", "modules", "packages", "apps", "services", "domains",
]

// ---------------------------------------------------------------------------
// All extensions flattened
// ---------------------------------------------------------------------------

const ALL_SOURCE_EXTENSIONS = new Set([
  ...TIER_EXTENSIONS[1],
  ...TIER_EXTENSIONS[2],
  ...TIER_EXTENSIONS[3],
  ...TIER_EXTENSIONS[4],
  ...TIER_EXTENSIONS.experimental,
])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check if file is a source code file */
export function isSourceFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  // Check exclude patterns
  for (const pattern of DEFAULT_EXCLUDE_PATTERNS) {
    if (filePath.includes(pattern)) return false
  }
  return ALL_SOURCE_EXTENSIONS.has(ext)
}

/**
 * Check if file is a "work file" — any project file that represents
 * implementation work, including docs, configs, content, and assets.
 * Used as fallback when isSourceFile() misses non-code work (e.g. writing
 * markdown docs, HTML pages, CSS styles, config files during "do" phase).
 *
 * Excludes: PDCA doc folders (tracked separately), lock files, binary artifacts.
 */
export function isWorkFile(filePath: string): boolean {
  // Check exclude patterns
  for (const pattern of DEFAULT_EXCLUDE_PATTERNS) {
    if (filePath.includes(pattern)) return false
  }
  // Skip PDCA document folders (they have their own phase detection)
  if (/docs\/0[0-4]-/.test(filePath)) return false
  // Skip lock files and binary artifacts
  const name = basename(filePath)
  const skipNames = new Set([
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock",
    "go.sum", "Cargo.lock", "Gemfile.lock", "composer.lock",
    ".pdca-status.json", ".bkit-memory.json", "agent-state.json",
  ])
  if (skipNames.has(name)) return false
  // Accept common work file extensions
  const ext = extname(filePath).toLowerCase()
  const workExtensions = new Set([
    // Documents & content
    ".md", ".mdx", ".txt", ".rst", ".adoc",
    // Web content
    ".html", ".htm", ".css", ".scss", ".sass", ".less", ".styl",
    // Config & data
    ".json", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg",
    ".env", ".env.local", ".env.development", ".env.production",
    // Templates
    ".ejs", ".hbs", ".pug", ".jinja", ".j2", ".njk", ".liquid", ".tmpl",
    // Build & CI
    ".dockerfile", ".dockerignore", ".gitignore", ".editorconfig",
    // GraphQL, Proto, SQL
    ".graphql", ".gql", ".proto", ".sql",
    // Office & documents
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".odt", ".ods", ".odp", ".rtf", ".pages", ".numbers", ".key",
    // Images
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
    ".bmp", ".tiff", ".tif", ".svg", ".eps", ".ai", ".psd", ".sketch", ".fig",
    // Video & audio
    ".mp4", ".webm", ".mov", ".avi", ".mkv", ".flv", ".wmv",
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a",
    // Misc project files
    ".xml", ".csv", ".tsv",
  ])
  if (workExtensions.has(ext)) return true
  // Accept extensionless config files (Makefile, Dockerfile, Procfile, etc.)
  if (!ext && /^[A-Z]/.test(name)) return true
  return false
}

/** Check if file is a code file (primary languages only) */
export function isCodeFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  const codeExts = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"]
  return codeExts.includes(ext)
}

/** Check if file is a UI component file */
export function isUiFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  const uiExts = [".tsx", ".jsx", ".vue", ".svelte", ".astro"]
  return uiExts.includes(ext) || filePath.includes("/components/")
}

/** Check if file is an environment config file */
export function isEnvFile(filePath: string): boolean {
  const name = basename(filePath)
  return name.startsWith(".env") || name.endsWith(".env")
}

/** Strip PDCA document suffixes and file extensions from a name */
function stripPdcaSuffix(name: string): string {
  // Strip known PDCA suffixes: .plan.md, .design.md, .journey.md, .analysis.md, .report.md, research
  const pdcaSuffixes = ["-plan-research.md", "-design-research.md", ".plan.md", ".design.md", ".journey.md", ".analysis.md", ".report.md"]
  for (const suffix of pdcaSuffixes) {
    if (name.endsWith(suffix)) {
      return name.slice(0, -suffix.length)
    }
  }
  // Strip generic .md extension
  if (name.endsWith(".md")) {
    return name.slice(0, -3)
  }
  return name
}

/** Check if file is a configuration file */
export function isConfigFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  const configExts = [".json", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg"]
  if (configExts.includes(ext)) return true
  const name = basename(filePath)
  return name.startsWith(".") && !name.startsWith(".env") && ext === ""
}

/** Get the language tier for a file based on its extension. Returns null if not a source file. */
export function getLanguageTier(filePath: string): number | "experimental" | null {
  const ext = extname(filePath).toLowerCase()
  for (const [tier, extensions] of Object.entries(TIER_EXTENSIONS)) {
    if ((extensions as string[]).includes(ext)) {
      return tier === "experimental" ? "experimental" : Number(tier)
    }
  }
  return null
}

/** Extract feature name from file path */
export function extractFeature(filePath: string): string {
  if (!filePath) return ""

  const genericNames = new Set([
    // General / cross-language
    "src", "lib", "app", "components", "pages", "utils", "hooks",
    "types", "common", "shared", "config", "configs", "core",
    "helpers", "constants", "enums", "interfaces", "base",
    "test", "tests", "spec", "specs", "fixtures", "mocks",
    "assets", "public", "static", "resources", "templates",
    "scripts", "tools", "bin", "gen", "generated", "out",
    // Go
    "cmd", "pkg", "internal", "api", "handler", "handlers",
    "middleware", "middlewares", "repository", "repositories",
    "usecase", "usecases", "domain", "server", "gateway",
    "transport", "grpc", "proto", "pb",
    // Python / Django / FastAPI
    "schemas", "serializers", "migrations", "tasks", "management",
    "templatetags", "settings", "celery",
    // Java / Kotlin / Spring
    "main", "java", "kotlin", "entity", "entities",
    "dto", "dtos", "mapper", "mappers", "configuration",
    "interceptor", "interceptors", "filter", "filters",
    "exception", "exceptions",
    // Node.js / Express / NestJS
    "models", "views", "routers", "controllers", "services",
    "validators", "guards", "pipes", "decorators", "providers",
    // Ruby / Rails
    "concerns", "initializers", "mailers", "jobs", "channels",
    // PHP / Laravel
    "Http", "Console", "database", "routes", "storage",
    "Events", "Listeners", "Mail", "Notifications",
    // Architecture layers (DDD / Clean Architecture)
    "infrastructure", "presentation", "application",
    "adapters", "ports", "aggregates", "valueobjects",
  ])

  // PDCA document path extraction: docs/0X-phase/features/{feature}.{type}.md
  // Also handles journey/ subdirectory: docs/02-design/journey/{feature}.journey.md
  const pdcaMatch = filePath.match(/docs\/0[0-4]-[^/]+\/(?:(?:features|journey)\/)?([^/]+)$/)
  if (pdcaMatch?.[1]) {
    return stripPdcaSuffix(pdcaMatch[1])
  }

  // Try configured feature patterns
  for (const pattern of DEFAULT_FEATURE_PATTERNS) {
    const regex = new RegExp(`${pattern}/([^/]+)`)
    const match = filePath.match(regex)
    if (match?.[1] && !genericNames.has(match[1])) {
      return stripPdcaSuffix(match[1])
    }
  }

  // Fallback: extract from parent directory
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  for (let i = parts.length - 2; i >= 0; i--) {
    if (!genericNames.has(parts[i])) {
      return parts[i]
    }
  }

  return ""
}
