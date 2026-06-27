# Cloudflare 部署架构迁移计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `prototype/` 从 Express + 本地 JSON 文件改造为 Cloudflare Pages + Functions + D1 可部署架构，并推送到独立分支。

**Architecture:** 使用 Cloudflare Pages 托管 `public/` 静态前端；使用 Pages Functions（单文件 `functions/api/[[route]].js` + Hono 子应用）提供 `/api/*` 服务；使用 Cloudflare D1 替代文件数据库；敏感配置通过 Wrangler Secrets 注入。

**Tech Stack:** Hono, Cloudflare Pages Functions, Cloudflare D1, Wrangler, ESM.

## Global Constraints

- 不改变 `main` 分支；所有工作在 `worktree-cloudflare-deploy` worktree 中完成。
- 尽量保持前端行为不变，仅修改部署相关配置与注释。
- 后端接口路径保持与原 Express 版本一致（`/api/chat`、`/api/snapshot`、`/api/conversations/*`、`/api/health`、`/api/stats`、`/api/user`、`/api/events`）。
- 数据库使用 Cloudflare D1（SQLite），不再使用 Node.js `fs`。
- 代码统一使用 ESM（`import`/`export`）。
- 不保留 Express、CORS、`dotenv` 依赖。
- `LLM_API_KEY` 必须通过 `wrangler secret put LLM_API_KEY` 设置，禁止硬编码。

---

## File Structure

```
prototype/
  public/                              # Pages 静态资源（基本不变）
    index.html                         # 更新 API_BASE 注释
    app.js                             # 行为不变，相对路径已兼容
    styles.css
  functions/                           # Pages Functions
    api/
      [[route]].js                     # Hono 总入口，basePath /api
    _lib/                              # 私有模块（下划线开头，非路由）
      llm-config.js                    # 从 env 读取 LLM 配置
      require-user.js                  # Hono 用户识别中间件
      db.js                            # D1 数据库封装
      routes/
        chat.js                        # /api/chat + /api/snapshot
        conversations.js               # /api/conversations/*
        system.js                      # /api/health /api/stats /api/user /api/events
      prompts/
        v5-prompts.js                  # 原 prompts/v5-prompts.js 转 ESM
        quality-gate.js                # 原 prompts/quality-gate.js 转 ESM
  migrations/
    0001_init.sql                      # D1 初始表结构
  wrangler.toml                        # Pages + D1 + vars 配置
  package.json                         # 替换依赖与脚本
  .env.example                         # 更新为 Wrangler 配置指引
```

---

## Task 1: 创建 Wrangler 与 D1 配置

**Files:**
- Create: `prototype/wrangler.toml`
- Create: `prototype/migrations/0001_init.sql`
- Modify: `prototype/.env.example`
- Modify: `prototype/package.json`

**Interfaces:**
- Produces: D1 binding 名称为 `DB`；非敏感变量通过 `[vars]` 注入；`LLM_API_KEY` 留空由 secret 提供。

- [ ] **Step 1: 创建 `prototype/wrangler.toml`**

```toml
name = "jing-mindmirror"
pages_build_output_dir = "public"
compatibility_date = "2024-06-27"

[[d1_databases]]
binding = "DB"
database_name = "jing-mindmirror-db"
database_id = "your-database-id-here"
migrations_dir = "migrations"

[vars]
LLM_BASE_URL = "https://api.deepseek.com"
LLM_MODEL = "deepseek-chat"
```

- [ ] **Step 2: 创建 `prototype/migrations/0001_init.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  conversation_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  type TEXT,
  status TEXT,
  confidence INTEGER,
  hero_quote TEXT,
  essay TEXT,
  annotations TEXT,
  schema_version TEXT,
  stances TEXT,
  premortem_change TEXT,
  premortem_stay TEXT,
  blindspots TEXT,
  future_perspective TEXT,
  calibration_date TEXT,
  messages TEXT,
  total_turns INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  conversation_id TEXT,
  data TEXT,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
```

- [ ] **Step 3: 更新 `prototype/.env.example` 为 Wrangler 指引**

```bash
# 本地开发变量（wrangler pages dev 会自动读取 wrangler.toml 的 [vars]）
# 敏感密钥请用：
#   wrangler secret put LLM_API_KEY
#
# 如需本地覆盖，可创建 .dev.vars：
# LLM_API_KEY=你的密钥
```

- [ ] **Step 4: 更新 `prototype/package.json`**

```json
{
  "name": "prototype",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler pages dev public",
    "deploy": "wrangler pages deploy public",
    "d1:migrate": "wrangler d1 migrations apply jing-mindmirror-db",
    "d1:create": "wrangler d1 create jing-mindmirror-db"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "hono": "^4.4.0"
  },
  "devDependencies": {
    "wrangler": "^3.60.0"
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add prototype/wrangler.toml prototype/migrations prototype/.env.example prototype/package.json
git commit -m "chore: add Cloudflare Pages + D1 configuration"
```

---

## Task 2: 创建 Hono 私有模块与中间件

**Files:**
- Create: `prototype/functions/_lib/llm-config.js`
- Create: `prototype/functions/_lib/require-user.js`
- Create: `prototype/functions/_lib/db.js`

**Interfaces:**
- `llm-config.js` exports `getLLMConfig(env)` → `{ LLM_BASE_URL, LLM_API_KEY, LLM_MODEL }`.
- `require-user.js` exports Hono middleware `requireUserId`, sets `c.set('userId', userId)`.
- `db.js` exports async functions: `upsertUser(db, userId)`, `getUser(db, userId)`, `saveConversation(db, conversation)`, `getConversationsByUser(db, userId)`, `getConversation(db, id)`, `deleteConversation(db, id)`, `recordEvent(db, event)`, `queryEvents(db, opts)`, `getStats(db)`.

- [ ] **Step 1: 创建 `prototype/functions/_lib/llm-config.js`**

```js
/**
 * LLM 配置 — 从 Cloudflare env 读取
 */
export function getLLMConfig(env) {
  return {
    LLM_BASE_URL: env.LLM_BASE_URL || 'https://api.deepseek.com',
    LLM_API_KEY: env.LLM_API_KEY || '',
    LLM_MODEL: env.LLM_MODEL || 'deepseek-chat',
  };
}
```

- [ ] **Step 2: 创建 `prototype/functions/_lib/require-user.js`**

```js
import { createMiddleware } from 'hono/factory';
import { upsertUser } from './db.js';

export const requireUserId = createMiddleware(async (c, next) => {
  let userId = c.req.header('x-user-id');
  if (!userId) {
    try {
      const body = await c.req.json();
      userId = body?.userId;
    } catch {
      // 忽略非 JSON body
    }
  }
  if (!userId) {
    return c.json({ error: '缺少用户标识 (x-user-id)' }, 400);
  }
  await upsertUser(c.env.DB, userId);
  c.set('userId', userId);
  await next();
});
```

- [ ] **Step 3: 创建 `prototype/functions/_lib/db.js`**

```js
/**
 * D1 数据库封装
 */

export async function upsertUser(db, userId) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, created_at, last_active_at, conversation_count)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET last_active_at = excluded.last_active_at`
    )
    .bind(userId, now, now)
    .run();
  return getUser(db, userId);
}

export async function getUser(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
}

export async function saveConversation(db, conversation) {
  const id = String(conversation.id || crypto.randomUUID());
  const now = new Date().toISOString();
  const createdAt = conversation.createdAt || now;
  const updatedAt = now;
  const annotations = JSON.stringify(conversation.annotations || []);
  const messages = JSON.stringify(conversation.messages || []);

  await db
    .prepare(
      `INSERT INTO conversations (
        id, user_id, title, type, status, confidence, hero_quote, essay,
        annotations, schema_version, stances, premortem_change, premortem_stay,
        blindspots, future_perspective, calibration_date, messages, total_turns,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        title = excluded.title,
        type = excluded.type,
        status = excluded.status,
        confidence = excluded.confidence,
        hero_quote = excluded.hero_quote,
        essay = excluded.essay,
        annotations = excluded.annotations,
        schema_version = excluded.schema_version,
        stances = excluded.stances,
        premortem_change = excluded.premortem_change,
        premortem_stay = excluded.premortem_stay,
        blindspots = excluded.blindspots,
        future_perspective = excluded.future_perspective,
        calibration_date = excluded.calibration_date,
        messages = excluded.messages,
        total_turns = excluded.total_turns,
        created_at = conversations.created_at,
        updated_at = excluded.updated_at`
    )
    .bind(
      id,
      conversation.userId,
      conversation.title || '',
      conversation.type || '',
      conversation.status || '',
      conversation.confidence ?? null,
      conversation.hero_quote || '',
      conversation.essay || '',
      annotations,
      conversation.schema_version || 'v2',
      conversation.stances || '',
      conversation.premortem_change || '',
      conversation.premortem_stay || '',
      conversation.blindspots || '',
      conversation.future_perspective || '',
      conversation.calibrationDate || null,
      messages,
      conversation.totalTurns || 0,
      createdAt,
      updatedAt
    )
    .run();

  return { ...conversation, id, createdAt, updatedAt };
}

export async function getConversationsByUser(db, userId) {
  const { results } = await db
    .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return results.map(rowToConversation);
}

export async function getConversation(db, id) {
  const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  return row ? rowToConversation(row) : null;
}

export async function deleteConversation(db, id) {
  const result = await db.prepare('DELETE FROM conversations WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

export async function recordEvent(db, { userId, type, conversationId, data }) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO events (id, user_id, type, conversation_id, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id, userId, type, conversationId || null, JSON.stringify(data || {}), timestamp)
    .run();
  return true;
}

export async function queryEvents(db, { userId, type, since, limit = 1000 } = {}) {
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (since) {
    sql += ' AND timestamp >= ?';
    params.push(since);
  }
  sql += ' ORDER BY timestamp ASC LIMIT ?';
  params.push(limit);
  const { results } = await db.prepare(sql).bind(...params).all();
  return results.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') }));
}

export async function getStats(db) {
  const { totalUsers } = await db.prepare('SELECT COUNT(*) AS totalUsers FROM users').first();
  const { totalConversations } = await db
    .prepare('SELECT COUNT(*) AS totalConversations FROM conversations')
    .first();
  const { totalEvents } = await db.prepare('SELECT COUNT(*) AS totalEvents FROM events').first();
  const { completed } = await db
    .prepare("SELECT COUNT(*) AS completed FROM conversations WHERE status = 'completed'")
    .first();
  const avgRow = await db
    .prepare('SELECT AVG(confidence) AS avgConfidence FROM conversations WHERE confidence IS NOT NULL')
    .first();
  const { recentUsers } = await db
    .prepare("SELECT COUNT(*) AS recentUsers FROM users WHERE last_active_at >= datetime('now', '-7 days')")
    .first();

  return {
    totalUsers,
    totalConversations,
    totalEvents,
    completedConversations: completed,
    avgConfidence: avgRow.avgConfidence ? Number(avgRow.avgConfidence).toFixed(1) : '0.0',
    recentUsers,
  };
}

function rowToConversation(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    type: row.type,
    status: row.status,
    confidence: row.confidence,
    hero_quote: row.hero_quote,
    essay: row.essay,
    annotations: JSON.parse(row.annotations || '[]'),
    schema_version: row.schema_version,
    stances: row.stances,
    premortem_change: row.premortem_change,
    premortem_stay: row.premortem_stay,
    blindspots: row.blindspots,
    future_perspective: row.future_perspective,
    calibrationDate: row.calibration_date,
    messages: JSON.parse(row.messages || '[]'),
    totalTurns: row.total_turns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 4: 提交**

```bash
git add prototype/functions/_lib
git commit -m "feat: add Hono middleware and D1 database layer"
```

---

## Task 3: 迁移 Prompt 模块为 ESM

**Files:**
- Create: `prototype/functions/_lib/prompts/v5-prompts.js`
- Create: `prototype/functions/_lib/prompts/quality-gate.js`

**Interfaces:**
- `v5-prompts.js` exports: `RESPONSE_SYSTEM_PROMPT`, `UNDERSTANDING_SYSTEM_PROMPT`, `RETRY_SYSTEM_PROMPT`, `buildResponseMessages`, `buildUnderstandingMessages`, `buildRetryMessages`, `normalizeMessages`, `parseUnderstandingOutput`, `isValidUnderstanding`.
- `quality-gate.js` exports: `responseQualityCheck`.

- [ ] **Step 1: 复制并转换 `prototype/prompts/v5-prompts.js`**

保持所有函数实现与原文一致，仅将 `module.exports = { ... }` 改为 `export { ... }`。

```js
// ... 原文件内容 ...

export {
  RESPONSE_SYSTEM_PROMPT,
  UNDERSTANDING_SYSTEM_PROMPT,
  RETRY_SYSTEM_PROMPT,
  buildResponseMessages,
  buildUnderstandingMessages,
  buildRetryMessages,
  normalizeMessages,
  parseUnderstandingOutput,
  isValidUnderstanding,
};
```

- [ ] **Step 2: 复制并转换 `prototype/prompts/quality-gate.js`**

保持 `responseQualityCheck` 实现不变，仅改为：

```js
export { responseQualityCheck };
```

- [ ] **Step 3: 提交**

```bash
git add prototype/functions/_lib/prompts
git commit -m "chore: migrate prompt modules to ESM"
```

---

## Task 4: 迁移 API 路由到 Hono

**Files:**
- Create: `prototype/functions/_lib/routes/chat.js`
- Create: `prototype/functions/_lib/routes/conversations.js`
- Create: `prototype/functions/_lib/routes/system.js`
- Create: `prototype/functions/api/[[route]].js`

**Interfaces:**
- `chat.js` exports default Hono app，注册 `POST /chat` 和 `POST /snapshot`。
- `conversations.js` exports default Hono app，注册 `POST /`、`GET /`、`GET /:id`、`DELETE /:id`。
- `system.js` exports default Hono app，注册 `GET /health`、`GET /stats`、`GET /user`、`POST /events`。
- `api/[[route]].js` 组装所有子应用，设置 `llmConfig` 上下文，按需挂载 `requireUserId`。

- [ ] **Step 1: 创建 `prototype/functions/_lib/routes/chat.js`**

从 `prototype/routes/chat.js` 迁移，改动点：
- 使用 `import` 替代 `require`。
- `const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = c.get('llmConfig')` 替代静态导入。
- `const userId = c.get('userId')` 替代 `req.userId`。
- `c.req.json()` 替代 `req.body`。
- `c.json({ ... }, 500)` 替代 `res.status(500).json(...)`。
- `await recordEvent(c.env.DB, { userId, ... })` 替代 `db.recordEvent(...)`。
- 保留所有 prompt 调用、质量守门、快照生成逻辑。

```js
import { Hono } from 'hono';
import * as db from '../db.js';
import { responseQualityCheck } from '../prompts/quality-gate.js';
import {
  buildResponseMessages,
  buildUnderstandingMessages,
  buildRetryMessages,
  parseUnderstandingOutput,
  isValidUnderstanding,
} from '../prompts/v5-prompts.js';

const app = new Hono();

async function callLLMAPI(apiMessages, options = {}, config) {
  const { maxTokens = 1500, temperature = 0.7, useJSON = false } = options;
  const body = {
    model: config.LLM_MODEL,
    messages: apiMessages,
    temperature,
    max_tokens: maxTokens,
    top_p: 0.85,
    frequency_penalty: 0.3,
    presence_penalty: 0.1,
  };
  if (useJSON) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0].message.content.trim(),
    usage: data.usage || {},
  };
}

function buildGenericResponse() {
  return {
    understanding: { surface: '（对话继续中）', tension: '', key_moments: [], unsaid: '' },
    response: { content: '刚才走神了，能再说一遍吗？', is_winding_down: false, wind_down_hint: null },
  };
}

function logCacheHit(label, usage) {
  const hit = usage.prompt_cache_hit_tokens || 0;
  const miss = usage.prompt_cache_miss_tokens || 0;
  const total = usage.prompt_tokens || 0;
  if (total > 0) {
    const rate = ((hit / total) * 100).toFixed(1);
    console.log(`[Cache] ${label}: hit=${hit}, miss=${miss}, total=${total}, rate=${rate}%`);
  }
}

app.post('/chat', async (c) => {
  const config = c.get('llmConfig');
  if (!config.LLM_API_KEY) {
    return c.json({ error: '未配置 LLM_API_KEY,请在 Wrangler Secrets 中设置' }, 500);
  }

  const { messages, understanding, conversationId, style } = await c.req.json();
  const userId = c.get('userId');

  const recentAssistantMessages = messages
    .filter((m) => m.role === 'assistant')
    .slice(-2)
    .map((m) => {
      try {
        const parsed = JSON.parse(m.content);
        return parsed.response?.content || m.content;
      } catch (e) {
        return m.content;
      }
    });

  const userLastMessage = messages.filter((m) => m.role === 'user').pop()?.content || '';

  await db.recordEvent(c.env.DB, {
    userId,
    type: 'message_send',
    conversationId,
    data: { hasUnderstanding: !!understanding, role: messages[messages.length - 1]?.role },
  });

  try {
    const responsePromise = callLLMAPI(
      buildResponseMessages(messages, understanding, style),
      { maxTokens: 1200, temperature: 0.7, useJSON: false },
      config
    );
    const understandingPromise = callLLMAPI(
      buildUnderstandingMessages(messages),
      { maxTokens: 800, temperature: 0.3, useJSON: true },
      config
    );

    let content = '';
    let rawContent = '';
    try {
      const responseResult = await responsePromise;
      content = responseResult.content;
      rawContent = content;
      logCacheHit('Response', responseResult.usage);
      console.log(`[LLM] Response: 成功, 长度=${content.length}`);
    } catch (e1) {
      console.log('[LLM] Response 请求失败:', e1.message);
      const fallback = buildGenericResponse();
      content = fallback.response.content;
      rawContent = JSON.stringify(fallback);
    }

    let newUnderstanding = understanding;
    let isWindingDown = false;
    let windDownHint = null;

    try {
      const understandingResult = await understandingPromise;
      logCacheHit('Understanding', understandingResult.usage);
      const parsed = parseUnderstandingOutput(understandingResult.content);
      console.log(`[LLM] Understanding: 解析=${isValidUnderstanding(parsed) ? '成功' : '失败'}`);
      if (isValidUnderstanding(parsed)) {
        newUnderstanding = parsed.understanding;
        isWindingDown = parsed.is_winding_down || false;
        windDownHint = parsed.wind_down_hint || null;
      }
    } catch (e2) {
      console.log('[LLM] Understanding 请求失败:', e2.message);
    }

    const qualityResult = responseQualityCheck(content, userLastMessage, recentAssistantMessages);
    await db.recordEvent(c.env.DB, {
      userId,
      type: 'response_quality_check',
      conversationId,
      data: {
        passed: qualityResult.passed,
        score: qualityResult.score,
        reasons: qualityResult.reasons,
      },
    });

    if (qualityResult.mustRetry) {
      console.log(`[Quality Gate] 触发重试 (score=${qualityResult.score}): ${qualityResult.reasons.join('; ')}`);
      try {
        const retryResult = await callLLMAPI(
          buildRetryMessages(messages, style, content, qualityResult),
          { maxTokens: 1000, temperature: 0.4, useJSON: false },
          config
        );
        const retryContent = retryResult.content.trim();
        const retryQuality = responseQualityCheck(retryContent, userLastMessage, recentAssistantMessages);
        await db.recordEvent(c.env.DB, {
          userId,
          type: 'retry_triggered',
          conversationId,
          data: {
            originalScore: qualityResult.score,
            retryScore: retryQuality.score,
            retryPassed: retryQuality.passed,
            originalReasons: qualityResult.reasons,
            retryReasons: retryQuality.reasons,
          },
        });
        if (retryQuality.score > qualityResult.score) {
          content = retryContent;
          rawContent = retryContent;
          console.log(`[Quality Gate] 重试改善 (score: ${qualityResult.score} → ${retryQuality.score})`);
        } else {
          console.log(`[Quality Gate] 重试未改善,保留原始回复 (score: ${qualityResult.score} vs ${retryQuality.score})`);
        }
      } catch (retryErr) {
        console.error('[Quality Gate] 重试请求失败:', retryErr.message);
      }
    }

    return c.json({
      content: content.trim(),
      rawContent,
      understanding: newUnderstanding,
      is_winding_down: isWindingDown,
      wind_down_hint: windDownHint,
    });
  } catch (err) {
    console.error('LLM API 请求失败:', err);
    return c.json({ error: 'LLM API 请求失败,请检查网络和配置' }, 500);
  }
});

app.post('/snapshot', async (c) => {
  const config = c.get('llmConfig');
  if (!config.LLM_API_KEY) {
    return c.json({ error: '未配置 LLM_API_KEY' }, 500);
  }

  const { messages } = await c.req.json();
  if (!messages || !Array.isArray(messages)) {
    return c.json({ error: '缺少对话消息' }, 400);
  }

  const extractPrompt = buildSnapshotPrompt(messages);

  try {
    const response = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages: [{ role: 'user', content: extractPrompt }],
        temperature: 0.3,
        max_tokens: 1800,
      }),
    });

    if (!response.ok) {
      return c.json({ error: `LLM API 返回错误: ${response.status}` }, response.status);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return c.json({ error: '无法解析 LLM 返回的快照数据' }, 500);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('快照 JSON 解析失败:', e.message, jsonMatch[0].slice(0, 200));
      return c.json({ error: 'LLM 返回的 JSON 格式错误' }, 500);
    }

    const validated = validateSnapshot(parsed, messages);
    return c.json(validated);
  } catch (err) {
    console.error('快照生成失败:', err);
    return c.json({ error: '快照生成失败' }, 500);
  }
});

function buildSnapshotPrompt(messages) {
  const dialogue = messages.map((m) => `${m.role === 'user' ? '用户' : '镜'}:${m.content}`).join('\n');
  return `请把这段对话的成果整理为一篇带注释的小作文,以 JSON 格式返回。

## 对话内容(按时间顺序)
${dialogue}

## 输出 JSON 结构(严格遵守)
{
  "schema_version": "v4",
  "title": "决策的简短标题(15字以内,第二人称,如'要不要辞职去创业')",
  "type": "职业 | 关系 | 城市 | 投资 | 教育 | 人生 | 其他",
  "hero_quote": "用户原话中最戳的一句(逐字摘出,不改写)",
  "essay": "Markdown 小作文(见下方规则)",
  "annotations": [
    { "id": 1, "anchor": "...", "type": "reflection|observation|gentle_prompt", "comment": "..." }
  ],
  "confidence": <1-10 的整数,根据下方评分标准>
}

## confidence 评分标准(必须严格遵守,不能默认给 7)
评估整段对话的"探索深度",按以下指标打分:
- 1-3: 几乎停留在表面,用户只说"我很纠结",没有往下走
- 4-5: 有往下的尝试,但被回避了;或只在事实层面打转
- 6-7: 触到了一些紧张感或矛盾,但没有真正命名核心冲突
- 8-9: 用户说出了自己之前没意识到的东西(如"其实我怕的不是X,是Y")
- 10: 有顿悟时刻,核心冲突被清晰命名,且用户对此有身体/情绪的确认

**禁止直接输出 7。必须根据实际对话内容选择匹配的分数。**

## essay 撰写规则(严格)
1. 这是一篇"镜在对话结束后写给你的便签"。风格：留白法 + 镜的口吻混合。像诗，像信，**绝对不像会议纪要**。
2. 你的核心原话逐字保留，直接呈现——不加"你说"前缀，不加引号，像诗句一样嵌入文中。
3. 镜只在三种时候出现，每次不超过1句话：
   - 开场：交代今天聊了什么（1句）
   - 转折处：点出"那一刻"、"然后你自己停了一下"等关键瞬间（1句）
   - 收束：一句不带结论的回望（1句）
4. 【硬性禁止】以下表达绝对不能出现在 essay 中：
   - ❌ "我问"、"我追问"、"我翻转"、"我让你"、"我具体化"
   - ❌ "到了...阶段"、"在...阶段"、"进一步...时"
   - ❌ "关于..."、"谈到..."、"聊到..."
   - ❌ 任何流程性叙述（谁先说了什么、后说了什么）
   - ❌ "define"、"stance"、"premortem"、"blindspot"、"future" 等阶段术语
5. 用"……"做留白分隔场景。省略所有中间过程和次要细节。
6. 只保留最锋利的弧线：表面的纠结 → 往下挖时遇到的阻力 → 最后戳到的那句话。
7. 长度 200-350 字。要短、要有呼吸感、要让读者想重读。
8. 全文不用加粗、不用标题、不用阶段术语。

## annotations 撰写规则
1. 数量 3-7 条
2. anchor 字段必须是 essay 中能找到的子串(逐字匹配),且必须是用户在对话中真的说过的原话
3. type 三选一,口吻递进:
   - reflection(反映):把 ta 的话原样反弹 + 一句温和观察
   - observation(观察):指出 ta 没意识到的言说方式或模式
   - gentle_prompt(轻引导):一个反问让 ta 自己发现盲区
4. 注释铁律:
   - 不评价(不说"这是错的""这是对的")
   - 不下结论(不说"所以你应该 X")
   - 不建议(不说"可以试试 Y")
   - 只反映 + 轻引导
5. 注释口吻像凌晨 2 点陪你聊到天明的朋友的旁白——有温度,但永远不替对方做决定

## 范例(供格式参考,实际内容必须基于本次对话)
{
  "schema_version": "v4",
  "title": "要不要辞职去做设计师",
  "type": "职业",
  "hero_quote": "我已经画了五年了,真的舍不得",
  "essay": "你今天来,带着这件事:\n\n我想辞职去做设计师,但怕养不活自己。\n\n五年了,真的舍不得。\n\n……\n\n其实我不是怕没钱。\n\n是怕被父母看不起。\n\n那一刻,所有的纠结终于有了答案。",
  "annotations": [
    { "id": 1, "anchor": "我想辞职去做设计师,但怕养不活自己", "type": "reflection", "comment": "你的原话。这是你今天的起点,也可能是表面问题。" },
    { "id": 2, "anchor": "我已经画了五年了,真的舍不得", "type": "observation", "comment": "这一句你说得最慢——'五年'这个数字,你在意的不只是设计这件事。" },
    { "id": 3, "anchor": "其实我不是怕没钱,是怕被父母看不起", "type": "gentle_prompt", "comment": "这一句出现得很晚。如果它才是真问题,前面那些'养不活自己'的纠结,是不是只是你想看到的最坏?" }
  ],
  "confidence": 7
}

请只返回 JSON,不要其他文字。`;
}

function normalize(text) {
  if (!text) return '';
  return text
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[？]/g, '?')
    .replace(/[！]/g, '!')
    .replace(/[：]/g, ':')
    .replace(/[；]/g, ';')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/…{2,}/g, '...')
    .replace(/[—]/g, '-');
}

function validateSnapshot(snapshot, messages) {
  const allUserText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');

  const annotations = Array.isArray(snapshot.annotations) ? snapshot.annotations : [];
  const kept = [];
  const dropped = [];

  const normEssay = normalize(snapshot.essay);
  const normUserText = normalize(allUserText);

  for (const anno of annotations) {
    if (!anno || typeof anno.anchor !== 'string' || !anno.anchor.trim()) {
      dropped.push({ anno, reason: 'invalid anchor' });
      continue;
    }
    const normAnchor = normalize(anno.anchor);
    const inEssay = normEssay.includes(normAnchor);
    const inUserMsg = normUserText.includes(normAnchor);
    if (inEssay && inUserMsg) {
      kept.push(anno);
    } else {
      dropped.push({
        id: anno.id,
        anchor: anno.anchor,
        reason: !inEssay ? 'anchor not in essay' : 'anchor not in user messages',
      });
    }
  }

  if (dropped.length > 0) {
    console.warn(`[Snapshot Validation] 丢弃 ${dropped.length}/${annotations.length} 条注释:`, JSON.stringify(dropped, null, 2));
  }

  return {
    ...snapshot,
    schema_version: snapshot.schema_version || 'v4',
    annotations: kept,
  };
}

export default app;
```

- [ ] **Step 2: 创建 `prototype/functions/_lib/routes/conversations.js`**

```js
import { Hono } from 'hono';
import * as db from '../db.js';

const app = new Hono();

app.post('/', async (c) => {
  const body = await c.req.json();
  const saved = await db.saveConversation(c.env.DB, { ...body, userId: c.get('userId') });
  return c.json(saved);
});

app.get('/', async (c) => {
  const conversations = await db.getConversationsByUser(c.env.DB, c.get('userId'));
  const lite = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    type: c.type,
    status: c.status,
    confidence: c.confidence,
    phase: c.phase,
    totalTurns: c.totalTurns,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    calibrationDate: c.calibrationDate,
  }));
  return c.json(lite);
});

app.get('/:id', async (c) => {
  const conv = await db.getConversation(c.env.DB, c.req.param('id'));
  if (!conv || conv.userId !== c.get('userId')) {
    return c.json({ error: '对话不存在' }, 404);
  }
  return c.json(conv);
});

app.delete('/:id', async (c) => {
  const conv = await db.getConversation(c.env.DB, c.req.param('id'));
  if (!conv || conv.userId !== c.get('userId')) {
    return c.json({ error: '对话不存在' }, 404);
  }
  await db.deleteConversation(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

export default app;
```

- [ ] **Step 3: 创建 `prototype/functions/_lib/routes/system.js`**

```js
import { Hono } from 'hono';
import * as db from '../db.js';

const app = new Hono();

app.get('/health', (c) => {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = c.get('llmConfig');
  return c.json({
    status: 'ok',
    llm: LLM_API_KEY ? 'configured' : 'not configured',
    model: LLM_MODEL,
    baseUrl: LLM_BASE_URL,
  });
});

app.get('/stats', async (c) => {
  return c.json(await db.getStats(c.env.DB));
});

app.get('/user', async (c) => {
  const user = await db.getUser(c.env.DB, c.get('userId'));
  return c.json(user);
});

app.post('/events', async (c) => {
  const { type, conversationId, data } = await c.req.json();
  if (!type) {
    return c.json({ error: '缺少事件类型' }, 400);
  }
  await db.recordEvent(c.env.DB, {
    userId: c.get('userId'),
    type,
    conversationId,
    data,
  });
  return c.json({ ok: true });
});

export default app;
```

- [ ] **Step 4: 创建 `prototype/functions/api/[[route]].js`**

```js
import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getLLMConfig } from '../_lib/llm-config.js';
import { requireUserId } from '../_lib/require-user.js';
import chatApp from '../_lib/routes/chat.js';
import conversationsApp from '../_lib/routes/conversations.js';
import systemApp from '../_lib/routes/system.js';

const app = new Hono({ strict: false }).basePath('/api');

app.use(async (c, next) => {
  c.set('llmConfig', getLLMConfig(c.env));
  await next();
});

app.use('/chat', requireUserId);
app.use('/snapshot', requireUserId);
app.use('/conversations/*', requireUserId);
app.use('/user', requireUserId);
app.use('/events', requireUserId);

app.route('/', chatApp);
app.route('/conversations', conversationsApp);
app.route('/', systemApp);

export const onRequest = handle(app);
```

- [ ] **Step 5: 提交**

```bash
git add prototype/functions/api prototype/functions/_lib/routes
git commit -m "feat: migrate Express routes to Hono Pages Functions"
```

---

## Task 5: 清理旧架构文件与更新前端注释

**Files:**
- Delete: `prototype/server.js`, `prototype/db.js`, `prototype/llm-config.js`
- Delete: `prototype/routes/` 目录， `prototype/middleware/` 目录， `prototype/prompts/` 目录
- Delete: `prototype/Dockerfile`
- Modify: `prototype/public/index.html`

**Interfaces:**
- 旧 Express 入口、文件数据库、Express 路由、中间件、prompts 目录均已迁移到 `functions/_lib/`。
- `public/index.html` 的 API_BASE 注释说明现在由 Cloudflare Pages Functions 提供同域 API。

- [ ] **Step 1: 删除旧架构文件**

```bash
cd prototype
rm -f server.js db.js llm-config.js Dockerfile
rm -rf routes middleware prompts
```

- [ ] **Step 2: 更新 `prototype/public/index.html` 注释**

将：

```html
<script>
  // 部署时由 CloudBase 静态托管覆盖；本地开发同源
  window.__API_BASE__ = '';
</script>
```

改为：

```html
<script>
  // Cloudflare Pages Functions 提供同域 /api/*，保持空字符串即可
  window.__API_BASE__ = '';
</script>
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: remove Express server and file-based database"
```

---

## Task 6: 安装依赖、验证语法与推送分支

**Files:**
- Modify: `prototype/package-lock.json`（由 npm install 生成）

- [ ] **Step 1: 安装新依赖**

```bash
cd prototype
rm -rf node_modules package-lock.json
npm install
```

- [ ] **Step 2: 验证 Hono 入口可解析**

```bash
cd prototype
npx wrangler pages functions build --outdir .wrangler/tmp/build
```

若命令成功且无 import 错误，则 Functions 结构正确。

- [ ] **Step 3: 检查 git status 并提交 lock 文件**

```bash
git add package-lock.json
git commit -m "chore: install Hono and Wrangler dependencies"
```

- [ ] **Step 4: 推送到远程分支**

```bash
git push origin worktree-cloudflare-deploy
```

- [ ] **Step 5: 提供部署指引**

向用户说明：
1. 在 Cloudflare 控制台创建 D1 数据库，替换 `wrangler.toml` 中的 `database_id`。
2. 运行 `npm run d1:migrate` 应用表结构。
3. 运行 `wrangler secret put LLM_API_KEY` 设置 LLM 密钥。
4. 运行 `npm run deploy` 部署 Pages。

---

## Self-Review

- **Spec coverage:**
  - Express → Hono：Task 4。
  - 文件 DB → D1：Task 1（schema）、Task 2（封装）。
  - Pages 静态托管：Task 1（wrangler.toml `pages_build_output_dir`）。
  - 独立分支不污染 main：通过 worktree 隔离。
  - 删除旧依赖、更新 package.json：Task 1、Task 5。
  - 敏感配置用 secret：Task 1 说明。
- **Placeholder scan:** 无 TBD/TODO，所有代码完整。
- **Type consistency:** `c.get('llmConfig')`、`c.get('userId')`、`c.env.DB` 在各任务中一致使用。
