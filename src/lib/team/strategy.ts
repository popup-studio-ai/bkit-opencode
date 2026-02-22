// Team Strategy Module
// Level-based Agent Teams strategy definitions with CTO-Led Team support.
// Ported from bkit-claude-code lib/team/strategy.js to TypeScript for OpenCode.
//
// v2: ROLE_CATALOG + keyword-based dynamic role selection.
// TEAM_STRATEGIES kept for backward compatibility but derives from ROLE_CATALOG.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamRole {
  name: string
  description: string
  agents: string[]
  phases: string[]
}

export interface TeamStrategy {
  teammates: number
  ctoAgent: string
  roles: TeamRole[]
  phaseStrategy: Record<string, string>
}

export interface RoleDef {
  name: string
  description: string
  agents: string[]
  phases: string[]
  keywords: string[]
  alwaysInPhase?: string[]
}

export interface LevelConfig {
  maxRecommended: number
  phaseStrategy: Record<string, string>
}

export interface SelectedRole {
  role: RoleDef
  matchedKeywords: string[]
  matchReason: "keyword" | "alwaysInPhase" | "phaseFallback"
}

// ---------------------------------------------------------------------------
// Role Catalog (pool of all available roles)
// ---------------------------------------------------------------------------

export const ROLE_CATALOG: RoleDef[] = [
  {
    name: "backend",
    description: "Backend API, server logic, database",
    agents: ["backend-expert"],
    phases: ["design", "do", "act"],
    keywords: ["api", "backend", "server", "database", "db", "rest", "graphql", "endpoint", "migration"],
  },
  {
    name: "frontend",
    description: "UI/UX, components, design system",
    agents: ["frontend-architect"],
    phases: ["design", "do", "act"],
    keywords: ["ui", "frontend", "component", "react", "next", "css", "page", "form", "design system", "layout"],
  },
  {
    name: "baas",
    description: "BaaS platform (bkend.ai) integration",
    agents: ["baas-expert"],
    phases: ["design", "do", "check", "act"],
    keywords: ["bkend", "baas", "supabase", "firebase", "login", "signup", "social login"],
  },
  {
    name: "infra",
    description: "Cloud infrastructure, CI/CD, deployment",
    agents: ["infra-architect"],
    phases: ["design", "do"],
    keywords: ["aws", "kubernetes", "k8s", "terraform", "docker", "ci/cd", "deploy", "infra", "eks", "rds"],
  },
  {
    name: "security",
    description: "Security architecture, vulnerability analysis",
    agents: ["security-architect"],
    phases: ["design", "check"],
    keywords: ["security", "auth", "owasp", "vulnerability", "csrf", "xss", "encryption", "token", "jwt"],
  },
  {
    name: "qa",
    description: "Quality verification, gap analysis, testing",
    agents: ["qa-strategist", "qa-monitor", "gap-detector"],
    phases: ["check"],
    keywords: [],
    alwaysInPhase: ["check"],
  },
  {
    name: "reviewer",
    description: "Code review and design validation",
    agents: ["code-analyzer", "design-validator"],
    phases: ["check", "act"],
    keywords: ["review", "quality", "refactor"],
    alwaysInPhase: ["check"],
  },
  {
    name: "architect",
    description: "System architecture, microservices design",
    agents: ["enterprise-expert"],
    phases: ["design"],
    keywords: ["microservice", "architecture", "enterprise", "distributed", "scalab", "monorepo"],
  },
]

// ---------------------------------------------------------------------------
// Level Configuration (max recommendations + phase patterns)
// ---------------------------------------------------------------------------

export const LEVEL_CONFIG: Record<string, LevelConfig | null> = {
  Starter: null,
  Dynamic: {
    maxRecommended: 3,
    phaseStrategy: {
      plan: "single",
      design: "leader",
      do: "swarm",
      check: "council",
      act: "leader",
    },
  },
  Enterprise: {
    maxRecommended: 5,
    phaseStrategy: {
      plan: "single",
      design: "council",
      do: "swarm",
      check: "council",
      act: "watchdog",
    },
  },
}

// ---------------------------------------------------------------------------
// Dynamic Role Selection
// ---------------------------------------------------------------------------

/**
 * Select roles from the catalog based on feature keywords and phase.
 *
 * Selection logic:
 * 1. Roles with `alwaysInPhase` matching the current phase are always included.
 * 2. Feature name/description is matched against role keywords (case-insensitive).
 * 3. If no keyword matches are found, all roles for the current phase are included as fallback.
 * 4. Results are sorted by match count (desc) and trimmed to `maxRecommended`.
 */
export function selectRolesForFeature(
  featureName: string,
  phase: string,
  level: string,
  featureDescription?: string,
): SelectedRole[] {
  const config = LEVEL_CONFIG[level]
  if (!config) return []

  const searchText = `${featureName} ${featureDescription ?? ""}`.toLowerCase()
  const selected: SelectedRole[] = []
  const addedNames = new Set<string>()

  // 1. Always-in-phase roles
  for (const role of ROLE_CATALOG) {
    if (role.alwaysInPhase?.includes(phase) && role.phases.includes(phase)) {
      selected.push({ role, matchedKeywords: [], matchReason: "alwaysInPhase" })
      addedNames.add(role.name)
    }
  }

  // 2. Keyword matching
  for (const role of ROLE_CATALOG) {
    if (addedNames.has(role.name)) continue
    if (!role.phases.includes(phase)) continue

    const matched = role.keywords.filter((kw) => searchText.includes(kw.toLowerCase()))
    if (matched.length > 0) {
      selected.push({ role, matchedKeywords: matched, matchReason: "keyword" })
      addedNames.add(role.name)
    }
  }

  // 3. Fallback: if no keyword matches, include all phase-eligible roles
  if (selected.every((s) => s.matchReason === "alwaysInPhase")) {
    for (const role of ROLE_CATALOG) {
      if (addedNames.has(role.name)) continue
      if (!role.phases.includes(phase)) continue
      selected.push({ role, matchedKeywords: [], matchReason: "phaseFallback" })
      addedNames.add(role.name)
    }
  }

  // 4. Sort: keyword matches first (by match count desc), then alwaysInPhase, then fallback
  selected.sort((a, b) => {
    const order = { keyword: 0, alwaysInPhase: 1, phaseFallback: 2 }
    const orderDiff = order[a.matchReason] - order[b.matchReason]
    if (orderDiff !== 0) return orderDiff
    return b.matchedKeywords.length - a.matchedKeywords.length
  })

  // 5. Trim to maxRecommended (recommendation only — CTO can override)
  return selected.slice(0, config.maxRecommended)
}

// ---------------------------------------------------------------------------
// Backward-compatible Strategy Definitions (derived from ROLE_CATALOG)
// ---------------------------------------------------------------------------

function buildStrategyFromCatalog(level: string): TeamStrategy | null {
  const config = LEVEL_CONFIG[level]
  if (!config) return null

  // Collect all unique roles that have at least one phase
  const roles: TeamRole[] = ROLE_CATALOG
    .filter((r) => r.phases.length > 0)
    .map((r) => ({
      name: r.name,
      description: r.description,
      agents: r.agents,
      phases: r.phases,
    }))

  return {
    teammates: config.maxRecommended,
    ctoAgent: "cto-lead",
    roles,
    phaseStrategy: config.phaseStrategy,
  }
}

/**
 * @deprecated Use ROLE_CATALOG + selectRolesForFeature() for dynamic role selection.
 * Kept for backward compatibility. Now returns all catalog roles for the level.
 */
export const TEAM_STRATEGIES: Record<string, TeamStrategy | null> = {
  Starter: null,
  Dynamic: buildStrategyFromCatalog("Dynamic"),
  Enterprise: buildStrategyFromCatalog("Enterprise"),
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get teammate roles for a project level.
 * @deprecated Use selectRolesForFeature() for feature-aware role selection.
 */
export function getTeammateRoles(level: string): TeamRole[] {
  const strategy = TEAM_STRATEGIES[level]
  return strategy?.roles ?? []
}

/**
 * Get the strategy for a specific level (or null for Starter).
 * @deprecated Use LEVEL_CONFIG + ROLE_CATALOG for dynamic configuration.
 */
export function getStrategy(level: string): TeamStrategy | null {
  return TEAM_STRATEGIES[level] ?? null
}

/**
 * List all levels that support team mode (non-null strategies).
 */
export function getTeamCapableLevels(): string[] {
  return Object.entries(LEVEL_CONFIG)
    .filter(([, config]) => config !== null)
    .map(([level]) => level)
}
