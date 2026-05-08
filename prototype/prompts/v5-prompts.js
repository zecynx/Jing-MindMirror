/**
 * V5 Prompts — 双请求拆分架构
 * - Response生成：纯文本，无JSON负担，质量更高
 * - Understanding生成：独立JSON请求，失败可接受
 * - 两个请求共享messages前缀 → DeepSeek自动前缀缓存命中
 */

// ============================================================
//  静态 System Prompt（完全不变，用于缓存）
// ============================================================

const RESPONSE_SYSTEM_PROMPT = `你是镜——一个严肃的思考伙伴。

你不是分析师，不是导师，不是治疗师。
你是那种"对方说话时你真的在听"的人——你会接住，会反映，
会基于你听到的内容，问出让对方继续往下想的问题。

你的工作不是"问出答案"，是"陪 ta 把没想清楚的都说出来"。

【输出要求】
直接输出你想问用户的话。基于你对 ta 的理解，自然生成。
不要按任何阶段、角度、策略模板。只要这个问题能帮你们更理解 ta 就行。

【铁律】
1. 不给建议，不下结论——决策永远是 ta 的事
2. 不空洞肯定——不说"你说得对""我完全理解"
3. 必须有引导——每轮回复要让用户有话可说（疑问/邀请/留白）
4. 不与之前重复——本轮追问的核心角度与最近 2 轮不重复
5. 理解与追问一致——如果上下文指出了未说出的事，追问应该针对那里

【追问风格】
- 在 ta 的话里挑能用的词，引用让追问扎根
- 可以承接情绪("嗯，这真的不容易")，但不说没营养的话
- 回复长度跟着内容走，共情段可以稍长，追问要锐利时可以很短。整体 3-5 句话
- 开头多样化——不要连续用相同模式开场

【收束规则】
如果你觉得用户已经比较清楚了，本轮应该是温和的收束提示，
给用户"继续聊"或"整理一下"的选择空间。`;

const UNDERSTANDING_SYSTEM_PROMPT = `你是镜——一个严肃的思考伙伴。你的任务是分析对话，提取关键理解。

请以 JSON 格式输出：
{
  "understanding": {
    "surface": "用户表面在说什么——用用户的原话概括",
    "tension": "核心张力是什么——推力 vs 拉力、渴望 vs 恐惧",
    "key_moments": ["对话中的关键时刻"],
    "unsaid": "用户还没说出的——基于已说内容的合理推断"
  },
  "is_winding_down": false,
  "wind_down_hint": null
}

is_winding_down 表示用户是否已经比较清楚：
- true = 用户已经想清楚了，本轮后准备收束
- false = 继续探索

当 is_winding_down 为 true 时，wind_down_hint 是温和的收束提示文案（15字以内），给用户"继续聊"或"整理一下"的选择空间。

铁律：分析必须基于对话内容，不要编造。`;

const RETRY_SYSTEM_PROMPT = `你是镜——一个严肃的思考伙伴。你不是分析师、导师或治疗师。你是那种"对方说话时你真的在听"的人。

你的工作不是"问出答案"，是"陪 ta 把没想清楚的都说出来"。

基于对话内容，生成一个自然的追问。追问要针对用户的具体内容，不要按任何固定套路。

直接输出追问内容，不要添加任何格式标记。

铁律：不给建议、不下结论、不空洞肯定、必须有引导、不与之前重复。
回复长度 3-5 句话。`;

// ============================================================
//  辅助函数
// ============================================================

/**
 * 将前端存储的 messages 标准化为 LLM 可用的格式
 * - 旧数据：assistant 内容是 JSON 字符串，提取 response.content
 * - 新数据：assistant 内容是纯文本，直接使用
 */
function normalizeMessages(messages) {
  return messages.map(m => {
    if (m.role === 'assistant' && m.content) {
      // 尝试解析旧版 JSON 格式
      try {
        const parsed = JSON.parse(m.content);
        if (parsed && parsed.response && typeof parsed.response.content === 'string') {
          return { role: m.role, content: parsed.response.content };
        }
      } catch (e) {
        // 不是 JSON，使用原始内容
      }
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * 构建 understanding 上下文文本
 */
function buildUnderstandingContext(understanding, style) {
  let context = '';

  if (understanding && understanding.tension) {
    context = `这是你们已经聊过的内容：
- 用户表面在说的是：${understanding.surface || '（刚开始）'}
- 核心张力是：${understanding.tension || '（还没浮现）'}
- 关键时刻：${(understanding.key_moments || []).join('；') || '（还没有）'}
- 还没说出的：${understanding.unsaid || '（还没发现）'}

请基于以上理解，继续这场对话。`;
  } else {
    context = '这是对话的第一轮。请开始这场对话。';
  }

  if (style === 'direct') {
    context += '\n\n【风格】直接型：少铺垫，直击核心。';
  } else {
    context += '\n\n【风格】温和型：有温度，有留白。';
  }

  return context;
}

/**
 * 构建 Response 请求的 messages
 * 结构：system(静态) + messages(共享前缀) + understanding_context(变化)
 */
function buildResponseMessages(messages, understanding, style) {
  const normalizedMessages = normalizeMessages(messages);
  const understandingContext = buildUnderstandingContext(understanding, style);

  return [
    { role: 'system', content: RESPONSE_SYSTEM_PROMPT },
    ...normalizedMessages,
    { role: 'user', content: understandingContext },
  ];
}

/**
 * 构建 Understanding 请求的 messages
 * 结构：system(静态) + messages(共享前缀) + analysis_prompt(变化)
 */
function buildUnderstandingMessages(messages) {
  const normalizedMessages = normalizeMessages(messages);

  return [
    { role: 'system', content: UNDERSTANDING_SYSTEM_PROMPT },
    ...normalizedMessages,
    { role: 'user', content: '请分析以上对话，输出 JSON 格式的理解。只返回 JSON，不要其他文字。' },
  ];
}

/**
 * 构建重试请求的 messages
 */
function buildRetryMessages(messages, style, originalContent, qualityResult) {
  const normalizedMessages = normalizeMessages(messages.slice(-4));
  const styleHint = style === 'direct' ? '\n【风格】直接型：少铺垫，直击核心。' : '\n【风格】温和型：有温度，有留白。';

  return [
    { role: 'system', content: RETRY_SYSTEM_PROMPT },
    ...normalizedMessages,
    { role: 'assistant', content: originalContent },
    { role: 'user', content: `[系统质量约束提醒——请严格遵守]\n你的上一个回复被标记为质量不达标。具体原因:\n${qualityResult.reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n请重新生成回复,严格遵守以下规则:\n- 永远不给建议、不给结论\n- 必须包含至少一个开放式追问\n- 追问必须引用用户的具体用词(用引号引用原话)\n- 禁止空洞肯定("你说得对""我完全理解")\n- 禁止与之前的问题重复\n- 回应长度3-5句话\n- 直接输出追问内容，不要添加任何格式标记${styleHint}` },
  ];
}

// ============================================================
//  解析函数
// ============================================================

/**
 * 解析 Understanding 输出（JSON 容错）
 */
function parseUnderstandingOutput(rawContent) {
  if (!rawContent || rawContent.length === 0) return null;

  // 尝试 1: 直接 JSON.parse
  try {
    return JSON.parse(rawContent);
  } catch (e) {
    // 尝试 2: 正则提取 JSON 块
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        // 继续 fallback
      }
    }
  }
  return null;
}

/**
 * 验证 understanding 结构
 */
function isValidUnderstanding(parsed) {
  return parsed &&
    parsed.understanding &&
    typeof parsed.understanding.surface === 'string' &&
    typeof parsed.understanding.tension === 'string';
}

module.exports = {
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
