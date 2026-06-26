export type GuardDecision = "allow" | "challenge" | "deny"

export type GuardOptions = {
  signupWindowMs?: number
  maxSignupsPerIp?: number
  maxSignupsPerDevice?: number
  dailyFreeBudgetUsd?: number
  disposableDomains?: Set<string>
  allowEmails?: Set<string>
  denyEmails?: Set<string>
  allowDomains?: Set<string>
  denyDomains?: Set<string>
  store?: GuardStore | AsyncGuardStore
}

export type CheckInput = {
  email?: string
  ip?: string
  userAgent?: string
  deviceId?: string
  action?: string
  estimatedCostUsd?: number
  now?: number
}

export type CheckResult = {
  decision: GuardDecision
  reasons: string[]
  riskScore: number
  email: string
  domain: string
}

export type UsageInput = {
  userId: string
  costUsd?: number
  now?: number
}

export type UsageResult = {
  allowed: boolean
  spentUsd: number
  remainingUsd: number
  limitUsd: number
}

export type GuardSummary = {
  checks: number
  allowed: number
  challenged: number
  denied: number
  savedUsd: number
  events: number
  trackedUsageKeys: number
}

export type GuardStore = {
  addEvent(event: Record<string, unknown>): void
  countRecent(field: string, value: string, action: string, since: number): number
  addUsage(key: string, costUsd: number): number
  recordDecision(decision: GuardDecision, savedUsd?: number): void
  summary(): GuardSummary
  reset?(): void
}

export type AsyncGuardStore = {
  addEvent(event: Record<string, unknown>): Promise<void>
  countRecent(field: string, value: string, action: string, since: number): Promise<number>
  addUsage(key: string, costUsd: number): Promise<number>
  recordDecision(decision: GuardDecision, savedUsd?: number): Promise<void>
  summary(): Promise<GuardSummary>
}

export function createMemoryStore(): GuardStore

export function createRedisStore(
  client: Record<string, (...args: unknown[]) => unknown>,
  options?: {
    prefix?: string
    eventTtlSeconds?: number
    usageTtlSeconds?: number
  }
): AsyncGuardStore

export function createGuard(options?: GuardOptions): {
  check(input: CheckInput): CheckResult
  checkAsync(input: CheckInput): Promise<CheckResult>
  usage(input: UsageInput): UsageResult
  usageAsync(input: UsageInput): Promise<UsageResult>
  summary(): GuardSummary
  summaryAsync(): Promise<GuardSummary>
  store: GuardStore | AsyncGuardStore
}

export function createRequestHandler(guard: ReturnType<typeof createGuard>): unknown

export function expressMiddleware(guard: ReturnType<typeof createGuard>): unknown

export function nextMiddleware(
  guard: ReturnType<typeof createGuard>,
  options?: {
    email?: (req: Request) => string | undefined
    ip?: (req: Request) => string | undefined
    deviceId?: (req: Request) => string | undefined
    action?: string
  }
): (req: Request) => Promise<CheckResult>
