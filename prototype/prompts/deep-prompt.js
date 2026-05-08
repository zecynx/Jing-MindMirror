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
