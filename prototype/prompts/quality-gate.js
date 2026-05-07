/**
 * 质量守门:LLM 回复后处理验证
 * 返回 { passed, reasons, score }
 *  - 触发重试的硬性规则:建议性表达、模板句式、元评论开头、缺少追问
 *  - 软性扣分:封闭式问题、空洞肯定、过长、缺少引用
 */

function responseQualityCheck(content, userLastMessage) {
  const reasons = [];
  let score = 100;

  // ── 规则1:建议/结论检测 ──
  const advicePatterns = [
    /你应该/g, /我建议/g, /最好/g, /推荐/g,
    /可以考虑/g, /建议你/g, /不妨试试/g, /你可以试着/g,
    /我认为你应该/g, /我的建议是/g,
  ];
  for (const pat of advicePatterns) {
    if (pat.test(content)) {
      reasons.push('包含建议性表达("你应该/我建议/最好/推荐"等),违反"永远不给建议"约束');
      score -= 30;
      break;
    }
  }

  // ── 规则2:封闭式问题检测 ──
  const closedPatterns = [
    /吗[??]/g, /吧[??]/g, /是不是/g, /对不对/g, /有没有/g,
    /会不会/g, /能不能/g, /是不是/g,
  ];
  let closedCount = 0;
  for (const pat of closedPatterns) {
    const matches = content.match(pat);
    if (matches) closedCount += matches.length;
  }
  if (closedCount >= 2) {
    reasons.push(`包含${closedCount}个封闭式问题("吗?/吧?/是不是"等),应使用开放式追问`);
    score -= 20;
  }

  // ── 规则3:模板化检测 ──
  const templatePatterns = [
    /你有没有想过/g, /你是否考虑过/g, /你考虑过.*吗/g,
    /你觉得呢/g, /你怎么看/g,
    /从另一个角度看/g, /换位思考一下/g,
    /我们来梳理一下/g, /让我们想想/g,
  ];
  for (const pat of templatePatterns) {
    if (pat.test(content)) {
      reasons.push('使用了禁止句式("你有没有想过/你是否考虑过/你觉得呢"等模板化表达)');
      score -= 25;
      break;
    }
  }

  // ── 规则4:空洞肯定检测 ──
  const emptyPraisePatterns = [
    /这是一个好问题/g, /你说得对/g, /我理解你的感受/g, /我完全理解/g,
    /很好的思考/g, /很有道理/g,
  ];
  for (const pat of emptyPraisePatterns) {
    if (pat.test(content)) {
      reasons.push('包含空洞肯定("你说得对/我理解你的感受/这是一个好问题"),违反"禁止空洞肯定"约束');
      score -= 20;
      break;
    }
  }

  // ── 规则5:追问存在性检查 ──
  const hasQuestion = /[??]/.test(content);
  if (!hasQuestion) {
    reasons.push('回复中没有包含任何问号,缺少追问');
    score -= 30;
  }

  // ── 规则6:引用用户原话检查(软性) ──
  if (userLastMessage && userLastMessage.length > 5) {
    const hasQuote = /[""「」『』]/.test(content) ||
      content.includes(`"${userLastMessage.substring(0, 10)}`) ||
      content.includes(`"${userLastMessage.substring(0, 10)}`);
    if (!hasQuote) {
      score -= 5;
    }
  }

  // ── 规则7:元评论开头检测(硬性) ──
  const metaCommentPatterns = [
    /你用了/g, /你说/g, /你提到/g, /你用了.*这个句式/g,
    /你选择了/g, /你表达了/g, /你用了.*这个词/g,
  ];
  let metaCount = 0;
  for (const pat of metaCommentPatterns) {
    const matches = content.match(pat);
    if (matches) metaCount += matches.length;
  }
  if (metaCount >= 1 && /^你[用说提选表]/.test(content)) {
    reasons.push('以"你用了/你说/你提到"等元评论开头,违反"直接追问内容本身"约束');
    score -= 50;
  }

  // ── 规则8:长度合理性 ──
  const sentenceCount = content.split(/[。!?!?]/).filter(s => s.trim()).length;
  if (sentenceCount > 8) {
    reasons.push('回复过长(超过8句话),应控制在2-4句话');
    score -= 15;
  }

  score = Math.max(0, score);
  const passed = score >= 60;

  return { passed, reasons, score };
}

module.exports = {
  responseQualityCheck,
};
