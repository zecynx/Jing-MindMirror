/**
 * 镜·MindLens V2 — 服务器启动器
 *
 * 拆分结构:
 *   prompts/    — Prompt 工程层(phases / deep-prompt / quality-gate)
 *   routes/     — API 路由(chat / conversations / system)
 *   middleware/ — 公共中间件(require-user)
 *   db.js       — JSON 文件数据库
 *   llm-config.js — LLM 配置
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

const { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } = require('./llm-config');
const chatRouter = require('./routes/chat');
const conversationsRouter = require('./routes/conversations');
const systemRouter = require('./routes/system');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 路由挂载
app.use('/api', chatRouter);                  // /api/chat /api/snapshot
app.use('/api/conversations', conversationsRouter);
app.use('/api', systemRouter);                // /api/health /api/stats /api/user /api/events

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🔮 镜·MindLens V2 服务器已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   LLM:  ${LLM_MODEL} @ ${LLM_BASE_URL}`);
  if (!LLM_API_KEY) {
    console.log(`\n   ❌ API Key 未配置!请按以下步骤设置:`);
    console.log(`      1. 复制 .env.example 为 .env:cp .env.example .env`);
    console.log(`      2. 在 .env 中填入 LLM_API_KEY=你的密钥`);
    console.log(`      3. 重启服务器\n`);
  } else {
    console.log(`   API:  ✅ 已配置\n`);
  }
});
