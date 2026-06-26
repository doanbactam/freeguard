const DEFAULT_DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "tempmail.com",
  "tempmail.net",
  "throwawaymail.com",
  "guerrillamail.net",
  "maildrop.cc",
  "sharklasers.com",
  "yopmail.com"
])

const DEFAULTS = {
  signupWindowMs: 60 * 60 * 1000,
  maxSignupsPerIp: 5,
  maxSignupsPerDevice: 3,
  dailyFreeBudgetUsd: 1,
  disposableDomains: DEFAULT_DISPOSABLE_DOMAINS,
  allowEmails: new Set(),
  denyEmails: new Set(),
  allowDomains: new Set(),
  denyDomains: new Set()
}

function today(now) {
  return new Date(now).toISOString().slice(0, 10)
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase()
}

function emailDomain(email) {
  return email.includes("@") ? email.split("@").pop() : ""
}

function money(value) {
  return Number(value.toFixed(6))
}

function assertSync(value, method) {
  if (value && typeof value.then === "function") {
    throw new Error(`${method} requires an async store; use ${method}Async`)
  }
  return value
}

function isFn(value) {
  return typeof value === "function"
}

function createMemoryStore() {
  const events = []
  const usageByUserDay = new Map()
  const stats = { checks: 0, allowed: 0, challenged: 0, denied: 0, savedUsd: 0 }

  return {
    addEvent(event) {
      events.push(event)
    },
    countRecent(field, value, action, since) {
      return events.filter((event) =>
        event[field] === value &&
        event.action === action &&
        event.now >= since
      ).length
    },
    addUsage(key, costUsd) {
      const next = (usageByUserDay.get(key) ?? 0) + costUsd
      usageByUserDay.set(key, next)
      return next
    },
    recordDecision(decision, savedUsd = 0) {
      stats.checks += 1
      if (decision === "allow") stats.allowed += 1
      if (decision === "challenge") stats.challenged += 1
      if (decision === "deny") stats.denied += 1
      stats.savedUsd = money(stats.savedUsd + savedUsd)
    },
    summary() {
      return { ...stats, events: events.length, trackedUsageKeys: usageByUserDay.size }
    },
    reset() {
      events.length = 0
      usageByUserDay.clear()
      stats.checks = 0
      stats.allowed = 0
      stats.challenged = 0
      stats.denied = 0
      stats.savedUsd = 0
    }
  }
}

function createRedisStore(client, options = {}) {
  const prefix = options.prefix ?? "freeguard"
  const eventTtlSeconds = options.eventTtlSeconds ?? 24 * 60 * 60
  const usageTtlSeconds = options.usageTtlSeconds ?? 31 * 24 * 60 * 60
  const statsKey = `${prefix}:stats`

  function key(...parts) {
    return [prefix, ...parts.map((part) => String(part).replaceAll(":", "_"))].join(":")
  }

  async function expire(name, seconds) {
    if (isFn(client.expire)) await client.expire(name, seconds)
  }

  async function hIncr(name, field, amount) {
    if (Number.isInteger(amount) && isFn(client.hIncrBy)) return client.hIncrBy(name, field, amount)
    if (isFn(client.hIncrByFloat)) return client.hIncrByFloat(name, field, amount)
    if (isFn(client.hincrbyfloat)) return client.hincrbyfloat(name, field, amount)
    throw new Error("redis client must support hIncrByFloat")
  }

  return {
    async addEvent(event) {
      const score = event.now
      const value = JSON.stringify({ email: event.email, decision: event.decision, reasons: event.reasons })
      const writes = []

      if (event.ip) writes.push([key("events", "ip", event.action, event.ip), score, value])
      if (event.deviceId) writes.push([key("events", "deviceId", event.action, event.deviceId), score, value])

      for (const [name, scoreValue, member] of writes) {
        if (isFn(client.zAdd)) await client.zAdd(name, [{ score: scoreValue, value: `${scoreValue}:${member}` }])
        else if (isFn(client.zadd)) await client.zadd(name, scoreValue, `${scoreValue}:${member}`)
        else throw new Error("redis client must support zAdd")
        await expire(name, eventTtlSeconds)
      }
    },
    async countRecent(field, value, action, since) {
      const name = key("events", field, action, value)
      const now = Date.now()
      if (isFn(client.zRemRangeByScore)) await client.zRemRangeByScore(name, 0, since - 1)
      else if (isFn(client.zremrangebyscore)) await client.zremrangebyscore(name, 0, since - 1)

      if (isFn(client.zCount)) return Number(await client.zCount(name, since, now))
      if (isFn(client.zcount)) return Number(await client.zcount(name, since, now))
      throw new Error("redis client must support zCount")
    },
    async addUsage(usageKey, costUsd) {
      const name = key("usage", usageKey)
      let next
      if (isFn(client.incrByFloat)) next = await client.incrByFloat(name, costUsd)
      else if (isFn(client.incrbyfloat)) next = await client.incrbyfloat(name, costUsd)
      else throw new Error("redis client must support incrByFloat")
      await expire(name, usageTtlSeconds)
      return Number(next)
    },
    async recordDecision(decision, savedUsd = 0) {
      await hIncr(statsKey, "checks", 1)
      if (decision === "allow") await hIncr(statsKey, "allowed", 1)
      if (decision === "challenge") await hIncr(statsKey, "challenged", 1)
      if (decision === "deny") await hIncr(statsKey, "denied", 1)
      if (savedUsd) await hIncr(statsKey, "savedUsd", savedUsd)
    },
    async summary() {
      const raw = isFn(client.hGetAll) ? await client.hGetAll(statsKey) : await client.hgetall(statsKey)
      return {
        checks: Number(raw.checks ?? 0),
        allowed: Number(raw.allowed ?? 0),
        challenged: Number(raw.challenged ?? 0),
        denied: Number(raw.denied ?? 0),
        savedUsd: money(Number(raw.savedUsd ?? 0)),
        events: 0,
        trackedUsageKeys: 0
      }
    }
  }
}

function createGuard(options = {}) {
  const config = { ...DEFAULTS, ...options }
  const store = config.store ?? createMemoryStore()

  function getCheckContext(input, recentIpSignups, recentDeviceSignups) {
    if (!input || typeof input !== "object") throw new Error("check input is required")

    const now = input.now ?? Date.now()
    const action = input.action ?? "signup"
    const email = normalizeEmail(input.email)
    const domain = emailDomain(email)
    const reasons = []

    if (!email || !domain) reasons.push("invalid_email")
    if (config.denyEmails.has(email)) reasons.push("deny_email")
    if (config.denyDomains.has(domain)) reasons.push("deny_domain")
    if (config.disposableDomains.has(domain)) reasons.push("disposable_email")

    const hardDenied = reasons.length > 0
    const allowedByList = config.allowEmails.has(email) || config.allowDomains.has(domain)

    if (!hardDenied && !allowedByList && action === "signup") {
      if (recentIpSignups >= config.maxSignupsPerIp) reasons.push("ip_signup_velocity")
      if (recentDeviceSignups >= config.maxSignupsPerDevice) reasons.push("device_signup_velocity")
    }

    const decision = allowedByList && !hardDenied
      ? "allow"
      : hardDenied
        ? "deny"
        : reasons.length
          ? "challenge"
          : "allow"

    const event = {
      now,
      action,
      email,
      domain,
      ip: input.ip,
      deviceId: input.deviceId,
      userAgent: input.userAgent,
      decision,
      reasons
    }

    const savedUsd = decision === "deny" ? Number(input.estimatedCostUsd ?? 0) : 0

    const result = {
      decision,
      reasons,
      riskScore: decision === "deny" ? 100 : Math.min(90, reasons.length * 35),
      email,
      domain
    }

    return { event, result, savedUsd }
  }

  function recentCounts(input) {
    if (!input || typeof input !== "object") throw new Error("check input is required")
    const now = input.now ?? Date.now()
    const since = now - config.signupWindowMs
    return {
      ip: input.ip ? assertSync(store.countRecent("ip", input.ip, "signup", since), "check") : 0,
      device: input.deviceId ? assertSync(store.countRecent("deviceId", input.deviceId, "signup", since), "check") : 0
    }
  }

  async function recentCountsAsync(input) {
    if (!input || typeof input !== "object") throw new Error("check input is required")
    const now = input.now ?? Date.now()
    const since = now - config.signupWindowMs
    return {
      ip: input.ip ? await store.countRecent("ip", input.ip, "signup", since) : 0,
      device: input.deviceId ? await store.countRecent("deviceId", input.deviceId, "signup", since) : 0
    }
  }

  function check(input) {
    const counts = recentCounts(input)
    const { event, result, savedUsd } = getCheckContext(input, counts.ip, counts.device)
    assertSync(store.addEvent(event), "check")
    assertSync(store.recordDecision(result.decision, savedUsd), "check")
    return result
  }

  async function checkAsync(input) {
    const counts = await recentCountsAsync(input)
    const { event, result, savedUsd } = getCheckContext(input, counts.ip, counts.device)
    await store.addEvent(event)
    await store.recordDecision(result.decision, savedUsd)
    return result
  }

  function usage(input) {
    if (!input || typeof input !== "object") throw new Error("usage input is required")
    if (!input.userId) throw new Error("userId is required")

    const now = input.now ?? Date.now()
    const costUsd = Number(input.costUsd ?? 0)
    if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("costUsd must be a positive number")

    const key = `${input.userId}:${today(now)}`
    const spentUsd = assertSync(store.addUsage(key, costUsd), "usage")
    const allowed = spentUsd <= config.dailyFreeBudgetUsd
    const remainingUsd = Math.max(0, config.dailyFreeBudgetUsd - spentUsd)

    if (!allowed) assertSync(store.recordDecision("deny", costUsd), "usage")

    return {
      allowed,
      spentUsd: money(spentUsd),
      remainingUsd: money(remainingUsd),
      limitUsd: config.dailyFreeBudgetUsd
    }
  }

  async function usageAsync(input) {
    if (!input || typeof input !== "object") throw new Error("usage input is required")
    if (!input.userId) throw new Error("userId is required")

    const now = input.now ?? Date.now()
    const costUsd = Number(input.costUsd ?? 0)
    if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("costUsd must be a positive number")

    const key = `${input.userId}:${today(now)}`
    const spentUsd = await store.addUsage(key, costUsd)
    const allowed = spentUsd <= config.dailyFreeBudgetUsd
    const remainingUsd = Math.max(0, config.dailyFreeBudgetUsd - spentUsd)

    if (!allowed) await store.recordDecision("deny", costUsd)

    return {
      allowed,
      spentUsd: money(spentUsd),
      remainingUsd: money(remainingUsd),
      limitUsd: config.dailyFreeBudgetUsd
    }
  }

  function summary() {
    return assertSync(store.summary(), "summary")
  }

  async function summaryAsync() {
    return store.summary()
  }

  return { check, checkAsync, usage, usageAsync, summary, summaryAsync, store }
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body

  const chunks = []
  let size = 0
  for await (const chunk of req) chunks.push(chunk)
  for (const chunk of chunks) size += chunk.length
  if (size > 1024 * 1024) throw new Error("request body too large")
  return JSON.parse(Buffer.concat(chunks).toString() || "{}")
}

function createRequestHandler(guard) {
  return async function handleGuardRequest(req, res) {
    try {
      const path = req.url?.split("?")[0]

      if (req.method === "GET" && path === "/freeguard/summary") {
        return sendJson(res, 200, await (isFn(guard.summaryAsync) ? guard.summaryAsync() : guard.summary()))
      }

      if (req.method === "POST" && path === "/freeguard/check") {
        const body = await parseJsonBody(req)
        return sendJson(res, 200, await (isFn(guard.checkAsync) ? guard.checkAsync(body) : guard.check(body)))
      }

      if (req.method === "POST" && path === "/freeguard/usage") {
        const body = await parseJsonBody(req)
        return sendJson(res, 200, await (isFn(guard.usageAsync) ? guard.usageAsync(body) : guard.usage(body)))
      }

      sendJson(res, 404, { error: "not_found" })
    } catch (error) {
      sendJson(res, 400, { error: error.message })
    }
  }
}

function sendJson(res, status, body) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(status).json(body)
  }

  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function expressMiddleware(guard) {
  const handler = createRequestHandler(guard)
  return (req, res, next) => {
    if (!req.url?.startsWith("/freeguard/")) return next()
    handler(req, res)
  }
}

function nextMiddleware(guard, options = {}) {
  return async function guardNextRequest(req) {
    const input = {
      email: options.email?.(req),
      ip: options.ip?.(req) ?? req.headers.get?.("x-forwarded-for")?.split(",")[0],
      userAgent: req.headers.get?.("user-agent"),
      deviceId: options.deviceId?.(req),
      action: options.action ?? "request"
    }

    return isFn(guard.checkAsync) ? guard.checkAsync(input) : guard.check(input)
  }
}

module.exports = {
  createGuard,
  createMemoryStore,
  createRedisStore,
  createRequestHandler,
  expressMiddleware,
  nextMiddleware
}
