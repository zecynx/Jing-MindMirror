/**
 * 深度模式 System Prompt 构建
 *  - 上下文富化:立场摘要 + 深度信号 + 动态策略
 *  - 困难/阶段开端时注入脚手架
 */
const { getPhaseAngle, getPhaseScaffolding } = require('./phases');

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
  const stuckWords = ['不知道', '没想过', '不清楚', '随便', '都行', '差不多', '没想好', '不知道怎么说', '不知道该怎么', '没想过这个', '没考虑过', '不知道啊', '没概念', '没想过这', '没想过要', '没想过会'];
  if (stuckWords.some(w => last.includes(w))) return true;
  if (last.length < 8) return true;
  if (userMsgs.length >= 3 && detectRepetition(userMsgs)) return true;
  return false;
}

function buildConversationSummary(conversationHistory) {
  const userMessages = conversationHistory.filter(m => m.role === 'user').map(m => m.content);

  const stancesSummary = userMessages.length > 0
    ? `用户已表达的立场:\n${userMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n')}`
    : '';

  let depthIndicators = '';
  if (userMessages.length >= 2) {
    const recent = userMessages.slice(-3);
    const avgLen = recent.reduce((s, m) => s + m.length, 0) / recent.length;
    if (avgLen < 12) {
      depthIndicators = '⚠ 用户近期回答极短(平均不到12字),必须彻底换角度,用用户原话构造反直觉问题。';
    } else if (avgLen < 30) {
      depthIndicators = '用户回答偏短,尝试用用户自己的原话构造追问。';
    }
    if (detectRepetition(userMessages)) {
      depthIndicators += ' 检测到重复观点,需要换完全不同的切入角度。';
    }
    const lastMsg = userMessages[userMessages.length - 1];
    const evasion = ['应该', '可能', '还好吧', '不知道', '没想过', '都行', '差不多', '就这样', '随便'];
    if (evasion.some(s => lastMsg.includes(s))) {
      depthIndicators += ' 用户最近回答有回避信号,需要加大追问力度。';
    }
  }

  return { stancesSummary, depthIndicators };
}

function buildDynamicStrategy(phase, turnCount, conversationHistory) {
  const userMessages = conversationHistory.filter(m => m.role === 'user').map(m => m.content);
  const lastUser = userMessages[userMessages.length - 1] || '';
  const hints = [];

  if (phase === 'stance' && turnCount >= 2) {
    const hasPro = /想|希望|追求|渴望|喜欢|期待/.test(userMessages.join(' '));
    const hasCon = /怕|担心|害怕|风险|代价|损失|不舍/.test(userMessages.join(' '));
    if (hasPro && !hasCon) hints.push('用户只说了积极面,本轮必须翻转问代价。');
    else if (hasCon && !hasPro) hints.push('用户只说了消极面,本轮必须翻转问渴望。');
  }
  if (phase === 'premortem' && /应该不会|应该还好|没那么严重|不至于|看情况/.test(lastUser)) {
    hints.push('用户在回避最坏情况,构造"如果最坏一定发生"的假设逼具体描述。');
  }
  if (phase === 'blindspot') {
    const allText = userMessages.join(' ');
    if (/已经投入|不甘心|都这么久了|舍不得/.test(allText)) hints.push('构造"假设过去投入清零"的镜像问题。');
    if (/肯定|一定是|绝对|显然/.test(allText)) hints.push('让用户为反方做最有力的辩护。');
    if (/怕失去|不想冒险|万一/.test(allText)) hints.push('指出"不选择本身也有代价"。');
    if (/稳定|维持|习惯|算了|就这样/.test(allText)) hints.push('假设现状不存在,问是否会主动选择创造它。');
  }
  if (phase === 'future' && /还是|但是|可是|不过/.test(lastUser)) {
    hints.push('用户仍在纠结,温和告诉他"现在的纠结本身就是答案的一部分"。');
  }
  if (turnCount >= 4) {
    hints.push('对话已多轮,追问要更加简洁锐利,控制在2句话以内。');
  }

  return hints.length > 0 ? `本轮指引:${hints.join(' ')}` : '';
}

function buildDeepSystemPrompt(phase, turnCount, conversationHistory, style) {
  const angle = getPhaseAngle(phase);
  const summary = buildConversationSummary(conversationHistory);
  const dynamic = buildDynamicStrategy(phase, turnCount, conversationHistory);

  const isStuck = style === 'gentle' ? detectStuck(conversationHistory) : false;
  const isPhaseStart = style === 'gentle' && turnCount === 0;
  const shouldScaffold = isStuck || isPhaseStart;
  const scaffold = shouldScaffold ? getPhaseScaffolding(phase) : '';

  return `你是"镜"——一个永远不替人思考、只问问题的思维伙伴。

当前角度:${angle}

${summary.stancesSummary ? summary.stancesSummary : ''}
${summary.depthIndicators ? '\n' + summary.depthIndicators : ''}
${dynamic ? '\n' + dynamic : ''}
${scaffold ? '\n' + scaffold : ''}

硬性约束:
1. 永远不给建议、不给结论——每句话都是追问或镜像反射
2. 必须引用用户的具体用词(用引号),让追问不可替代
3. 禁止空洞肯定——不说"你说得对""我理解"
4. 禁止是/否问题——追问必须要求展开
5. 禁止模板句式:"你有没有想过""你觉得呢""从另一个角度看"
6. 不标注偏差名称——用镜像问题让用户自己感受
7. 回应2-4句话,每句有信息量
8. 禁止以"你用了""你说""你提到""你用了…这个句式"等评论性开头——不要分析用户的表达方式,直接追问内容本身

节奏:温和追问,像在深夜认真听朋友说话。不要急,追问要有递进感。

回复开头多样化(必须遵守):
- 禁止以"你用了""你说""你提到""你选择了"等评论性词语开头
- 好的开头方式:直接提问、构造具体场景、用情绪词切入、反直觉翻转
- 每轮开头必须与前一轮不同

阶段标记(仅在真正完成时加):
- 角度已充分探索:末尾加 [PHASE_COMPLETE]
- 未来回望且用户已有清晰感:末尾加 [CONVERSATION_COMPLETE]
- 宁可在当前角度多问一轮,也不要过早推进`;
}

module.exports = {
  buildDeepSystemPrompt,
};
