# Quy trinh goi LLM Farm — Bosch GenAI Platform

Tai lieu mo ta cach oct (core-service) goi LLM Farm endpoint, va su khac biet
giua 3 moi truong: Local, SAP BAS, SAP BTP.

---

## Tong quan kien truc

```
Browser (web-ui)          Vite dev server          core-service (port 3030)          LLM Farm
     |                         |                            |                            |
     |-- POST /chat ---------->| --- proxy --------------->|                            |
     |                         |  (vite.config.ts)         |                            |
     |                         |                           |-- fetch (openai SDK) ----->|
     |                         |                           |<-- streaming response -----|
     |<-- SSE stream --------- |<--------------------------|                            |
```

- **Browser**: chay tren may local cua nguoi dung, truy cap Vite dev server
- **Vite dev server**: serve UI, dong thoi proxy cac API call (`/chat`, `/sessions`...) sang core-service
- **core-service**: xu ly logic, goi LLM Farm qua OpenAI SDK
- **LLM Farm**: Bosch GenAI Platform (`aoai-farm.bosch-temp.com`)

---

## Trinh tu khoi dong

### Buoc 1: `bootstrap.ts` (entry point)

File nay chay **truoc tat ca** cac library khac. Nhiem vu chinh: xu ly proxy env vars.

**Tai sao can file rieng?**
Trong ES modules, tat ca lenh `import` deu duoc hoisted (chay truoc code).
Neu dat logic cleanup trong `main.ts`, thi khi code cua minh chay, library
`pi-ai` da import xong va da doc `HTTP_PROXY` de tao `EnvHttpProxyAgent` roi.

`bootstrap.ts` dung dynamic `await import("./main.js")` nen code cleanup chay
truoc, roi moi load `main.ts` va cac library.

**Logic:**

1. Doc file `.env` truc tiep (bang `fs.readFileSync`) de kiem tra dong `PROX=...`
2. Neu `PROX` **co** (local) → giu nguyen tat ca proxy env vars
3. Neu `PROX` **khong co** (SAP BAS/BTP) → xoa `HTTP_PROXY`, `HTTPS_PROXY`,
   `http_proxy`, `https_proxy` va set `NO_PROXY=*`
4. Goi `await import("./main.js")` de load ung dung chinh

### Buoc 2: `main.ts`

1. `import "dotenv/config"` → load `.env` vao `process.env`
2. **Proxy setup** (chi khi chay local):
   - Neu `PROX` co gia tri → tao `ProxyAgent` (undici) voi basic auth
   - Goi `setGlobalDispatcher()` de tat ca fetch deu di qua proxy nay
3. **Fetch wrapper** (luon chay khi co `LLM_API_VERSION`):
   - Ghi de `globalThis.fetch`
   - Voi moi request toi `LLM_BASE_URL`, tu dong them `?api-version=...`
     (bat buoc cho Azure OpenAI endpoint)
4. Khoi dong HTTP SSE server tren port 3030

### Buoc 3: `agent.ts` — cau hinh model

1. Doc cac bien moi truong: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`,
   `LLM_API_KEY`, `LLM_AUTH_HEADER`
2. Dung model template `groq/llama3-70b-8192` (vi no dung openai-completions API)
3. Ghi de cac thuoc tinh:
   - `model.id` = ten model (vd: `gpt-5-nano-2025-08-07`)
   - `model.baseUrl` = URL endpoint
   - `model.headers[LLM_AUTH_HEADER]` = API key
4. Tao `Agent` → `AgentSession` voi model nay

---

## Quy trinh goi LLM khi user gui tin nhan

```
1. Browser gui POST /chat → Vite proxy forward → core-service http.ts
2. http.ts handleChat() → handler.handleEvent()
3. agent.ts runner.run() → session.prompt(userMessage)
4. Library pi-ai → openai-completions.js
5. Tao OpenAI client: new OpenAI({ baseURL: LLM_BASE_URL, defaultHeaders: { LLM_AUTH_HEADER: LLM_API_KEY } })
6. OpenAI SDK goi getDefaultFetch() → lay globalThis.fetch (ban da duoc patch)
7. Fetch wrapper cua minh:
   - Kiem tra URL co bat dau bang LLM_BASE_URL khong
   - Neu co → them ?api-version=2025-04-01-preview
   - Goi native fetch
8. Native fetch dung undici global dispatcher:
   - Local: di qua ProxyAgent (proxy cong ty)
   - SAP BAS/BTP: di thang (khong proxy)
9. Request den: https://aoai-farm.bosch-temp.com/api/openai/deployments/{model}/chat/completions
   - Header: genaiplatform-farm-subscription-key: {API_KEY}
   - Body: { model, messages, stream: true, ... }
10. Response streaming tra ve qua SSE toi browser
```

---

## So sanh 3 moi truong

| | Local | SAP BAS | SAP BTP |
|---|---|---|---|
| `.env` PROX | `http://127.0.0.1:3128` | comment (`#PROX=...`) | comment |
| System HTTP_PROXY | khong co | `http://127.0.0.1:8887` (platform inject) | tuy truong hop |
| bootstrap.ts | thay PROX trong .env → giu proxy vars | khong co PROX → xoa proxy vars, set NO_PROXY=* | giong BAS |
| main.ts proxy | `setGlobalDispatcher(ProxyAgent)` voi basic auth | khong setup proxy | khong setup proxy |
| Duong di fetch | fetch → ProxyAgent → corporate proxy → LLM Farm | fetch → truc tiep → LLM Farm | fetch → truc tiep → LLM Farm |
| Web UI | truy cap localhost truc tiep | qua Vite proxy (vite.config.ts) | qua Vite proxy |

---

## Cac file quan trong

| File | Chuc nang |
|---|---|
| `core-service/src/bootstrap.ts` | Entry point. Xoa proxy env vars truoc khi import |
| `core-service/src/main.ts` | Setup proxy (undici), fetch wrapper (api-version), khoi dong server |
| `core-service/src/agent.ts` | Cau hinh model, tao agent/session, dieu phoi goi LLM |
| `core-service/.env` | Chua `PROX`, `LLM_*` config |
| `web-ui/example/vite.config.ts` | Vite proxy — forward `/chat`, `/sessions`... sang localhost:3030 |
| `web-ui/example/src/main.ts` | UI entry — `baseUrl` mac dinh `""` (relative URL, di qua Vite proxy) |

---

## Cau hinh .env

```env
# === CHI DUNG O LOCAL — comment dong nay khi chay tren SAP BAS/BTP ===
PROX=http://127.0.0.1:3128
AGENT_USER=iyh1hc
AGENT_PWD=

# === LLM Farm config (dung chung cho tat ca moi truong) ===
LLM_PROVIDER=openai
LLM_MODEL=gpt-5-nano-2025-08-07
LLM_BASE_URL=https://aoai-farm.bosch-temp.com/api/openai/deployments/gpt-5-nano-2025-08-07
LLM_API_VERSION=2025-04-01-preview
LLM_API_KEY=0287bd8c9b0045efb99bf2efeecfce74
LLM_AUTH_HEADER=genaiplatform-farm-subscription-key
```

Khi chuyen moi truong, **chi can comment/uncomment dong `PROX`**.
Tat ca logic proxy con lai do `bootstrap.ts` va `main.ts` tu dong xu ly.

---

## Van de thuong gap trong library pi-ai

Library `@mariozechner/pi-ai` co file `utils/http-proxy.js` duoc import tu dong:

```js
// Chay khi library duoc import — khong the ngan chan
import("undici").then((m) => {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = m;
    setGlobalDispatcher(new EnvHttpProxyAgent());
});
```

`EnvHttpProxyAgent` tu dong doc `HTTP_PROXY`/`HTTPS_PROXY` tu `process.env`
tai thoi diem tao object. Tren SAP BAS, platform inject
`HTTP_PROXY=http://127.0.0.1:8887` — proxy noi bo nay **khong the** truy cap
LLM Farm endpoint ben ngoai.

**Giai phap**: `bootstrap.ts` xoa cac bien nay **truoc khi** library load,
nen `EnvHttpProxyAgent` se khong tim thay proxy nao de dung.

---

## Xu ly su co

### Loi "TypeError: Failed to fetch" tren SAP BAS

**Buoc 1: Xac dinh loi o dau**

- Khong co log server sau khi gui tin nhan → **Loi phia browser** (browser
  khong ket noi duoc server)
- Co log server nhung fetch that bai → **Loi phia server** (proxy/env vars)

**Buoc 2: Neu loi phia browser**

Kiem tra `web-ui/example/vite.config.ts` co proxy config cho tat ca API routes:

```ts
server: {
    proxy: {
        "/chat": "http://localhost:3030",
        "/stop": "http://localhost:3030",
        "/sessions": "http://localhost:3030",
        "/messages": "http://localhost:3030",
        "/file": "http://localhost:3030",
        "/artifact-url": "http://localhost:3030",
        "/artifacts": "http://localhost:3030",
    },
},
```

**Buoc 3: Neu loi phia server**

Kiem tra log khoi dong co dong:

```
[bootstrap] Cleared system proxy env vars, set NO_PROXY=* (PROX not set)
```

Neu thay `PROX detected` thay vi dong tren → file `.env` van con dong `PROX`
chua duoc comment.

**Buoc 4: Debug chi tiet**

Them tam vao `main.ts` sau dong `import "dotenv/config"`:

```ts
console.log("HTTP_PROXY =", process.env.HTTP_PROXY ?? "(unset)");
console.log("HTTPS_PROXY =", process.env.HTTPS_PROXY ?? "(unset)");
console.log("NO_PROXY =", process.env.NO_PROXY ?? "(unset)");
```
