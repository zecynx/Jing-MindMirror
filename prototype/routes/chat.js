/**
 * /api/chat   — LLM 对话代理(含质量守门 + 重试)
 * /api/snapshot — 决策快照生成
 */
const express = require('express');
const db = require('../db');
const requireUserId = require('../middleware/require-user');
const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = require('../llm-config');
const { buildDeepSystemPrompt } = require('../prompts/deep-prompt');
const { getPhaseTemperature } = require('../prompts/phases');
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
        temperature: getPhaseTemperature(phase || 'define'),
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

    // ── 质量不达标 → 约束重试(最多1次) ──
    if (!qualityResult.passed && qualityResult.reasons.length > 0) {
      console.log(`[Quality Gate] 首次未通过 (score=${qualityResult.score}): ${qualityResult.reasons.join('; ')}`);

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

  const extractPrompt = `请从以下对话中提取决策快照信息,以 JSON 格式返回。不要包含任何其他文字。

对话内容:
${messages.map(m => `${m.role === 'user' ? '用户' : '棱镜'}:${m.content}`).join('\n')}

请返回如下 JSON:
{
  "title": "决策的简短标题(15字以内,用第二人称口吻,比如'要不要辞职去创业',不要写成'用户在纠结...')",
  "type": "职业/关系/城市/投资/教育/人生",
  "hero_quote": "用户在整段对话里说过最有分量、最能代表他真实想法的一句原话——必须直接从用户的发言里摘出来,不要改写。如果有多句备选,选最锐利、最有情绪、最戳到核心的那句。25-60字最佳。",
  "stances": "用户的核心立场摘要(2-3句话,第二人称'你')",
  "premortem_change": "选择改变后的灾难预判(1-2句话,第二人称)",
  "premortem_stay": "选择不变后的灾难预判(1-2句话,第二人称)",
  "blindspots": "识别到的认知盲区(1-2句话,第二人称)",
  "future_perspective": "10年后的视角(1-2句话,第二人称)",
  "confidence": 7
}`;

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
        max_tokens: 700,
      })
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `LLM API 返回错误: ${response.status}` });
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return res.json(parsed);
    }

    return res.status(500).json({ error: '无法解析 LLM 返回的快照数据' });
  } catch (err) {
    console.error('快照生成失败:', err);
    res.status(500).json({ error: '快照生成失败' });
  }
});

module.exports = router;
