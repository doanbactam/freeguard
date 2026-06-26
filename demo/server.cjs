const http = require("node:http")
const { createGuard, createRequestHandler } = require("../src/index.cjs")

const guard = createGuard({ maxSignupsPerIp: 2, maxSignupsPerDevice: 2, dailyFreeBudgetUsd: 0.1 })
const api = createRequestHandler(guard)

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>freeguard demo</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font: 15px system-ui, sans-serif; background: #f5f6f8; color: #17181a; }
    main { width: min(1040px, 100%); margin: 0 auto; padding: 28px 16px; }
    h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    p { margin: 0 0 18px; color: #555f6d; }
    section { background: white; border: 1px solid #dfe3e8; border-radius: 8px; padding: 16px; min-width: 0; }
    label { display: grid; gap: 6px; margin: 10px 0; font-weight: 650; }
    input, select { width: 100%; padding: 10px 12px; border: 1px solid #c8ced6; border-radius: 6px; font: inherit; background: white; }
    button { padding: 10px 14px; border: 0; border-radius: 6px; background: #1459d9; color: white; font-weight: 750; cursor: pointer; }
    button.secondary { background: #303741; }
    button:active { transform: translateY(1px); }
    pre { min-height: 112px; padding: 12px; overflow: auto; border-radius: 6px; background: #111827; color: #e5e7eb; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 14px 0; }
    .stat { background: white; border: 1px solid #dfe3e8; border-radius: 8px; padding: 12px; }
    .stat strong { display: block; font-size: 22px; margin-top: 4px; }
    @media (max-width: 760px) {
      .grid, .stats { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <h1>freeguard demo</h1>
    <p>Test signup abuse and free-credit usage with the local open-source core.</p>

    <div class="stats" id="stats"></div>

    <div class="grid">
      <section>
        <h2>Signup check</h2>
        <label>Email <input id="email" value="test@example.com"></label>
        <label>IP <input id="ip" value="1.1.1.1"></label>
        <label>Device ID <input id="deviceId" value="device-a"></label>
        <label>Estimated cost USD <input id="estimatedCostUsd" type="number" step="0.01" value="0.03"></label>
        <div class="row">
          <button id="check">Check signup</button>
          <button class="secondary" id="presetDisposable">Disposable email</button>
          <button class="secondary" id="presetVelocity">Repeat IP</button>
        </div>
        <pre id="checkResult">{}</pre>
      </section>

      <section>
        <h2>Usage check</h2>
        <label>User ID <input id="userId" value="user_123"></label>
        <label>Cost USD <input id="costUsd" type="number" step="0.01" value="0.04"></label>
        <div class="row">
          <button id="usage">Track usage</button>
          <button class="secondary" id="presetOverBudget">Spend 0.12</button>
        </div>
        <pre id="usageResult">{}</pre>
      </section>
    </div>
  </main>

  <script>
    async function post(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
      return res.json()
    }

    async function refreshSummary() {
      const summary = await fetch("/freeguard/summary").then((res) => res.json())
      stats.innerHTML = [
        ["Checks", summary.checks],
        ["Allowed", summary.allowed],
        ["Challenged", summary.challenged],
        ["Denied", summary.denied],
        ["Saved", "$" + summary.savedUsd.toFixed(2)]
      ].map(([label, value]) => '<div class="stat">' + label + '<strong>' + value + '</strong></div>').join("")
    }

    async function runCheck() {
      checkResult.textContent = JSON.stringify(await post("/freeguard/check", {
        email: email.value,
        ip: ip.value,
        deviceId: deviceId.value,
        userAgent: navigator.userAgent,
        estimatedCostUsd: Number(estimatedCostUsd.value),
        action: "signup"
      }), null, 2)
      refreshSummary()
    }

    async function runUsage() {
      usageResult.textContent = JSON.stringify(await post("/freeguard/usage", {
        userId: userId.value,
        costUsd: Number(costUsd.value)
      }), null, 2)
      refreshSummary()
    }

    check.onclick = runCheck
    usage.onclick = runUsage
    presetDisposable.onclick = () => { email.value = "bot@mailinator.com"; runCheck() }
    presetVelocity.onclick = async () => {
      email.value = "a@example.com"; ip.value = "8.8.8.8"; await runCheck()
      email.value = "b@example.com"; await runCheck()
      email.value = "c@example.com"; await runCheck()
    }
    presetOverBudget.onclick = () => { costUsd.value = "0.12"; runUsage() }

    refreshSummary()
  </script>
</body>
</html>`

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" })
    return res.end(page)
  }

  api(req, res)
})

const port = Number(process.env.PORT ?? 5173)

server.listen(port, "127.0.0.1", () => {
  console.log(`freeguard demo: http://localhost:${port}`)
})
