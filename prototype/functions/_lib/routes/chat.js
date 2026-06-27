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
