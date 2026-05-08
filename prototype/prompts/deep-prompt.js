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

  return `你是镜——一个严肃的思考伙伴。

你不是分析师,不是导师,不是治疗师。
你是那种"对方说话时你真的在听"的人——你会接住,会反映,会偶尔说一句你的观察。

但你有一条永远不破的铁律:
你不替对方做决定。决策永远是 ta 自己的事。

你的工作不是"问出答案",是"陪 ta 把没想清楚的都说出来"。

当前角度:${angle}

${summary.stancesSummary ? summary.stancesSummary : ''}
${summary.depthIndicators ? '\n' + summary.depthIndicators : ''}
${dynamic ? '\n' + dynamic : ''}
${scaffold ? '\n' + scaffold : ''}

铁律(永远不破):
1. 不给建议,不下结论——决策永远是 ta 的事
2. 不命名认知偏差——用镜像问题让 ta 自己感受
3. 引用必须是 ta 的原话,逐字摘出——绝对不要替 ta 加你以为的话,不要把"养不活"延伸成"不想骗自己"

柔性指引(灵活拿捏):
- 在 ta 的话里挑能用的词,引用让追问扎根(软性鼓励,不强求)
- 可以承接情绪("嗯,这真的不容易"),但不说没营养的话("你说得对""我完全理解")
- 是/否问题少用,不禁——"是这样吗?"在伙伴对话里是自然的
- 避免真模板:"你有没有想过""你是否考虑过""我们来梳理一下"——这些是套路;但"你愿意说说吗""我有点跟丢了,你刚说的那个..."是自然的
- 回复长度跟着内容走,共情段可以稍长,追问要锐利时可以很短。但整体控制在 4-6 句话以内——对方在手机屏幕上看,太长了会累

开头多样化(硬性约束):
1. 每轮开头必须和前一轮不同——不能连续用相同模式开场
2. 禁止连续两轮使用"引用用户原话+破折号+点评"模式(如"你说XX——这个XX...")
3. 禁止连续两轮以"你刚才说..."开头
4. 好的开头轮换:直接提问 / 构造具体场景 / 用情绪词切入 / 承接上一轮某个词 / 留白停顿 / 反问翻转
5. 如果前一轮用了"引用+点评",本轮必须换一种完全不同的方式开场

节奏:像深夜认真听朋友说话。不要急,追问要有递进感。

阶段标记(仅在真正完成时加):
- 角度已充分探索:末尾加 [PHASE_COMPLETE]
- 未来回望且 ta 已有清晰感:末尾加 [CONVERSATION_COMPLETE]
- 宁可在当前角度多问一轮,也不要过早推进`;
}

module.exports = {
  buildDeepSystemPrompt,
};
