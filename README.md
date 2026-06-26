# freeguard

Open-source free-tier abuse guard for AI SaaS. Block fake signups, disposable emails, signup bursts, and free-credit overspend before they burn inference/API cost.

```bash
npm install freeguard
```

```js
import { createGuard } from "freeguard"

const guard = createGuard({
  maxSignupsPerIp: 5,
  maxSignupsPerDevice: 3,
  dailyFreeBudgetUsd: 1
})

const signup = guard.check({
  email,
  ip,
  deviceId,
  action: "signup",
  estimatedCostUsd: 0.03
})

if (signup.decision === "deny") throw new Error("blocked")
if (signup.decision === "challenge") showCaptcha()

const usage = guard.usage({ userId, costUsd: 0.03 })
if (!usage.allowed) throw new Error("free credit limit reached")
```

## What It Checks

- disposable email domains
- too many signups from one IP
- too many signups from one device
- allow/deny email and domain lists
- daily free-credit budget

## Server Helpers

```js
import http from "node:http"
import { createGuard, createRequestHandler } from "freeguard"

http.createServer(createRequestHandler(createGuard())).listen(3000)
```

Routes:

- `GET /freeguard/summary`
- `POST /freeguard/check`
- `POST /freeguard/usage`

## Redis

For multi-server apps, pass your existing Redis client and use async methods:

```js
import { createGuard, createRedisStore } from "freeguard"

const guard = createGuard({ store: createRedisStore(redis) })

await guard.checkAsync({ email, ip, action: "signup" })
await guard.usageAsync({ userId, costUsd: 0.03 })
```

## Demo

```bash
npm run demo
npm test
```

Open `http://localhost:5173`.

## License

MIT
