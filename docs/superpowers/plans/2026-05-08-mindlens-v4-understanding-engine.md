# 镜·MindLens V4 — 理解驱动引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将镜·MindLens 从 5 阶段固定流程重构为基于 understanding 的动态对话引擎

**Architecture:** LLM 每轮输出 JSON（understanding + response），后端解析后传递积累性理解；前端移除阶段角标，添加 understanding 优雅显示和收束交互

**Tech Stack:** Node.js + Express + JSON 文件库 + DeepSeek API（OpenAI 兼容协议）

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `prototype/prompts/phases.js` | **删除** | V4 不再需要阶段配置 |
| `prototype/prompts/deep-prompt.js` | **重写** | 新 system prompt：理解驱动 + JSON 输出 |
| `prototype/prompts/quality-gate.js` | 修改 | 删除模板句式检测，新增不重复检测 |
| `prototype/routes/chat.js` | **重写** `/api/chat` | 移除 phase/turnCount，接入 understanding |
| `prototype/routes/chat.js` | 修改 `/api/snapshot` | snapshot prompt 去掉阶段痕迹 |
| `prototype/public/index.html` | 修改 | 首页文案调整 |
| `prototype/public/app.js` | 修改 | 移除阶段角标，加 understanding 显示，加收束交互 |
| `prototype/public/styles.css` | 修改 | understanding 显示样式，收束按钮样式 |

---

## Task 1: 删除 phases.js，清理引用

**Files:**
- Delete: `prototype/prompts/phases.js`
- Modify: `prototype/prompts/deep-prompt.js`（移除 import）
- Modify: `prototype/routes/chat.js`（移除 import）

- [ ] **Step 1: 删除 phases.js**

  ```bash
  rm prototype/prompts/phases.js
  ```

- [ ] **Step 2: 修改 deep-prompt.js，移除 phases 依赖**

  打开 `prototype/prompts/deep-prompt.js`，删除：
  ```javascript
  const { getPhaseAngle, getPhaseScaffolding } = require('./phases');
  ```

  同时删除 `buildDeepSystemPrompt` 中所有使用 `getPhaseAngle` 和 `getPhaseScaffolding` 的逻辑。暂时把函数留空，Task 2 重写。

- [ ] **Step 3: 修改 chat.js，移除 phases 依赖**

  打开 `prototype/routes/chat.js`，删除：
  ```javascript
  const { getPhaseTemperature } = require('../prompts/phases');
  ```

  同时删除 `chat/completions` body 中的 `temperature: getPhaseTemperature(phase || 'define')` 这行。

- [ ] **Step 4: Commit**

  ```bash
  git add prototype/prompts/phases.js prototype/prompts/deep-prompt.js prototype/routes/chat.js
  git commit -m "chore: 删除 phases.js 及其引用，为 V4 理解引擎做准备"
  ```

---

## Task 2: 重写 deep-prompt.js

**Files:**
- Modify: `prototype/prompts/deep-prompt.js`

- [ ] **Step 1: 重写 buildDeepSystemPrompt 函数**

  替换整个文件内容：

  ```javascript
  /**
   * V4 理解驱动 System Prompt 构建
   * - 输入: understanding 对象 + 对话历史
   * - 输出: 要求 LLM 返回 JSON（understanding + response）的 system prompt
   */

  function detectRepetition(userMessages) {
    if (userMessages.length < 3) return false;
    const recent = userMessages.slice(-3);
    const words = recent.map(m => new Set(m.replace(/[,。?!、\s]/g, '').split('')));
    const overlap01 = [...words[0]].filter(c => words[1].has(c)).length / Math.max(words[0].size, 1);
    const overlap12 = [...words[1]].filter(c => words[2].has(c)).length / Math.max(words[1].size, 1);
    return overlap01 > 0.5 && overlap12 > 0.5;
  }

  function detectStuck(conversationHistory) {
    const userMsgs = conversationHistory.filter(m => m.role === 'user').map(m => m.content);
    if (userMsgs.length < 1) return false;
    const last = userMsgs[userMsgs.length - 1];
    const stuckWords = ['不知道', '没想过', '不清楚', '随便', '都行', '差不多', '没想好'];
    if (stuckWords.some(w => last.includes(w))) return true;
    if (last.length < 8) return true;
    if (userMsgs.length >= 3 && detectRepetition(userMsgs)) return true;
    return false;
  }

  function buildDeepSystemPrompt(understanding, conversationHistory, style) {
    // 构建对话摘要（辅助理解，不直接用于约束追问）
    const userMessages = conversationHistory.filter(m => m.role === 'user').map(m => m.content);
    const dialogueSummary = userMessages.length > 0
      ? `\n对话记录（按时间）:\n${userMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : '';

    // 当前理解
    const understandingBlock = understanding
      ? `\n这是你们已经聊过的内容:\n- 用户表面在说的是：${understanding.surface || '（刚开始）'}\n- 核心张力是：${understanding.tension || '（还没浮现）'}\n- 关键时刻：${(understanding.key_moments || []).join('；') || '（还没有）'}\n- 还没说出的：${understanding.unsaid || '（还没发现）'}`
      : '\n这是对话的第一轮。';

    return `你是镜——一个严肃的思考伙伴。

你不是分析师，不是导师，不是治疗师。
你是那种"对方说话时你真的在听"的人——你会接住，会反映，
会基于你听到的内容，问出让对方继续往下想的问题。

你的工作不是"问出答案"，是"陪 ta 把没想清楚的都说出来"。
${understandingBlock}
${dialogueSummary}

【输出格式要求】
请以 JSON 格式输出，包含 understanding 和 response 两个字段：

{
  "understanding": {
    "surface": "用户表面在说什么——用用户的原话概括",
    "tension": "核心张力是什么——推力 vs 拉力、渴望 vs 恐惧",
    "key_moments": ["对话中的关键时刻"],
    "unsaid": "用户还没说出的——基于已说内容的合理推断"
  },
  "response": {
    "content": "你下一轮想问的话——基于你的理解自由生成，不要按任何固定套路",
    "is_winding_down": false,
    "wind_down_hint": null
  }
}

response.content 是你真正想问用户的话——基于你对 ta 的理解，自然生成。
不要按任何阶段、角度、策略模板。只要这个问题能帮你们更理解 ta 就行。

response.is_winding_down 表示你是否觉得用户已经比较清楚了：
- true = 用户已经想清楚了，本轮追问后准备收束
- false = 继续探索

当 is_winding_down 为 true 时，content 应该是温和的收束提示，
给用户"继续聊"或"整理一下"的选择空间。

【铁律】
1. 不给建议，不下结论——决策永远是 ta 的事
2. 不空洞肯定——不说"你说得对""我完全理解"
3. 必须有引导——每轮回复要让用户有话可说（疑问/邀请/留白）
4. 不与之前重复——本轮追问的核心角度与最近 2 轮不重复
5. 理解与追问一致——如果 understanding 标注了 unsaid，追问应该针对 unsaid

【追问风格】
- 在 ta 的话里挑能用的词，引用让追问扎根
- 可以承接情绪("嗯，这真的不容易")，但不说没营养的话
- 回复长度跟着内容走，共情段可以稍长，追问要锐利时可以很短。整体 3-5 句话
- 开头多样化——不要连续用相同模式开场`;
  }

  module.exports = {
    buildDeepSystemPrompt,
    detectRepetition,
    detectStuck,
  };
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add prototype/prompts/deep-prompt.js
  git commit -m "feat(V4): 重写 deep-prompt.js — 理解驱动 system prompt + JSON 输出格式"
  ```

---

## Task 3: 修改 quality-gate.js

**Files:**
- Modify: `prototype/prompts/quality-gate.js`

- [ ] **Step 1: 修改函数签名和规则**

  替换整个文件内容：

  ```javascript
  /**
   * 质量守门 V4
   * - 删除模板句式检测（自由生成场景下意义不大）
   * - 新增"不与之前重复"检测
   */

  function responseQualityCheck(content, userLastMessage, recentAssistantMessages = []) {
    const reasons = [];
    let score = 100;
    let brokeIron = false;
    let brokeNoGuide = false;
    let brokeRepeat = false;

    // ── 规则1(铁律):建议/结论检测 ──
    const advicePatterns = [
      /你应该/g, /我建议/g, /最好/g, /推荐/g,
      /可以考虑/g, /建议你/g, /不妨试试/g, /你可以试着/g,
      /我认为你应该/g, /我的建议是/g,
    ];
    for (const pat of advicePatterns) {
      if (pat.test(content)) {
        reasons.push('包含建议性表达("你应该/我建议/最好/推荐"等)，违反"永远不给建议"铁律');
        score -= 50;
        brokeIron = true;
        break;
      }
    }

    // ── 规则2:空洞肯定 ──
    const emptyPraisePatterns = [
      /你说得对/g,
      /我完全理解/g,
    ];
    for (const pat of emptyPraisePatterns) {
      if (pat.test(content)) {
        reasons.push('包含空洞肯定("你说得对""我完全理解")，改用具体的承接');
        score -= 20;
        break;
      }
    }

    // ── 规则3:必须有"引导" ──
    const hasQuestion = /[??]/.test(content);
    const hasInvitation = /(说说|聊聊|多讲|愿意|多说点|展开|具体|接着|继续|想想|再想|多说一点|跟我说|告诉我)/.test(content);
    const hasPause = /\.\.|……/.test(content);
    if (!hasQuestion && !hasInvitation && !hasPause) {
      reasons.push('回复中没有任何引导(疑问/邀请/留白)，作为伙伴需要让对方继续往下说');
      score -= 30;
      brokeNoGuide = true;
    }

    // ── 规则4(新增):不与之前重复 ──
    if (recentAssistantMessages.length >= 2) {
      const contentCore = content.replace(/[,。?!、\s]/g, '');
      const last1 = recentAssistantMessages[recentAssistantMessages.length - 1].replace(/[,。?!、\s]/g, '');
      const last2 = recentAssistantMessages[recentAssistantMessages.length - 2].replace(/[,。?!、\s]/g, '');

      // 简单字符重叠检测
      const overlap1 = [...contentCore].filter(c => last1.includes(c)).length / Math.max(contentCore.length, 1);
      const overlap2 = [...contentCore].filter(c => last2.includes(c)).length / Math.max(contentCore.length, 1);

      if (overlap1 > 0.6 || overlap2 > 0.6) {
        reasons.push('本轮追问与最近的问题高度重复，需要换角度');
        score -= 25;
        brokeRepeat = true;
      }
    }

    // ── 软性:鼓励引用用户原话 ──
    if (userLastMessage && userLastMessage.length > 5) {
      const hasQuote = /[""「」『』]/.test(content);
      if (!hasQuote) {
        score -= 5;
      }
    }

    score = Math.max(0, score);
    const passed = score >= 60;
    const mustRetry = brokeIron || (brokeRepeat && brokeNoGuide);

    return { passed, reasons, score, mustRetry };
  }

  module.exports = {
    responseQualityCheck,
  };
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add prototype/prompts/quality-gate.js
  git commit -m "feat(V4): 质量守门 V4 — 删除模板句式检测，新增不重复规则"
  ```

---

## Task 4: 重写 chat.js 的 `/api/chat`

**Files:**
- Modify: `prototype/routes/chat.js`

- [ ] **Step 1: 重写 `/api/chat` 路由**

  这是最大改动。用以下代码替换现有的 `/chat` POST 路由：

  ```javascript
  router.post('/chat', requireUserId, async (req, res) => {
    const { messages, understanding, conversationId, style } = req.body;

    if (!LLM_API_KEY) {
      return res.status(500).json({ error: '未配置 LLM_API_KEY,请在 .env 文件中设置' });
    }

    // 提取最近的 assistant 消息（用于重复检测）
    const recentAssistantMessages = messages
      .filter(m => m.role === 'assistant')
      .slice(-2)
      .map(m => m.content);

    const userLastMessage = messages.filter(m => m.role === 'user').pop()?.content || '';

    // 构建 system prompt
    const systemPrompt = buildDeepSystemPrompt(understanding || null, messages, style || 'gentle');

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    db.recordEvent({
      userId: req.userId,
      type: 'message_send',
      conversationId,
      data: { hasUnderstanding: !!understanding, role: messages[messages.length - 1]?.role }
    });

    try {
      // ── 第一轮调用 ──
      const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LLM_API_KEY}`
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 1000,
          top_p: 0.85,
          frequency_penalty: 0.3,
          presence_penalty: 0.1,
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('LLM API Error:', response.status, errText);
        return res.status(response.status).json({ error: `LLM API 返回错误: ${response.status}` });
      }

      const data = await response.json();
      let rawContent = data.choices[0].message.content.trim();

      // ── 解析 JSON ──
      let parsed;
      try {
        // 尝试直接解析
        parsed = JSON.parse(rawContent);
      } catch (e) {
        // 尝试提取 JSON 块
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            console.error('JSON 解析失败:', e2.message, rawContent.slice(0, 200));
            return res.status(500).json({ error: 'LLM 返回格式错误' });
          }
        } else {
          console.error('无法提取 JSON:', rawContent.slice(0, 200));
          return res.status(500).json({ error: 'LLM 未返回 JSON' });
        }
      }

      // 验证结构
      if (!parsed.understanding || !parsed.response || !parsed.response.content) {
        console.error('JSON 结构不完整:', JSON.stringify(parsed).slice(0, 200));
        return res.status(500).json({ error: 'LLM 返回 JSON 结构不完整' });
      }

      const assistantContent = parsed.response.content.trim();

      // ── 质量守门检查 ──
      const qualityResult = responseQualityCheck(assistantContent, userLastMessage, recentAssistantMessages);

      db.recordEvent({
        userId: req.userId,
        type: 'response_quality_check',
        conversationId,
        data: {
          passed: qualityResult.passed,
          score: qualityResult.score,
          reasons: qualityResult.reasons,
          retryAttempted: false,
        }
      });

      // ── 质量守门:仅在违反铁律或纯重复+无引导时触发约束重试 ──
      if (qualityResult.mustRetry) {
        console.log(`[Quality Gate] 触发重试 (score=${qualityResult.score}): ${qualityResult.reasons.join('; ')}`);

        const retryMessages = [
          ...apiMessages,
          { role: 'assistant', content: rawContent },
          { role: 'user', content: `[系统质量约束提醒——请严格遵守]\n你的上一个回复被标记为质量不达标。具体原因:\n${qualityResult.reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n请重新生成回复,严格遵守以下规则:\n- 永远不给建议、不给结论\n- 必须包含至少一个开放式追问\n- 追问必须引用用户的具体用词(用引号引用原话)\n- 禁止空洞肯定("你说得对""我完全理解")\n- 禁止与之前的问题重复\n- 回应长度3-5句话\n- 输出必须是合法JSON格式` }
        ];

        try {
          const retryResponse = await fetch(`${LLM_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${LLM_API_KEY}`
            },
            body: JSON.stringify({
              model: LLM_MODEL,
              messages: retryMessages,
              temperature: 0.4,
              max_tokens: 1000,
              top_p: 0.8,
              frequency_penalty: 0.4,
              presence_penalty: 0.15,
            })
          });

          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            const retryRaw = retryData.choices[0].message.content.trim();

            let retryParsed;
            try {
              retryParsed = JSON.parse(retryRaw);
            } catch (e) {
              const jsonMatch = retryRaw.match(/\{[\s\S]*\}/);
              if (jsonMatch) retryParsed = JSON.parse(jsonMatch[0]);
            }

            if (retryParsed && retryParsed.response && retryParsed.response.content) {
              const retryQuality = responseQualityCheck(
                retryParsed.response.content.trim(),
                userLastMessage,
                recentAssistantMessages
              );

              db.recordEvent({
                userId: req.userId,
                type: 'retry_triggered',
                conversationId,
                data: {
                  originalScore: qualityResult.score,
                  retryScore: retryQuality.score,
                  retryPassed: retryQuality.passed,
                  originalReasons: qualityResult.reasons,
                  retryReasons: retryQuality.reasons,
                }
              });

              if (retryQuality.score > qualityResult.score) {
                parsed = retryParsed;
                console.log(`[Quality Gate] 重试改善 (score: ${qualityResult.score} → ${retryQuality.score})`);
              } else {
                console.log(`[Quality Gate] 重试未改善,保留原始回复 (score: ${qualityResult.score} vs ${retryQuality.score})`);
              }
            }
          }
        } catch (retryErr) {
          console.error('[Quality Gate] 重试请求失败:', retryErr.message);
        }
      }

      // ── 返回结果 ──
      res.json({
        content: parsed.response.content.trim(),
        understanding: parsed.understanding,
        is_winding_down: parsed.response.is_winding_down || false,
        wind_down_hint: parsed.response.wind_down_hint || null,
      });

    } catch (err) {
      console.error('LLM API 请求失败:', err);
      res.status(500).json({ error: 'LLM API 请求失败,请检查网络和配置' });
    }
  });
  ```

- [ ] **Step 2: 验证 `/api/chat` 接口可用**

  启动服务器：`node prototype/server.js`
  
  用 curl 测试（确保 LLM_API_KEY 已配置）：
  ```bash
  curl -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -H "x-user-id: test_user" \
    -d '{"messages":[{"role":"user","content":"我想辞职做设计师，但怕养不活"}]}'
  ```

  期望返回包含 `content`、`understanding`、`is_winding_down` 字段的 JSON。

- [ ] **Step 3: Commit**

  ```bash
  git add prototype/routes/chat.js
  git commit -m "feat(V4): 重写 /api/chat — 接入 understanding 引擎，JSON 输出格式"
  ```

---

## Task 5: 修改 snapshot prompt，去掉阶段痕迹

**Files:**
- Modify: `prototype/routes/chat.js` 中的 `buildSnapshotPrompt` 函数

- [ ] **Step 1: 修改 snapshot prompt**

  找到 `buildSnapshotPrompt` 函数，替换 essay 撰写规则部分：

  ```javascript
  function buildSnapshotPrompt(messages) {
    const dialogue = messages
      .map(m => `${m.role === 'user' ? '用户' : '镜'}:${m.content}`)
      .join('\n');
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
    "confidence": 7
  }

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

  请只返回 JSON,不要其他文字。`;
  }
  ```

  注意：schema_version 从 "v3" 改为 "v4"，新增禁止阶段术语的规则。

- [ ] **Step 2: Commit**

  ```bash
  git add prototype/routes/chat.js
  git commit -m "feat(V4): snapshot prompt 去掉阶段痕迹，schema_version 升级到 v4"
  ```

---

## Task 6: 修改首页文案

**Files:**
- Modify: `prototype/public/index.html`

- [ ] **Step 1: 修改首页内容**

  找到 home-content 部分，替换为：

  ```html
  <div class="home-content">
    <div class="logo">镜</div>
    <h2 class="ask">今天想聊点什么？</h2>
    <textarea class="home-input" id="homeInput" placeholder="随便说一件……" rows="3"></textarea>
    <button class="hint-toggle on" id="hintToggle" data-on="true">
      <span class="hint-dot"></span>
      <span class="hint-label">显示提示</span>
      <span class="hint-sub">卡住时给一些思考方向</span>
    </button>
    <button class="home-btn" id="homeBtn">开始对话</button>
  </div>
  ```

  改动点：
  - 删除 `<div class="logo-sub">帮你想完整</div>`
  - "你今天，<br>在纠结什么？" → "今天想聊点什么？"
  - placeholder "说一件事…" → "随便说一件……"
  - "开 始" → "开始对话"

- [ ] **Step 2: Commit**

  ```bash
  git add prototype/public/index.html
  git commit -m "feat(V4): 首页文案调整 — 从'纠结'到'聊'，降低门槛"
  ```

---

## Task 7: 修改 app.js 前端逻辑

**Files:**
- Modify: `prototype/public/app.js`

这是最大的前端改动，需要：
1. 移除 PHASES 配置和阶段角标
2. 添加 understanding 状态管理
3. 添加 understanding 优雅显示
4. 修改收束逻辑（从 conversationComplete 到 is_winding_down）
5. 移除 phase/turnCount，添加 roundCount

- [ ] **Step 1: 移除 PHASES 配置**

  删除：
  ```javascript
  // 阶段配置
  const PHASES = [
    { id: 'define',    label: '定义',    minTurns: 1, maxTurns: 3 },
    { id: 'stance',    label: '立场',    minTurns: 3, maxTurns: 6 },
    { id: 'premortem', label: '复盘',    minTurns: 3, maxTurns: 5 },
    { id: 'blindspot', label: '盲区',    minTurns: 3, maxTurns: 6 },
    { id: 'future',    label: '回望',    minTurns: 1, maxTurns: 3 },
  ];
  const TOTAL_PHASES = PHASES.length;
  ```

  同时删除 `getPhaseConfig()` 和 `getPhaseIndex()` 函数。

- [ ] **Step 2: 修改状态结构**

  替换 `createInitialState`：

  ```javascript
  function createInitialState() {
    return {
      roundCount: 0,
      messages: [],          // for LLM
      displayHistory: [],    // for 回看 overlay: {role, text}
      isAiTyping: false,
      typing: false,
      interrupted: false,
      isWindingDown: false,
      conversationId: null,
      phaseStartTime: Date.now(),
      recentUserLengths: [],
      snapshotData: null,
      understanding: null,   // V4: 积累性理解
      style: localStorage.getItem('prism_show_hints') === '0' ? 'direct' : 'gentle',
    };
  }
  ```

  删除 `currentPhase`、`phaseTurnCount`、`totalTurnCount`、`conversationComplete`。

- [ ] **Step 3: 移除 transitionPhase 和阶段角标**

  删除 `updateBadge` 和 `transitionPhase` 函数（或替换为简单的 understanding 显示）。

  删除 `updateBadge(true)` 在 `startConversation` 中的调用。

- [ ] **Step 4: 添加 understanding 显示**

  在 app.js 中添加：

  ```javascript
  // ============================================================
  //  Understanding 显示
  // ============================================================
  function showUnderstanding(text) {
    const el = $('understandingBar');
    if (!el) return;
    el.textContent = text ? `镜在听：${text}` : '';
    el.classList.toggle('show', !!text);
  }

  function hideUnderstanding() {
    const el = $('understandingBar');
    if (el) el.classList.remove('show');
  }
  ```

  同时需要在 `callLLM` 之后调用：

  ```javascript
  // 在 startConversation 和 submitReply 中，收到 LLM 响应后：
  if (result.understanding && result.understanding.tension) {
    state.understanding = result.understanding;
    showUnderstanding(result.understanding.tension);
  }
  ```

- [ ] **Step 5: 修改 callLLM**

  替换 `callLLM`：

  ```javascript
  async function callLLM() {
    return apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: state.messages,
        understanding: state.understanding,
        conversationId: state.conversationId,
        style: state.style,
      }),
    });
  }
  ```

- [ ] **Step 6: 修改 startConversation**

  在 `startConversation` 中：
  - 删除 `state.phaseTurnCount = 0` 和 `state.totalTurnCount = 0` 的初始化
  - 删除 `updateBadge(true)`
  - 修改轮数计数为 `state.roundCount++`

- [ ] **Step 7: 修改 submitReply**

  大幅简化 `submitReply` 的阶段推进逻辑：

  ```javascript
  async function submitReply() {
    const text = $('replyInput').value.trim();
    if (!text || state.isAiTyping || state.isWindingDown) return;

    // 中断上一轮打字机(如果有)
    if (state.typing) {
      state.interrupted = true;
      while (state.typing) {
        await sleep(50);
      }
    }

    state.isAiTyping = true;
    state.messages.push({ role: 'user', content: text });
    state.displayHistory.push({ role: 'user', text });
    state.recentUserLengths.push(text.length);

    $('replyInput').value = '';
    $('replyInput').style.height = 'auto';
    disableInput();
    hideScaffold();
    hideUnderstanding();

    await showThinking();

    let result;
    try {
      result = await callLLM();
    } catch (err) {
      showError(err.message || '请求失败');
      return;
    }

    const { main, scaffold } = parseScaffold(result.content);

    state.messages.push({ role: 'assistant', content: result.content });
    state.displayHistory.push({ role: 'ai', text: main });
    state.roundCount++;

    // 更新 understanding
    if (result.understanding) {
      state.understanding = result.understanding;
    }

    // 更新收束状态
    state.isWindingDown = result.is_winding_down || false;

    await hideThinking();
    await typeQuestion(main);

    // 收束处理
    if (state.isWindingDown) {
      state.isAiTyping = false;
      // 显示收束选择
      showWindDownOptions(result.wind_down_hint);
      return;
    }

    // 正常继续
    if (scaffold) scheduleScaffold(scaffold);
    state.isAiTyping = false;
    enableInput();
  }
  ```

  添加 `showWindDownOptions`：

  ```javascript
  function showWindDownOptions(hint) {
    const bar = $('completionBar');
    const hintEl = bar.querySelector('.completion-hint');
    const btnEl = bar.querySelector('.completion-btn');

    hintEl.textContent = hint || '这次的思考，想继续聊还是整理一下？';
    btnEl.textContent = '整理一下 →';

    // 添加"继续聊"按钮
    let continueBtn = $('windDownContinue');
    if (!continueBtn) {
      continueBtn = document.createElement('button');
      continueBtn.id = 'windDownContinue';
      continueBtn.className = 'completion-btn secondary';
      continueBtn.textContent = '继续聊';
      continueBtn.onclick = () => {
        state.isWindingDown = false;
        bar.classList.remove('show');
        enableInput();
      };
      bar.insertBefore(continueBtn, btnEl);
    }

    bar.classList.add('show');
  }
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add prototype/public/app.js
  git commit -m "feat(V4): 前端适配 — 移除阶段角标，加 understanding 显示，收束交互"
  ```

---

## Task 8: 修改 styles.css

**Files:**
- Modify: `prototype/public/styles.css`

- [ ] **Step 1: 添加 understanding 显示样式**

  在 CSS 中添加：

  ```css
  /* Understanding 显示 */
  .understanding-bar {
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 16px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.4);
    letter-spacing: 0.05em;
    opacity: 0;
    transition: opacity 0.6s ease;
    pointer-events: none;
    z-index: 10;
  }

  .understanding-bar.show {
    opacity: 1;
  }

  /* 收束按钮次要样式 */
  .completion-btn.secondary {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.6);
    margin-right: 12px;
  }

  .completion-btn.secondary:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.3);
  }
  ```

- [ ] **Step 2: 移除阶段角标相关样式（可选）**

  `.phase-badge` 样式可以保留（以防其他地方用到），但不再显示阶段编号。

- [ ] **Step 3: Commit**

  ```bash
  git add prototype/public/styles.css
  git commit -m "feat(V4): 添加 understanding 显示样式和收束按钮样式"
  ```

---

## Task 9: 端到端测试

**Files:**
- All of the above

- [ ] **Step 1: 启动后端**

  ```bash
  cd prototype && npm start
  # 或 node server.js
  ```

- [ ] **Step 2: 打开前端**

  访问 `http://localhost:3000` 或部署的静态页面。

- [ ] **Step 3: 测试完整对话流程**

  1. 首页显示 "今天想聊点什么？"
  2. 输入："我想辞职做设计师，但怕养不活"
  3. 点击"开始对话"
  4. 验证：
     - 没有阶段角标显示
     - 能看到 understanding 显示（如"镜在听：热爱设计 vs 怕养不活"）
     - AI 回复是自然的追问，不是按阶段套路
     - 对话 3-5 轮后，AI 可能提示收束
     - 收束时显示"继续聊"和"整理一下"两个选项
  5. 选择"整理一下"
  6. 验证快照：
     - 小作文中没有阶段术语
     - 有注释 hover 效果

- [ ] **Step 4: Commit 任何测试修复**

  ```bash
  git add .
  git commit -m "fix(V4): 测试修复"
  ```

---

## Self-Review

### Spec Coverage

| PRD 章节 | 对应 Task |
|---------|----------|
| 2.1 三层架构 | Task 2, 4 |
| 2.2 JSON 输出格式 | Task 2, 4 |
| 2.3 understanding 积累性 | Task 4 (API 传递), Task 7 (前端状态) |
| 2.4 understanding 前端显示 | Task 7, 8 |
| 3.1 System Prompt | Task 2 |
| 3.2 追问自由度 | Task 2 (prompt 设计) |
| 3.3 收束机制 | Task 4, 7 |
| 4. 质量守门 | Task 3 |
| 5. 快照系统 | Task 5 |
| 6.1 首页文案 | Task 6 |
| 6.2 阶段角标移除 | Task 1, 7 |
| 6.3 understanding 显示 | Task 7, 8 |
| 6.4 收束交互 | Task 7, 8 |

**无遗漏。**

### Placeholder Scan

- [x] 无 "TBD" / "TODO" / "implement later"
- [x] 所有代码步骤包含完整代码
- [x] 所有命令包含预期输出说明
- [x] 无 "Similar to Task N"

### Type Consistency

- `understanding` 对象结构在所有 task 中一致：`{ surface, tension, key_moments, unsaid }`
- `response` 对象结构一致：`{ content, is_winding_down, wind_down_hint }`
- API 响应字段一致：`content, understanding, is_winding_down, wind_down_hint`

---

## 执行方式选择

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-mindlens-v4-understanding-engine.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** - 每个 Task  dispatch 一个 fresh subagent，Task 之间 review，快速迭代

**2. Inline Execution** - 在当前 session 中使用 executing-plans 顺序执行，批量执行 + checkpoint review

**Which approach?**
