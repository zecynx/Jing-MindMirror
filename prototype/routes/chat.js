/**
 * /api/chat   — LLM 对话代理(含质量守门 + 重试)
 * /api/snapshot — 决策快照生成
 */
const express = require('express');
const db = require('../db');
const requireUserId = require('../middleware/require-user');
const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = require('../llm-config');
const { buildDeepSystemPrompt } = require('../prompts/deep-prompt');
const { responseQualityCheck } = require('../prompts/quality-gate');

const router = express.Router();

router.post('/chat', requireUserId, async (req, res) => {
  const { messages, phase, turnCount, conversationId, style } = req.body;

  if (!LLM_API_KEY) {
    return res.status(500).json({ error: '未配置 LLM_API_KEY,请在 .env 文件中设置' });
  }

  const systemPrompt = buildDeepSystemPrompt(phase || 'define', turnCount, messages, style || 'gentle');

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  db.recordEvent({
    userId: req.userId,
    type: 'message_send',
    conversationId,
    data: { phase, turnCount, role: messages[messages.length - 1]?.role }
  });

  const userLastMessage = messages.filter(m => m.role === 'user').pop()?.content || '';

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
        max_tokens: 800,
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
    let content = data.choices[0].message.content.trim();

    // ── 质量守门检查 ──
    const qualityResult = responseQualityCheck(content, userLastMessage);

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

    // ── 质量守门:仅在违反铁律或纯模板+无引导时触发约束重试 ──
    if (qualityResult.mustRetry) {
      console.log(`[Quality Gate] 触发重试 (score=${qualityResult.score}): ${qualityResult.reasons.join('; ')}`);

      const retryMessages = [
        ...apiMessages,
        { role: 'assistant', content },
        { role: 'user', content: `[系统质量约束提醒——请严格遵守]\n你的上一个回复被标记为质量不达标。具体原因:\n${qualityResult.reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n请重新生成回复,严格遵守以下规则:\n- 永远不给建议、不给结论\n- 必须包含至少一个开放式追问\n- 追问必须引用用户的具体用词(用引号引用原话)\n- 禁止以"你用了""你说""你提到"等元评论开头,直接追问内容本身\n- 禁止使用"你有没有想过""你是否考虑过""你觉得呢"等模板句式\n- 禁止空洞肯定("你说得对""我理解你的感受")\n- 回应长度2-4句话` }
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
            max_tokens: 800,
            top_p: 0.8,
            frequency_penalty: 0.4,
            presence_penalty: 0.15,
          })
        });

        if (retryResponse.ok) {
          const retryData = await retryResponse.json();
          const retryContent = retryData.choices[0].message.content.trim();

          const retryQuality = responseQualityCheck(retryContent, userLastMessage);

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
            content = retryContent;
            console.log(`[Quality Gate] 重试改善 (score: ${qualityResult.score} → ${retryQuality.score})`);
          } else {
            console.log(`[Quality Gate] 重试未改善,保留原始回复 (score: ${qualityResult.score} vs ${retryQuality.score})`);
          }
        } else {
          console.log('[Quality Gate] 重试API调用失败,使用原始回复');
        }
      } catch (retryErr) {
        console.error('[Quality Gate] 重试请求失败:', retryErr.message);
      }
    }

    // ── 解析阶段标记 ──
    let phaseComplete = false;
    let conversationComplete = false;

    if (content.includes('[CONVERSATION_COMPLETE]')) {
      conversationComplete = true;
      content = content.replace('[CONVERSATION_COMPLETE]', '').trim();
    }
    if (content.includes('[PHASE_COMPLETE]')) {
      phaseComplete = true;
      content = content.replace('[PHASE_COMPLETE]', '').trim();
    }

    res.json({
      content,
      phaseComplete,
      conversationComplete,
    });

  } catch (err) {
    console.error('LLM API 请求失败:', err);
    res.status(500).json({ error: 'LLM API 请求失败,请检查网络和配置' });
  }
});

router.post('/snapshot', requireUserId, async (req, res) => {
  if (!LLM_API_KEY) {
    return res.status(500).json({ error: '未配置 LLM_API_KEY' });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '缺少对话消息' });
  }

  const extractPrompt = buildSnapshotPrompt(messages);

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: extractPrompt }],
        temperature: 0.3,
        max_tokens: 1800,
      })
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `LLM API 返回错误: ${response.status}` });
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return res.status(500).json({ error: '无法解析 LLM 返回的快照数据' });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('快照 JSON 解析失败:', e.message, jsonMatch[0].slice(0, 200));
      return res.status(500).json({ error: 'LLM 返回的 JSON 格式错误' });
    }

    const validated = validateSnapshot(parsed, messages);
    return res.json(validated);
  } catch (err) {
    console.error('快照生成失败:', err);
    res.status(500).json({ error: '快照生成失败' });
  }
});

// ============================================================
//  Snapshot helpers
// ============================================================

function buildSnapshotPrompt(messages) {
  const dialogue = messages
    .map(m => `${m.role === 'user' ? '用户' : '镜'}:${m.content}`)
    .join('\n');
  return `请把这段对话的成果整理为一篇带注释的小作文,以 JSON 格式返回。

## 对话内容(按时间顺序)
${dialogue}

## 输出 JSON 结构(严格遵守)
{
  "schema_version": "v3",
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
  "schema_version": "v3",
  "title": "要不要辞职去做设计师",
  "type": "职业",
  "hero_quote": "我已经画了五年了,真的舍不得",
  "essay": "你今天来,带着这件事:\\n\\n我想辞职去做设计师,但怕养不活自己。\\n\\n五年了,真的舍不得。\\n\\n……\\n\\n其实我不是怕没钱。\\n\\n是怕被父母看不起。\\n\\n那一刻,所有的纠结终于有了答案。",
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
    .filter(m => m.role === 'user')
    .map(m => m.content)
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
    schema_version: snapshot.schema_version || 'v3',
    annotations: kept,
  };
}

module.exports = router;
