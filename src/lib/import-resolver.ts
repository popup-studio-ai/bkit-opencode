/**
 * Import Resolver
 * Resolves @import directives and ${VARIABLE} substitutions in markdown files.
 * Ported from bkit-claude-code lib/import-resolver.js
 */

import { join, dirname, resolve } from "path"
import { existsSync, readFileSync } from "fs"
import { debugLog } from "./core/debug"
import { getPluginRoot, getProjectDir } from "./core/platform"
import { homedir } from "os"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IMPORT_CACHE_TTL = 30_000 // 30 seconds

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _importStack = new Set<string>()
const _importCache = new Map<string, { content: string; timestamp: number }>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Resolve ${VARIABLE} placeholders in import paths */
export function resolveVariables(importPath: string): string {
  const pluginRoot = getPluginRoot()
  const projectDir = getProjectDir()
  const userConfigDir = join(homedir(), ".opencode", "bkit")

  return importPath
    .replace(/\$\{PLUGIN_ROOT\}/g, pluginRoot)
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot) // backward compat with bkit-claude-code paths
    .replace(/\$\{PROJECT\}/g, projectDir)
    .replace(/\$\{USER_CONFIG\}/g, userConfigDir)
}

/** Resolve relative import path to absolute */
export function resolveImportPath(importPath: string, fromFile: string): string {
  let resolved = resolveVariables(importPath)
  if (resolved.startsWith("./") || resolved.startsWith("../")) {
    resolved = resolve(dirname(fromFile), resolved)
  }
  return resolved
}

/** Load file content with caching */
export function loadImportedContent(absolutePath: string): string {
  const cached = _importCache.get(absolutePath)
  if (cached && Date.now() - cached.timestamp < IMPORT_CACHE_TTL) {
    return cached.content
  }

  try {
    if (!existsSync(absolutePath)) {
      debugLog("ImportResolver", "Import file not found", { path: absolutePath })
      return ""
    }
    const content = readFileSync(absolutePath, "utf8")
    _importCache.set(absolutePath, { content, timestamp: Date.now() })
    return content
  } catch (e: any) {
    debugLog("ImportResolver", "Failed to load import", { path: absolutePath, error: e.message })
    return ""
  }
}

/** Check for circular import */
export function detectCircularImport(absolutePath: string): boolean {
  return _importStack.has(absolutePath)
}

/** Resolve all imports from a frontmatter's imports array */
export function resolveImports(
  frontmatter: { imports?: string[] },
  sourceFile: string,
): { content: string; errors: string[] } {
  const imports = frontmatter.imports || []
  if (!Array.isArray(imports) || imports.length === 0) {
    return { content: "", errors: [] }
  }

  const errors: string[] = []
  const contents: string[] = []

  for (const importPath of imports) {
    const absolutePath = resolveImportPath(importPath, sourceFile)

    if (detectCircularImport(absolutePath)) {
      errors.push(`Circular import detected: ${importPath}`)
      continue
    }

    _importStack.add(absolutePath)
    try {
      const content = loadImportedContent(absolutePath)
      if (content) {
        contents.push(`<!-- Imported from: ${importPath} -->\n${content}`)
      } else {
        errors.push(`Failed to load: ${importPath}`)
      }
    } finally {
      _importStack.delete(absolutePath)
    }
  }

  return { content: contents.join("\n\n"), errors }
}

/** Parse frontmatter from markdown content */
export function extractFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  try {
    const yamlStr = match[1]
    const frontmatter: Record<string, unknown> = {}

    const importsMatch = yamlStr.match(/imports:\s*\n((?:\s+-\s+.+\n?)+)/)
    if (importsMatch) {
      frontmatter.imports = importsMatch[1]
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("-"))
        .map(line => line.replace(/^-\s+/, "").trim())
    }

    for (const line of yamlStr.split("\n")) {
      const kvMatch = line.match(/^(\w+):\s*(.+)$/)
      if (kvMatch && kvMatch[1] !== "imports") {
        frontmatter[kvMatch[1]] = kvMatch[2].trim()
      }
    }

    return { frontmatter, body: match[2] }
  } catch {
    return { frontmatter: {}, body: content }
  }
}

/** Process a markdown file, resolving all imports */
export function processMarkdownWithImports(filePath: string): { content: string; errors: string[] } {
  if (!existsSync(filePath)) {
    return { content: "", errors: [`File not found: ${filePath}`] }
  }

  const content = readFileSync(filePath, "utf8")
  const { frontmatter, body } = extractFrontmatter(content)

  if (!frontmatter.imports || !Array.isArray(frontmatter.imports) || frontmatter.imports.length === 0) {
    return { content, errors: [] }
  }

  const { content: importedContent, errors } = resolveImports(
    frontmatter as { imports: string[] },
    filePath,
  )

  if (importedContent) {
    const processedContent = content.replace(
      /^(---[\s\S]*?---\r?\n)/,
      `$1\n${importedContent}\n\n`,
    )
    return { content: processedContent, errors }
  }

  return { content, errors }
}

export function clearImportCache(): void {
  _importCache.clear()
}

export function getCacheStats(): { size: number; entries: string[] } {
  return { size: _importCache.size, entries: Array.from(_importCache.keys()) }
}
