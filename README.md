# freeguard

Open-source free-tier abuse guard for AI SaaS.

It helps block fake signups, disposable emails, signup velocity abuse, and free-credit overspend before they burn inference/API cost.

```bash
npm install freeguard
```

## Basic use

```js
import { createGuard } from "freeguard"
// or: const { createGuard } = require("freeguard")

const guard = createGuard({
  maxSignupsPerIp: 5,
  maxSignupsPerDevice: 3,
  dailyFreeBudgetUsd: 1
})

const result = guard.check({
  email,
  ip,
  deviceId,
  userAgent,
  estimatedCostUsd: 0.03,
  action: "signup"
})

if (result.decision === "deny") {
  return new Response("Blocked", { status: 403 })
}

if (result.decision === "challenge") {
  // Show CAPTCHA, email verification, or manual review.
}
```

Track free AI usage:

```js
const usage = guard.usage({
  userId: "user_123",
  costUsd: 0.03
})

if (!usage.allowed) {
  return new Response("Free credit limit reached", { status: 402 })
}
```

## HTTP routes

Use the built-in request handler with Node's `http` server:

```js
import http from "node:http"
import { createGuard, createRequestHandler } from "freeguard"

const guard = createGuard()
http.createServer(createRequestHandler(guard)).listen(3000)
```

Routes:

- `GET /freeguard/summary`
- `POST /freeguard/check`
- `POST /freeguard/usage`

## Express

```js
import express from "express"
import { createGuard, expressMiddleware } from "freeguard"

const app = express()
const guard = createGuard()

app.use(express.json())
app.use(expressMiddleware(guard))
```

## Next.js

```js
import { createGuard, nextMiddleware } from "freeguard"

const guard = createGuard()
const checkRequest = nextMiddleware(guard, {
  action: "signup",
  email: (req) => req.nextUrl.searchParams.get("email")
})

export async function middleware(req) {
  const result = await checkRequest(req)
  if (result.decision === "deny") {
    return Response.json({ error: "blocked" }, { status: 403 })
  }
}
```

## Demo

```bash
npm run demo
```

Open `http://localhost:5173`.

## API

### `createGuard(options)`

Options:

- `maxSignupsPerIp`: default `5`
- `maxSignupsPerDevice`: default `3`
- `signupWindowMs`: default `3600000`
- `dailyFreeBudgetUsd`: default `1`
- `disposableDomains`: `Set<string>`
- `allowEmails`: `Set<string>`
- `denyEmails`: `Set<string>`
- `allowDomains`: `Set<string>`
- `denyDomains`: `Set<string>`
- `store`: custom store adapter

### `guard.check(input)`

Returns:

```js
{
  decision: "allow" | "challenge" | "deny",
  reasons: ["disposable_email"],
  riskScore: 100,
  email: "bot@mailinator.com",
  domain: "mailinator.com"
}
```

### `guard.usage(input)`

Returns:

```js
{ allowed: true, spentUsd: 0.03, remainingUsd: 0.97, limitUsd: 1 }
```

### Async stores

If your store talks to Redis or a database, use the async methods:

```js
const result = await guard.checkAsync({ email, ip, action: "signup" })
const usage = await guard.usageAsync({ userId, costUsd: 0.03 })
const summary = await guard.summaryAsync()
```

### `guard.summary()`

Returns:

```js
{ checks: 10, allowed: 7, challenged: 1, denied: 2, savedUsd: 0.12 }
```

## Custom store

The default store is in-memory and works for one Node process. For multiple servers, pass a Redis/database-backed store with this shape:

```js
const store = {
  addEvent(event) {},
  countRecent(field, value, action, since) { return 0 },
  addUsage(key, costUsd) { return costUsd },
  recordDecision(decision, savedUsd) {},
  summary() { return {} }
}

const guard = createGuard({ store })
```

## Redis store

`freeguard` does not install Redis for you. Pass an existing Redis client:

```js
import { createClient } from "redis"
import { createGuard, createRedisStore } from "freeguard"

const redis = await createClient({ url: process.env.REDIS_URL }).connect()
const guard = createGuard({
  store: createRedisStore(redis),
  maxSignupsPerIp: 5,
  dailyFreeBudgetUsd: 1
})

const result = await guard.checkAsync({
  email,
  ip,
  action: "signup"
})
```

The Redis store needs a client with `zAdd`, `zCount`, `incrByFloat`, `hIncrByFloat`, `hGetAll`, and `expire`.

## Production note

This is the open-source core. It is enough for local apps, prototypes, and single-process deployments. For serious production, use a shared store so velocity and usage limits work across all servers.
