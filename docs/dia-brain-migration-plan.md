# Chuyển đổi Pi-Boi: Tích hợp DIA Brain — Migration Plan

> **Ngày tạo:** 2026-04-22
> **Trạng thái:** Draft — chờ approve trước khi implement

---

## 1. Bối cảnh và Mục tiêu

### Tại sao cần thay đổi

- **LLM Farm** dùng model miễn phí (gpt-5-nano) → response nhanh nhưng **chất lượng thấp**
- **DIA Brain** dùng Claude → **thông minh hơn**, phù hợp cho SAP ABAP code generation/refactoring
- Project hướng đến **IDE web tool chuyên sâu** xử lý task phức tạp SAP ABAP

### Ràng buộc

- DIA Brain **không hỗ trợ native tool calling** (function calling)
- DIA Brain là **paid API**, response **chậm hơn** LLM Farm
- Pi-boi cần giữ **tất cả tool capabilities** (bash, read, write, edit, attach)
- Pi-boi dùng `pi-agent-core` Agent framework cho agent loop + tool execution

### Kết luận phân tích

| Đặc điểm | LLM Farm | DIA Brain |
|-----------|----------|-----------|
| **Model** | gpt-5-nano (free) | Claude (paid) |
| **Tốc độ** | Nhanh | Chậm hơn |
| **Chất lượng** | Thấp | Cao |
| **Tool calling** | ✅ Native | ❌ Không hỗ trợ |
| **Auth** | API Key (header) | OAuth2 client_credentials |
| **API format** | OpenAI Chat Completions | Custom REST (`prompt`, `chatHistoryId`) |
| **Chi phí** | Free | Trả phí |

---

## 2. Các hướng tiếp cận đã phân tích

### ❌ Hướng loại bỏ: Swap endpoint đơn giản

**Không khả thi** vì LLM Farm và DIA Brain khác nhau hoàn toàn ở 3 tầng:

1. **Auth**: API Key vs OAuth2 → `pi-agent-core` không hỗ trợ OAuth2
2. **Request**: `messages[] + tools[]` vs `{ prompt, customMessageBehaviour, knowledgeBaseId }` → format không tương thích
3. **Response**: `choices[].message.tool_calls` vs `{ result: "text" }` → agent loop không parse được

### ❌ Hướng đã loại: A — Fetch Interceptor

Chặn `globalThis.fetch` → redirect LLM Farm calls sang DIA Brain → convert response ngược lại OpenAI format.

- Hacky, khó debug
- Quản lý 2 history song song (pi-agent-core + DIA Brain)
- Dễ vỡ khi pi-agent-core update

### ❌ Hướng đã loại: B — Pure DIA Brain (Custom Agent Loop)

Thay thế pi-agent-core bằng custom agent loop gọi DIA Brain trực tiếp.

- Mọi call đều qua DIA Brain (đắt, chậm)
- Tools (read, bash...) không cần suy nghĩ phức tạp nhưng vẫn phải gọi DIA Brain
- Ví dụ: 1 task refactor = **3 DIA Brain calls**

### ❌ Hướng đã loại: Hybrid tách tool/thinking

- LLM Farm gọi tool, DIA Brain chỉ "suy nghĩ"
- **Vấn đề**: tool calling và thinking **không tách rời được** — content refactored code IS argument của write tool call. LLM Farm (gpt-5-nano) phải copy lại code từ DIA Brain → lãng phí token, dễ lỗi, code quality kém.

---

## 3. Hướng chọn: C — DIA Brain là "Super Tool" ⭐

### 3.1 Ý tưởng cốt lõi

- **LLM Farm** vẫn là agent chính (orchestrator) — quyết định gọi tool nào, nhanh, free
- **DIA Brain** trở thành **1 tool mới** (`dia_brain`) — chỉ được gọi khi cần "suy nghĩ sâu"
- `dia_brain` tool **tự xử lý write/action** bên trong — không ném code ngược lại cho LLM Farm

### 3.2 Kiến trúc

```
┌─ LLM Farm Agent (orchestrator, free, fast) ───────────────────┐
│                                                                │
│  pi-agent-core Agent (GIỮ NGUYÊN)                             │
│                                                                │
│  Tools:                                                        │
│    ├── bash      → chạy local                                  │
│    ├── read      → chạy local                                  │
│    ├── write     → chạy local                                  │
│    ├── edit      → chạy local                                  │
│    ├── attach    → chạy local                                  │
│    └── dia_brain → GỌI DIA Brain API + tự execute actions  ⭐  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 Flow ví dụ: "Refactor X.abap"

```
User: "refactor X.abap"
    ↓
LLM Farm Call #1:  Quyết định cần đọc file trước
                   → tool_call(read, "X.abap")
                   → Execute read local → nhận content file
    ↓
LLM Farm Call #2:  Nhận content, biết cần phân tích/sinh code phức tạp
                   → tool_call(dia_brain, {
                       task: "refactor this ABAP code",
                       context: file_content,
                       actions: ["write"]   // DIA Brain được phép write
                     })
                   → Execute dia_brain tool:
                     ┌─────────────────────────────────┐
                     │  Bên trong dia_brain tool:       │
                     │  1. Gọi DIA Brain API            │  ← 1 DIA call
                     │  2. Nhận refactored code         │
                     │  3. Parse response cho actions    │
                     │  4. TỰ WRITE file luôn           │  ← write trực tiếp
                     │  5. Trả kết quả: "Wrote X.abap"  │
                     └─────────────────────────────────┘
    ↓
LLM Farm Call #3:  Nhận "Wrote X.abap successfully"
                   → Trả user: "Đã refactor xong file X.abap"
```

**Tổng: 3 LLM Farm calls (free) + 1 DIA Brain call (paid)**

### 3.4 So sánh số lượng calls

| Scenario | Hướng B (Pure DIA) | Hướng C (Hybrid) ⭐ |
|----------|-------------------|---------------------|
| Chat đơn giản | 1 DIA | 1 Farm |
| Đọc file + trả lời | 2 DIA | 2 Farm |
| Đọc + refactor + write | 3 DIA | 3 Farm + **1 DIA** |
| Complex (5 tools) | 6 DIA | 6 Farm + **1-2 DIA** |

→ **Giảm DIA Brain calls đáng kể** — chỉ gọi khi thực sự cần "suy nghĩ sâu".

### 3.5 Khi nào LLM Farm gọi `dia_brain` tool?

LLM Farm sẽ được hướng dẫn trong system prompt:

```
Sử dụng dia_brain tool khi:
- Cần phân tích/refactor/generate SAP ABAP code
- Cần suy nghĩ phức tạp, trả lời chuyên sâu
- Task liên quan đến architecture decisions

KHÔNG cần dia_brain cho:
- Đọc file đơn giản (dùng read)
- Chạy command (dùng bash)
- Ghi nội dung đã có sẵn (dùng write)
- Câu hỏi đơn giản
```

---

## 4. Chi tiết thiết kế `dia_brain` tool

### 4.1 Interface

```typescript
const diaBrainSchema = Type.Object({
  label: Type.String({ description: "Mô tả ngắn task" }),
  task: Type.String({ description: "Yêu cầu chi tiết gửi DIA Brain" }),
  context: Type.Optional(Type.String({ description: "Code hoặc context liên quan" })),
  outputPath: Type.Optional(Type.String({ description: "Path để write kết quả (nếu cần)" })),
});
```

### 4.2 Bên trong tool execute

```typescript
async execute(toolCallId, { task, context, outputPath }) {
  // 1. Get OAuth2 token (cached)
  const token = await getTokenCached();
  
  // 2. Build prompt for DIA Brain
  const prompt = context 
    ? `${task}\n\n---\n\n${context}` 
    : task;
  
  // 3. Call DIA Brain API
  const result = await callDIABrain(prompt, chatHistoryId);
  
  // 4. Auto-write if outputPath specified
  if (outputPath) {
    await writeFile(outputPath, result.content);
    return { text: `DIA Brain analysis complete. Wrote result to ${outputPath}` };
  }
  
  // 5. Return text result to LLM Farm
  return { text: result.content };
}
```

### 4.3 DIA Brain Client Module

Port từ `call-llm/src/diaBrainClient.ts`:

```typescript
// OAuth2 token management
getOAuth2AccessToken()  → fetch token from login.microsoftonline.com
getTokenCached()        → cache + auto-refresh (60s buffer)

// Chat history
createHistory(brainId)  → POST /chat-histories/{brainId}

// Main API call
callDIABrain(prompt, chatHistoryId?)
  → POST /chat/retrieval-augmented (hoặc /chat/pure-llm)
  → { prompt, customMessageBehaviour, knowledgeBaseId, chatHistoryId }
  → Return { result, chatHistoryId }
```

---

## 5. Proposed Changes — Files cần thay đổi

### Component 1: DIA Brain Client

#### [NEW] `src/diaBrainClient.ts`

Port từ `call-llm/src/diaBrainClient.ts`, bao gồm:
- OAuth2 token flow + caching
- DIA Brain API calls (RAG / Pure LLM)
- Chat history management
- Proxy support (reuse `undici`)

---

### Component 2: DIA Brain Tool

#### [NEW] `src/tools/diaBrain.ts`

Tool mới cho pi-agent-core:
- Schema: `{ label, task, context?, outputPath? }`
- Execute: gọi DIA Brain API → xử lý response → auto-write nếu cần
- Quản lý chatHistoryId per channel

---

### Component 3: Tools Registration

#### [MODIFY] `src/tools/index.ts`

Thêm `diaBrain` tool vào `createMomTools()`:

```diff
 export function createMomTools(executor: Executor, workingDir: string): AgentTool<any>[] {
   return [
     createReadTool(executor, workingDir),
     createBashTool(executor),
     createEditTool(executor, workingDir),
     createWriteTool(executor, workingDir),
     attachTool,
+    createDIABrainTool(workingDir),
   ];
 }
```

---

### Component 4: System Prompt

#### [MODIFY] `src/agent.ts`

Thêm hướng dẫn sử dụng `dia_brain` tool vào `buildSystemPrompt()`:

```diff
 ## Tools
 - bash: Run shell commands
 - read: Read files
 - write: Create/overwrite files
 - edit: Surgical file edits
 - attach: Share files to Slack
+- dia_brain: Send complex tasks to DIA Brain (Claude) for deep analysis,
+  code generation, refactoring. Use when task requires advanced reasoning.
+  Can auto-write results to file if outputPath is provided.
```

---

### Component 5: Environment Config

#### [MODIFY] `.env`

Giữ nguyên tất cả config hiện tại (LLM Farm + DIA Brain đều đã có). Thêm:

```diff
+# DIA Brain mode: "rag" or "pure"
+DIA_MODE=rag
```

---

### Không thay đổi

- ✅ `src/main.ts` — giữ nguyên (LLM Farm vẫn là agent chính)
- ✅ `src/agent.ts` — giữ nguyên core logic (chỉ thêm prompt text)
- ✅ `src/http.ts` — giữ nguyên
- ✅ `src/slack.ts` — giữ nguyên
- ✅ `src/context.ts` — giữ nguyên
- ✅ `src/events.ts` — giữ nguyên
- ✅ `src/types.ts` — giữ nguyên
- ✅ `src/tools/bash.ts` — giữ nguyên
- ✅ `src/tools/read.ts` — giữ nguyên
- ✅ `src/tools/write.ts` — giữ nguyên
- ✅ `src/tools/edit.ts` — giữ nguyên
- ✅ `src/tools/attach.ts` — giữ nguyên
- ✅ `package.json` — giữ nguyên (undici đã có)

---

## 6. Rủi ro và Mitigation

| Rủi ro | Mức độ | Mitigation |
|--------|--------|-----------|
| LLM Farm (gpt-5-nano) không biết khi nào cần gọi `dia_brain` | Trung bình | System prompt hướng dẫn rõ ràng. Few-shot examples. |
| DIA Brain response chậm → timeout | Trung bình | Timeout config. Retry logic. |
| OAuth2 token expired | Thấp | Token cache 60s buffer. Auto-refresh. |
| DIA Brain output không đúng format để auto-write | Thấp | Parse linh hoạt. Fallback: trả raw text cho LLM Farm xử lý. |
| Chat history overflow | Thấp | DIA Brain tự quản lý. Có thể tạo history mới khi cần. |

---

## 7. Verification Plan

### Phase 1: Build & Compile
```bash
npm run build
```

### Phase 2: Test DIA Brain Client
- Test OAuth2 token flow (get + cache + refresh)
- Test DIA Brain API call đơn giản (no tools)

### Phase 3: Test dia_brain Tool
- Test qua HTTP chatbox: hỏi câu đơn giản → KHÔNG gọi dia_brain
- Test qua HTTP chatbox: yêu cầu phân tích code → CÓ gọi dia_brain
- Test auto-write: yêu cầu generate code vào file → verify file được tạo

### Phase 4: End-to-End
```bash
npm run dev:http
# Gửi: "Read file X and refactor the ABAP code"
# Verify: read → dia_brain → write → response
```

---

## 8. Open Questions

> **1. DIA Brain mode?**
> Dùng `DIA_CHAT_RAG` (kèm knowledge base) hay `DIA_CHAT_PURE` (pure Claude)?
> RAG sẽ inject thêm context từ knowledge base → tốt nếu KB có SAP ABAP docs.

> **2. Chat History strategy?**
> - **Option A:** Mỗi channel = 1 DIA history (persistent context across messages)
> - **Option B:** Mỗi dia_brain tool call = 1 DIA history mới (stateless)
> Recommend **Option B** cho đơn giản — mỗi tool call là independent.

> **3. `outputPath` format?**
> Khi LLM Farm gọi `dia_brain` với `outputPath`, DIA Brain response sẽ được write nguyên vẹn hay cần parse (extract code block)?
