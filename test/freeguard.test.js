import assert from "node:assert/strict"
import { createGuard, createRedisStore, createRequestHandler } from "../src/index.js"

const guard = createGuard({ maxSignupsPerIp: 2, maxSignupsPerDevice: 2, dailyFreeBudgetUsd: 0.1 })

assert.equal(
  guard.check({ email: "bot@mailinator.com", ip: "1.1.1.1", action: "signup", estimatedCostUsd: 0.02 }).decision,
  "deny"
)

assert.equal(
  guard.check({ email: "a@example.com", ip: "2.2.2.2", action: "signup", now: 1 }).decision,
  "allow"
)
assert.equal(
  guard.check({ email: "b@example.com", ip: "2.2.2.2", action: "signup", now: 2 }).decision,
  "allow"
)
assert.deepEqual(
  guard.check({ email: "c@example.com", ip: "2.2.2.2", action: "signup", now: 3 }),
  {
    decision: "challenge",
    reasons: ["ip_signup_velocity"],
    riskScore: 35,
    email: "c@example.com",
    domain: "example.com"
  }
)

assert.equal(
  guard.check({ email: "d@example.com", deviceId: "device-1", action: "signup", now: 4 }).decision,
  "allow"
)
assert.equal(
  guard.check({ email: "e@example.com", deviceId: "device-1", action: "signup", now: 5 }).decision,
  "allow"
)
assert.equal(
  guard.check({ email: "f@example.com", deviceId: "device-1", action: "signup", now: 6 }).decision,
  "challenge"
)

const listedGuard = createGuard({
  allowDomains: new Set(["trusted.com"]),
  denyEmails: new Set(["blocked@trusted.com"]),
  maxSignupsPerIp: 0
})

assert.equal(
  listedGuard.check({ email: "ok@trusted.com", ip: "3.3.3.3", action: "signup" }).decision,
  "allow"
)
assert.equal(
  listedGuard.check({ email: "blocked@trusted.com", ip: "3.3.3.3", action: "signup" }).decision,
  "deny"
)

const customStore = {
  events: [],
  addEvent(event) {
    this.events.push(event)
  },
  countRecent(field, value, action, since) {
    return this.events.filter((event) =>
      event[field] === value &&
      event.action === action &&
      event.now >= since
    ).length
  },
  addUsage(key, costUsd) {
    return costUsd
  },
  recordDecision() {},
  summary() {
    return { checks: 0, allowed: 0, challenged: 0, denied: 0, savedUsd: 0, events: this.events.length, trackedUsageKeys: 0 }
  }
}
const customGuard = createGuard({ store: customStore, maxSignupsPerIp: 1 })
assert.equal(customGuard.check({ email: "one@example.com", ip: "4.4.4.4", action: "signup", now: 10 }).decision, "allow")
assert.equal(customGuard.check({ email: "two@example.com", ip: "4.4.4.4", action: "signup", now: 11 }).decision, "challenge")

const asyncGuard = createGuard({
  store: {
    async addEvent() {},
    async countRecent() { return 0 },
    async addUsage(key, costUsd) { return costUsd },
    async recordDecision() {},
    async summary() {
      return { checks: 0, allowed: 0, challenged: 0, denied: 0, savedUsd: 0, events: 0, trackedUsageKeys: 0 }
    }
  }
})
assert.throws(() => asyncGuard.check({ email: "async@example.com", action: "signup" }), /checkAsync/)
assert.equal(
  (await asyncGuard.checkAsync({ email: "async@example.com", action: "signup" })).decision,
  "allow"
)

assert.deepEqual(
  guard.usage({ userId: "user_1", costUsd: 0.04, now: 1 }),
  { allowed: true, spentUsd: 0.04, remainingUsd: 0.06, limitUsd: 0.1 }
)
assert.deepEqual(
  guard.usage({ userId: "user_1", costUsd: 0.07, now: 1 }),
  { allowed: false, spentUsd: 0.11, remainingUsd: 0, limitUsd: 0.1 }
)
assert.throws(() => guard.usage({ userId: "user_2", costUsd: -1 }), /costUsd/)

assert.equal(guard.summary().denied, 2)
assert.equal(guard.summary().challenged, 2)
assert.equal(guard.summary().savedUsd, 0.09)

function createFakeRedis() {
  const strings = new Map()
  const hashes = new Map()
  const zsets = new Map()

  return {
    async zAdd(name, items) {
      const list = zsets.get(name) ?? []
      list.push(...items)
      zsets.set(name, list)
    },
    async zRemRangeByScore(name, min, max) {
      zsets.set(name, (zsets.get(name) ?? []).filter((item) => item.score < min || item.score > max))
    },
    async zCount(name, min, max) {
      return (zsets.get(name) ?? []).filter((item) => item.score >= min && item.score <= max).length
    },
    async incrByFloat(name, amount) {
      const next = (strings.get(name) ?? 0) + amount
      strings.set(name, next)
      return next
    },
    async hIncrByFloat(name, field, amount) {
      const hash = hashes.get(name) ?? {}
      hash[field] = Number(hash[field] ?? 0) + amount
      hashes.set(name, hash)
      return hash[field]
    },
    async hGetAll(name) {
      return hashes.get(name) ?? {}
    },
    async expire() {}
  }
}

const redisGuard = createGuard({
  store: createRedisStore(createFakeRedis()),
  maxSignupsPerIp: 1,
  dailyFreeBudgetUsd: 0.05
})
assert.equal((await redisGuard.checkAsync({ email: "one@example.com", ip: "5.5.5.5", action: "signup", now: 100 })).decision, "allow")
assert.equal((await redisGuard.checkAsync({ email: "two@example.com", ip: "5.5.5.5", action: "signup", now: 101 })).decision, "challenge")
assert.deepEqual(
  await redisGuard.usageAsync({ userId: "redis_user", costUsd: 0.06, now: 100 }),
  { allowed: false, spentUsd: 0.06, remainingUsd: 0, limitUsd: 0.05 }
)
assert.equal((await redisGuard.summaryAsync()).denied, 1)

assert.equal(typeof createRequestHandler(createGuard()), "function")

console.log("freeguard checks passed")
