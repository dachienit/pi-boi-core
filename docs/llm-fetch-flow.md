# LLM Fetch Flow — Bosch GenAI Platform (LLM Farm)

How oct (core-service) calls the LLM Farm endpoint, and what differs across
local, SAP BAS, and SAP BTP environments.

---

## Architecture overview

```
browser (web-ui)          Vite dev server          core-service (port 3030)          LLM Farm
     |                         |                            |                            |
     |-- POST /chat ---------->| --- proxy --------------->|                            |
     |                         |  (vite.config.ts)         |                            |
     |                         |                           |-- fetch (openai SDK) ----->|
     |                         |                           |<-- streaming response -----|
     |<-- SSE stream --------- |<--------------------------|                            |
```

## Startup sequence

### 1. `bootstrap.ts` (entry point: `dist/bootstrap.js`)

Runs **before** any library loads. Handles proxy env cleanup for SAP BAS/BTP.

```
1. Read .env manually (fs.readFileSync) to check if PROX is defined
2. If PROX is absent:
   - Delete HTTP_PROXY, HTTPS_PROXY, http_proxy, https_proxy from process.env
   - Set NO_PROXY=* and no_proxy=*
   - This prevents pi-ai's EnvHttpProxyAgent from using SAP BAS system proxy
3. await import("./main.js")  ← dynamic import, so cleanup runs first
```

**Why a separate file?**
In ES modules all `import` statements are hoisted. If the cleanup were inside
`main.ts`, the pi-ai library would already have read `HTTP_PROXY` during its
import phase and created an `EnvHttpProxyAgent` pointing to the SAP BAS
internal proxy (`http://127.0.0.1:8887`), which cannot reach external endpoints.

### 2. `main.ts`

```
1. import "dotenv/config"          → loads .env into process.env
2. Proxy setup (undici):
   - If PROX is set → create ProxyAgent with basic auth, setGlobalDispatcher
   - (for local corporate proxy only)
3. Fetch wrapper (globalThis.fetch):
   - Intercepts all fetch calls to the LLM base URL
   - Appends ?api-version=... query param (required by Azure OpenAI)
4. Import agent, http server, etc.
5. Start HTTP SSE server on port 3030
```

### 3. `agent.ts` — model configuration

```
1. Read env vars: LLM_PROVIDER, LLM_MODEL, LLM_BASE_URL, LLM_API_KEY, LLM_AUTH_HEADER
2. Use groq/llama3-70b-8192 as model template (for openai-completions API shape)
3. Override template with custom settings:
   - model.id = LLM_MODEL
   - model.baseUrl = LLM_BASE_URL
   - model.headers[LLM_AUTH_HEADER] = LLM_API_KEY
4. Create Agent → AgentSession with this model
```

## Actual LLM call chain

When a user sends a message:

```
1. HTTP POST /chat → http.ts handleChat()
2. handler.handleEvent() → agent.ts runner.run()
3. session.prompt(userMessage)
4. pi-ai library → openai-completions.js → new OpenAI({ baseURL, defaultHeaders })
5. OpenAI SDK → getDefaultFetch() → returns globalThis.fetch (our patched version)
6. Our fetch wrapper:
   - Checks if URL starts with LLM_BASE_URL
   - Appends ?api-version=2025-04-01-preview
   - Calls original native fetch
7. Native fetch uses undici global dispatcher:
   - Local: ProxyAgent (via PROX)
   - SAP BAS/BTP: default agent (no proxy, cleaned by bootstrap)
8. Request reaches: https://aoai-farm.bosch-temp.com/api/openai/deployments/{model}/chat/completions
   - Header: genaiplatform-farm-subscription-key: {LLM_API_KEY}
   - Body: { model, messages, stream: true, ... }
9. Streaming response flows back through SSE to browser
```

## Environment differences

| | Local | SAP BAS | SAP BTP |
|---|---|---|---|
| `.env` PROX | `http://127.0.0.1:3128` | commented out (`#PROX=...`) | commented out |
| System `HTTP_PROXY` | not set | `http://127.0.0.1:8887` (injected by platform) | varies |
| bootstrap.ts action | detects PROX in .env → keeps proxy vars | no PROX → clears proxy vars, sets `NO_PROXY=*` | same as BAS |
| main.ts proxy | `setGlobalDispatcher(ProxyAgent)` with basic auth | no proxy setup | no proxy setup |
| fetch path | native fetch → ProxyAgent → corporate proxy → LLM Farm | native fetch → direct → LLM Farm | native fetch → direct → LLM Farm |

## Key files

| File | Role |
|---|---|
| `core-service/src/bootstrap.ts` | Entry point. Cleans proxy env vars before any import |
| `core-service/src/main.ts` | Proxy setup (undici), fetch wrapper (api-version), starts server |
| `core-service/src/agent.ts` | Model config, agent/session creation, LLM call orchestration |
| `core-service/.env` | `PROX`, `LLM_*` config vars |
| `web-ui/example/vite.config.ts` | Vite proxy — forwards `/chat`, `/sessions`, etc. to `localhost:3030` |
| `web-ui/example/src/main.ts` | UI entry — `baseUrl` defaults to `""` (relative, goes through Vite proxy) |

## pi-ai library internals (relevant)

The `@mariozechner/pi-ai` library has a side-effect import:

```
stream.js → import "./utils/http-proxy.js"
```

`http-proxy.js` unconditionally runs:

```js
import("undici").then((m) => {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = m;
    setGlobalDispatcher(new EnvHttpProxyAgent());
});
```

`EnvHttpProxyAgent` reads `HTTP_PROXY`/`HTTPS_PROXY` at construction time.
This is why `bootstrap.ts` must clear those vars **before** main.ts imports
anything from pi-ai.

## Troubleshooting

**"TypeError: Failed to fetch" on SAP BAS**

1. Check if it's browser-side or server-side:
   - No server logs after sending message → **browser cannot reach server** → check Vite proxy config
   - Server logs show the request → **server-side fetch failure** → check proxy/env vars

2. Browser-side: ensure `web-ui/example/vite.config.ts` has proxy entries for
   all API routes (`/chat`, `/stop`, `/sessions`, etc.)

3. Server-side: verify `bootstrap.ts` runs and clears proxy vars:
   ```
   [bootstrap] Cleared system proxy env vars, set NO_PROXY=* (PROX not set)
   ```
   If you see `PROX detected` instead, the `.env` file has an uncommented `PROX` line.

4. Debug proxy env vars — temporarily add to `main.ts` after `import "dotenv/config"`:
   ```ts
   console.log("HTTP_PROXY =", process.env.HTTP_PROXY ?? "(unset)");
   console.log("HTTPS_PROXY =", process.env.HTTPS_PROXY ?? "(unset)");
   ```
