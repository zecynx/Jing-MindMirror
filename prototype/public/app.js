// 镜·MindLens — 主前端逻辑
// 从 index.html 抽出。后续上 Vue/Vite 时改为入口模块
// ============================================================
//  配置 + 工具
// ============================================================
const USER_ID_KEY = 'prism_user_id';
const JOURNAL_KEY = 'prism_journal';
const API_BASE = window.__API_BASE__ || '';

function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 11);
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}
const USER_ID = getUserId();

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': USER_ID,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '未知错误' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function nl2br(s) {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// 解析 AI 回复:拆分主追问和脚手架引导
function parseScaffold(content) {
  const match = content.match(/\[SCAFFOLD\]([\s\S]*?)\[\/SCAFFOLD\]/i);
  if (!match) return { main: content.trim(), scaffold: null };
  const scaffold = match[1].trim();
  const main = content.replace(/\[SCAFFOLD\][\s\S]*?\[\/SCAFFOLD\]/i, '').trim();
  return { main, scaffold };
}

let pendingScaffoldTimeout = null;

function showScaffold(text) {
  const card = $('scaffoldCard');
  const content = $('scaffoldContent');
  content.innerHTML = nl2br(text);
  card.classList.remove('expanded');
  card.classList.add('show');
}

function scheduleScaffold(text, delayMs = 3000) {
  cancelPendingScaffold();
  pendingScaffoldTimeout = setTimeout(() => {
    showScaffold(text);
    pendingScaffoldTimeout = null;
  }, delayMs);
}

function cancelPendingScaffold() {
  if (pendingScaffoldTimeout) {
    clearTimeout(pendingScaffoldTimeout);
    pendingScaffoldTimeout = null;
  }
}

function hideScaffold() {
  cancelPendingScaffold();
  const card = $('scaffoldCard');
  card.classList.remove('show', 'expanded');
}

// ============================================================
//  埋点
// ============================================================
function trackEvent(type, data = {}) {
  apiFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify({ type, conversationId: state.conversationId, data }),
  }).catch(() => {});
}

// ============================================================
//  健康检查
// ============================================================
let serverReady = false;
async function checkServerHealth() {
  try {
    const res = await apiFetch('/api/health');
    serverReady = res.llm === 'configured';
    if (!serverReady) {
      $('homeWarning').classList.add('show');
    }
    return res;
  } catch (e) {
    serverReady = false;
    $('homeWarning').textContent = '服务器未连接,请确认后端已启动';
    $('homeWarning').classList.add('show');
    return null;
  }
}

// ============================================================
//  阶段配置
// ============================================================
const PHASES = [
  { id: 'define',    label: '定义',    minTurns: 1, maxTurns: 3 },
  { id: 'stance',    label: '立场',    minTurns: 3, maxTurns: 6 },
  { id: 'premortem', label: '复盘',    minTurns: 3, maxTurns: 5 },
  { id: 'blindspot', label: '盲区',    minTurns: 3, maxTurns: 6 },
  { id: 'future',    label: '回望',    minTurns: 1, maxTurns: 3 },
];
const TOTAL_PHASES = PHASES.length;

// ============================================================
//  状态
// ============================================================
let state = createInitialState();

function createInitialState() {
  return {
    currentPhase: 'define',
    phaseTurnCount: 0,
    totalTurnCount: 0,
    messages: [],          // for LLM
    displayHistory: [],    // for 回看 overlay: {role, text}
    isAiTyping: false,
    typing: false,
    interrupted: false,
    conversationComplete: false,
    conversationId: null,
    phaseStartTime: Date.now(),
    recentUserLengths: [],
    snapshotData: null,
    style: localStorage.getItem('prism_show_hints') === '0' ? 'direct' : 'gentle',
  };
}

function getPhaseConfig() {
  return PHASES.find(p => p.id === state.currentPhase) || PHASES[0];
}
function getPhaseIndex() {
  return PHASES.findIndex(p => p.id === state.currentPhase);
}

// ============================================================
//  屏幕切换
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}
function goHome() {
  // 关闭 overlay
  $('historyOverlay').classList.remove('active');
  hideScaffold();
  showScreen('screen-home');
  // 重置输入框
  $('homeInput').value = '';
  $('homeBtn').classList.remove('ready');
  setTimeout(() => $('homeInput').focus(), 300);
}

// ============================================================
//  起始屏交互
// ============================================================
$('homeInput').addEventListener('input', () => {
  const has = $('homeInput').value.trim().length > 0;
  $('homeBtn').classList.toggle('ready', has);
});
$('homeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && $('homeBtn').classList.contains('ready')) {
    e.preventDefault();
    startConversation();
  }
});
$('homeBtn').addEventListener('click', startConversation);

// 显示提示开关
$('hintToggle').addEventListener('click', () => {
  const btn = $('hintToggle');
  const isOn = btn.classList.toggle('on');
  btn.dataset.on = isOn ? 'true' : 'false';
  localStorage.setItem('prism_show_hints', isOn ? '1' : '0');
});

async function startConversation() {
  if (!serverReady) {
    $('homeWarning').classList.add('show');
    return;
  }
  const decision = $('homeInput').value.trim();
  if (!decision) return;

  // 重置状态
  state = createInitialState();
  state.messages.push({ role: 'user', content: decision });
  state.displayHistory.push({ role: 'user', text: decision });
  state.recentUserLengths.push(decision.length);

  // 清理 UI
  $('questionText').textContent = '';
  $('questionText').style.opacity = '1';
  $('replyInput').value = '';
  $('replyInput').style.height = 'auto';
  $('inputBar').style.display = '';
  $('historyToggle').style.opacity = '';
  $('completionBar').classList.remove('show');
  hideScaffold();
  updateBadge(true);

  showScreen('screen-dialogue');
  trackEvent('conversation_start', { decisionPreview: decision.slice(0, 50) });

  // 先停顿一下,让屏幕过渡完成
  await sleep(700);
  // 显示 thinking
  await showThinking();
  // 拿到第一个问题
  try {
    const result = await callLLM();
    const { main, scaffold } = parseScaffold(result.content);
    state.messages.push({ role: 'assistant', content: result.content });
    state.displayHistory.push({ role: 'ai', text: main });
    state.totalTurnCount++;
    state.phaseTurnCount++;
    await typeQuestion(main);
    if (scaffold) scheduleScaffold(scaffold);
    enableInput();
  } catch (err) {
    showError(err.message || '请求失败');
  }
}

// ============================================================
//  LLM 调用
// ============================================================
async function callLLM() {
  return apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: state.messages,
      phase: state.currentPhase,
      turnCount: state.phaseTurnCount,
      conversationId: state.conversationId,
      style: state.style,
    }),
  });
}

// ============================================================
//  打字机 / thinking / error
// ============================================================
async function typeQuestion(text) {
  state.typing = true;
  state.interrupted = false;
  $('questionText').classList.remove('thinking', 'error');
  $('questionText').textContent = '';
  $('questionText').style.opacity = '1';

  const caret = document.createElement('span');
  caret.className = 'caret';
  $('questionText').appendChild(caret);

  for (let i = 0; i < text.length; i++) {
    if (state.interrupted) {
      // 被中断时:清空内容,不渲染markdown,直接退出
      $('questionText').textContent = '';
      break;
    }
    const ch = text[i];
    caret.insertAdjacentText('beforebegin', ch);
    let delay = 28;
    if (ch === '\n') delay = 220;
    else if (ch === '。' || ch === '？' || ch === '?' || ch === '!') delay = 150;
    else if (ch === '，' || ch === '、' || ch === ',') delay = 80;
    else if (ch === '——' || ch === '—') delay = 140;
    await sleep(delay);
  }
  if (!state.interrupted) {
    await sleep(250);
    if (caret.parentNode) caret.remove();
    $('questionText').innerHTML = renderMarkdown(text);
  } else {
    // 被中断:只清理caret,内容已在循环中清空
    if (caret.parentNode) caret.remove();
  }
  state.typing = false;
}

async function fadeOutQuestion() {
  $('questionText').style.opacity = '0';
  await sleep(360);
}

async function showThinking() {
  await fadeOutQuestion();
  const el = $('questionText');
  el.classList.remove('error');
  el.classList.add('thinking');
  el.textContent = '镜在想…';
  el.style.opacity = '1';
  // thinking 期间允许在结束后被外部主动 fade out
}

async function hideThinking() {
  $('questionText').style.opacity = '0';
  await sleep(280);
  $('questionText').classList.remove('thinking');
}

function showError(msg) {
  const el = $('questionText');
  el.classList.remove('thinking');
  el.classList.add('error');
  el.style.opacity = '1';
  el.textContent = '⚠ ' + msg + '\n\n点左上角 ← 回到首页重试';
  state.isAiTyping = false;
}

// ============================================================
//  阶段过渡:光带下落 + 角标 morph
// ============================================================
function updateBadge(noAnim = false) {
  const phase = getPhaseConfig();
  const idx = getPhaseIndex() + 1;
  const html = `${phase.label} <span class="num">${idx} / ${TOTAL_PHASES}</span>`;
  if (noAnim) {
    $('phaseBadge').innerHTML = html;
    return;
  }
  $('phaseBadge').classList.add('morphing');
  setTimeout(() => {
    $('phaseBadge').innerHTML = html;
    $('phaseBadge').classList.remove('morphing');
  }, 300);
}

async function transitionPhase() {
  // 推进 state.currentPhase
  const idx = getPhaseIndex();
  if (idx < PHASES.length - 1) {
    state.currentPhase = PHASES[idx + 1].id;
  }
  state.phaseTurnCount = 0;
  state.phaseStartTime = Date.now();
  state.recentUserLengths = [];

  trackEvent('phase_advance', {
    to: state.currentPhase,
    phaseIdx: idx + 2,
  });

  // 1. 光带从顶部下落
  $('lightBeam').classList.remove('falling');
  void $('lightBeam').offsetWidth;
  $('lightBeam').classList.add('falling');

  // 2. 中途 morph 角标
  await sleep(500);
  updateBadge();

  // 3. 等光带落完
  await sleep(700);
}

// ============================================================
//  输入处理
// ============================================================
function enableInput() {
  $('replyInput').disabled = false;
  $('replyInput').focus();
  updateReplyBtn();
}
function disableInput() {
  $('replyInput').disabled = true;
  $('replyBtn').disabled = true;
  $('replyBtn').classList.remove('ready');
}
function updateReplyBtn() {
  const has = $('replyInput').value.trim().length > 0;
  $('replyBtn').disabled = !has;
  $('replyBtn').classList.toggle('ready', has);
}

$('replyInput').addEventListener('input', () => {
  updateReplyBtn();
  $('replyInput').style.height = 'auto';
  $('replyInput').style.height = Math.min($('replyInput').scrollHeight, 120) + 'px';
  if (state.typing) state.interrupted = true;
});
$('replyInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !$('replyBtn').disabled) {
    e.preventDefault();
    submitReply();
  }
});
$('replyBtn').addEventListener('click', submitReply);

// 脚手架卡片展开/收起
$('scaffoldToggle').addEventListener('click', () => {
  $('scaffoldCard').classList.toggle('expanded');
});

async function submitReply() {
  const text = $('replyInput').value.trim();
  if (!text || state.isAiTyping || state.conversationComplete) return;

  // 中断上一轮打字机(如果有)
  if (state.typing) {
    state.interrupted = true;
    // 等待上一轮打字机彻底结束,避免DOM竞争
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
  state.totalTurnCount++;
  state.phaseTurnCount++;

  await hideThinking();

  // 阶段推进判断
  const phaseConfig = getPhaseConfig();
  const reachedMin = state.phaseTurnCount >= phaseConfig.minTurns;
  const reachedMax = state.phaseTurnCount >= phaseConfig.maxTurns;
  const isTransitional = state.currentPhase === 'define' || state.currentPhase === 'future';

  const recentLen = state.recentUserLengths.slice(-3);
  const avgLen = recentLen.length > 0
    ? recentLen.reduce((a, b) => a + b, 0) / recentLen.length
    : 0;
  const shallowCount = recentLen.filter(l => l < 10).length;
  const isShallowEngagement = avgLen < 15 && shallowCount >= 2;
  const phaseDuration = (Date.now() - state.phaseStartTime) / 1000;
  const isTooFast = phaseDuration < 30 && reachedMin;

  // 决定下一步
  const isLastPhase = state.currentPhase === 'future';
  const shouldComplete = result.conversationComplete || (isLastPhase && reachedMin);
  const shouldAdvance = !shouldComplete && (
    reachedMax ||
    (isTransitional && reachedMin) ||
    (reachedMin && result.phaseComplete && !isShallowEngagement && !isTooFast)
  );

  // 先 type 出 AI 的主追问
  await typeQuestion(main);

  if (shouldComplete) {
    state.conversationComplete = true;
    state.isAiTyping = false;
    // 隐藏输入条,等用户读完最后这句话再点"看快照"
    $('inputBar').style.display = 'none';
    $('historyToggle').style.opacity = '0.4';
    // 给读最后一句话的时间,然后慢慢显出 CTA
    await sleep(1500);
    $('completionBar').classList.add('show');
    return;
  }

  if (shouldAdvance) {
    await sleep(800);
    await transitionPhase();
    // 不主动触发新阶段第一问 —— AI 的过渡语已经搭好桥,等用户回应即可
    await sleep(300);
    state.isAiTyping = false;
    enableInput();
    return;
  }

  // 不推进,继续当前阶段 —— 让用户先读完追问,3 秒后脚手架淡淡浮现
  if (scaffold) scheduleScaffold(scaffold);
  state.isAiTyping = false;
  enableInput();
}

// ============================================================
//  历史回看
// ============================================================
function renderHistory() {
  const list = $('historyList');
  if (state.displayHistory.length === 0) {
    list.innerHTML = '<li class="history-empty">还没有对话</li>';
    return;
  }
  list.innerHTML = state.displayHistory.map(item => {
    const role = item.role === 'ai' ? '镜' : '你';
    const cls = item.role === 'ai' ? '' : 'user';
    return `<li class="history-item">
      <span class="history-role ${cls}">${role}</span>
      <div class="history-text ${cls}">${nl2br(item.text)}</div>
    </li>`;
  }).join('');
}
$('historyToggle').addEventListener('click', () => {
  renderHistory();
  $('historyOverlay').classList.add('active');
});
$('historyClose').addEventListener('click', () => {
  $('historyOverlay').classList.remove('active');
});

$('viewSnapshotBtn').addEventListener('click', async () => {
  $('completionBar').classList.remove('show');
  await sleep(400);
  await generateSnapshot();
});

// 上滑手势
let touchStartY = 0;
document.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!$('screen-dialogue').classList.contains('active')) return;
  if ($('historyOverlay').classList.contains('active')) return;
  const dy = touchStartY - e.changedTouches[0].clientY;
  if (dy > 60) {
    renderHistory();
    $('historyOverlay').classList.add('active');
  }
}, { passive: true });

// ============================================================
//  决策快照
// ============================================================
async function generateSnapshot() {
  trackEvent('snapshot_generate', { totalTurns: state.totalTurnCount });

  // 切换到 snapshot 屏先放一个 loading
  $('snapshotContent').innerHTML = `
    <div class="snapshot-section" style="text-align:center;padding-top:80px;">
      <div class="snapshot-eyebrow">正在整理你的思考</div>
      <div class="snapshot-body muted" style="margin-top:16px;animation:thinking 1.4s ease-in-out infinite;">镜在写下你今天说过的话…</div>
    </div>
  `;
  showScreen('screen-snapshot');

  let data = null;
  try {
    data = await apiFetch('/api/snapshot', {
      method: 'POST',
      body: JSON.stringify({ messages: state.messages }),
    });
  } catch (e) {
    console.error('快照生成失败,使用备用方案', e);
    data = buildSnapshotFallback();
  }

  state.snapshotData = data;
  renderSnapshot(data);
}

function buildSnapshotFallback() {
  const userMsgs = state.messages.filter(m => m.role === 'user').map(m => m.content);
  // 选最长的用户消息作为 hero quote 兜底
  const heroQuote = userMsgs.length > 1
    ? userMsgs.slice(1).reduce((longest, m) => m.length > longest.length ? m : longest, '')
    : '';
  return {
    title: userMsgs[0] ? userMsgs[0].slice(0, 30) : '我的决策',
    type: '人生',
    hero_quote: heroQuote,
    stances: userMsgs.slice(1, 3).join('\n') || '见对话记录',
    premortem_change: '见对话记录',
    premortem_stay: '见对话记录',
    blindspots: '见对话记录',
    future_perspective: userMsgs[userMsgs.length - 1] || '见对话记录',
    confidence: 7,
  };
}

function renderSnapshot(data) {
  const now = new Date();
  const calDate = new Date();
  calDate.setMonth(calDate.getMonth() + 3);
  const calDateStr = `${calDate.getFullYear()} 年 ${calDate.getMonth() + 1} 月 ${calDate.getDate()} 日`;
  const confidence = clampConfidence(data.confidence);

  // 写入日志(仅在新生成时)
  if (!state.snapshotFromJournal) {
    const journalEntry = {
      id: Date.now(),
      title: data.title,
      type: data.type,
      hero_quote: data.hero_quote,
      // V3 字段
      essay: data.essay || '',
      annotations: data.annotations || [],
      schema_version: data.schema_version || 'v2',
      // 旧版兼容字段(仍保留,旧数据能读)
      stances: data.stances || '',
      premortem_change: data.premortem_change || '',
      premortem_stay: data.premortem_stay || '',
      blindspots: data.blindspots || '',
      future_perspective: data.future_perspective || '',
      confidence,
      createdAt: now.toISOString(),
      calibrationDate: calDate.toISOString(),
      messages: state.messages.slice(),
    };
    addJournalEntry(journalEntry);
    trackEvent('conversation_complete', {
      confidence,
      title: data.title,
      type: data.type,
      totalTurns: state.totalTurnCount,
    });
  }

  $('snapshotContent').innerHTML = renderSnapshotHtml(data, calDateStr, confidence, false);

  // 信心点逐个亮起
  setTimeout(() => animateConfidence(confidence), 280);
}

function clampConfidence(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return 7;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function confidenceMeaning(c) {
  if (c <= 2) return '还很迷茫';
  if (c <= 4) return '有了方向，但心里没底';
  if (c <= 6) return '隐隐知道想怎么选';
  if (c <= 8) return '想清了大半';
  return '心里非常笃定';
}

function animateConfidence(target) {
  const dots = document.querySelectorAll('.confidence-dot');
  dots.forEach((d, i) => {
    setTimeout(() => {
      if (i < target) d.classList.add('filled');
    }, i * 90);
  });
  // 数字滚动
  const numEl = document.querySelector('.confidence-num .num-target');
  if (numEl) {
    let cur = 0;
    const tick = setInterval(() => {
      cur++;
      numEl.textContent = cur;
      if (cur >= target) clearInterval(tick);
    }, 90);
  }
}

function renderSnapshotHtml(data, calDateStr, confidence, isHistorical) {
  const isV3 = data.schema_version === 'v3' || (data.essay && data.annotations);
  return isV3
    ? renderV3SnapshotHtml(data, calDateStr, confidence, isHistorical)
    : renderV2SnapshotHtml(data, calDateStr, confidence, isHistorical);
}

function renderV2SnapshotHtml(data, calDateStr, confidence, isHistorical) {
  const dotsHtml = Array.from({ length: 10 }, (_, i) =>
    `<div class="confidence-dot${isHistorical && i < confidence ? ' filled' : ''}"></div>`
  ).join('');

  const heroQuoteSection = data.hero_quote ? `
    <div class="snapshot-section">
      <div class="snapshot-eyebrow">你 说 出 来 最 重 的 那 句</div>
      <div class="snapshot-quote-block">
        <div class="snapshot-quote-mark">“</div>
        <div class="snapshot-quote">${escapeHtml(data.hero_quote)}</div>
        <div class="snapshot-quote-end">”</div>
      </div>
    </div>
  ` : '';

  return `
    <div class="snapshot-section">
      <div class="snapshot-eyebrow-row">
        <div class="snapshot-eyebrow">你 今 天 纠 结 的 是</div>
        ${data.type ? `<div class="snapshot-tag">${escapeHtml(data.type)}</div>` : ''}
      </div>
      <div class="snapshot-body title">${escapeHtml(data.title || '我的决策')}</div>
    </div>

    ${heroQuoteSection}

    <div class="snapshot-section">
      <div class="snapshot-eyebrow">你 的 核 心 立 场</div>
      <div class="snapshot-body">${nl2br(data.stances || '')}</div>
    </div>

    <div class="snapshot-section">
      <div class="snapshot-eyebrow">假  使  失  败</div>
      <div class="snapshot-premortem-row">
        <span class="snapshot-premortem-tag">→ 改 变 的 代 价</span>
        <div class="snapshot-body">${nl2br(data.premortem_change || '')}</div>
      </div>
      <div class="snapshot-premortem-row">
        <span class="snapshot-premortem-tag">→ 不 变 的 代 价</span>
        <div class="snapshot-body">${nl2br(data.premortem_stay || '')}</div>
      </div>
    </div>

    <div class="snapshot-section">
      <div class="snapshot-eyebrow">你 没 看 见 的</div>
      <div class="snapshot-body">${nl2br(data.blindspots || '')}</div>
    </div>

    <div class="snapshot-section">
      <div class="snapshot-eyebrow">10  年  后  的  你</div>
      <div class="snapshot-body">${nl2br(data.future_perspective || '')}</div>
    </div>

    <div class="snapshot-section">
      <div class="snapshot-eyebrow">你 今 天 的 信 心</div>
      <div class="confidence-block">
        <div class="confidence-dots">${dotsHtml}</div>
        <div class="confidence-row">
          <div class="confidence-num"><span class="num-target">${isHistorical ? confidence : 0}</span><small> / 10</small></div>
          <div class="confidence-meaning">${confidenceMeaning(confidence)}</div>
        </div>
      </div>
    </div>

    <div class="calibration-block">
      <div class="calibration-eyebrow">校 准 提 醒</div>
      <div class="calibration-body">把这些放在心里。<br>3 个月后再回来，<br>看看那时候你怎么想。</div>
      <div class="calibration-date">${calDateStr}</div>
    </div>

    <div class="snapshot-actions">
      <button class="end-btn" onclick="showJournal()">看历史</button>
      <button class="end-btn primary" onclick="goHome()">完  成</button>
    </div>
  `;
}

// ============================================================
//  V3 Snapshot: annotated essay
// ============================================================

function renderV3SnapshotHtml(data, calDateStr, confidence, isHistorical) {
  const dotsHtml = Array.from({ length: 10 }, (_, i) =>
    `<div class="confidence-dot${isHistorical && i < confidence ? ' filled' : ''}"></div>`
  ).join('');

  const heroQuoteSection = data.hero_quote ? `
    <div class="snapshot-section">
      <div class="snapshot-eyebrow">你 说 出 来 最 重 的 那 句</div>
      <div class="snapshot-quote-block">
        <div class="snapshot-quote-mark">"</div>
        <div class="snapshot-quote">${escapeHtml(data.hero_quote)}</div>
        <div class="snapshot-quote-end">"</div>
      </div>
    </div>
  ` : '';

  const essayHtml = renderAnnotatedEssay(data.essay, data.annotations);

  return `
    <div class="snapshot-section">
      <div class="snapshot-eyebrow-row">
        <div class="snapshot-eyebrow">你 今 天 纠 结 的 是</div>
        ${data.type ? `<div class="snapshot-tag">${escapeHtml(data.type)}</div>` : ''}
      </div>
      <div class="snapshot-body title">${escapeHtml(data.title || '我的决策')}</div>
    </div>

    ${heroQuoteSection}

    <div class="snapshot-section">
      <div class="snapshot-eyebrow">今 天 的 对 话</div>
      <div class="snapshot-essay">${essayHtml}</div>
    </div>

    <div class="snapshot-section">
      <div class="snapshot-eyebrow">你 今 天 的 信 心</div>
      <div class="confidence-block">
        <div class="confidence-dots">${dotsHtml}</div>
        <div class="confidence-row">
          <div class="confidence-num"><span class="num-target">${isHistorical ? confidence : 0}</span><small> / 10</small></div>
          <div class="confidence-meaning">${confidenceMeaning(confidence)}</div>
        </div>
      </div>
    </div>

    <div class="calibration-block">
      <div class="calibration-eyebrow">校 准 提 醒</div>
      <div class="calibration-body">把这些放在心里。<br>3 个月后再回来，<br>看看那时候你怎么想。</div>
      <div class="calibration-date">${calDateStr}</div>
    </div>

    <div class="snapshot-actions">
      <button class="end-btn" onclick="showJournal()">看历史</button>
      <button class="end-btn primary" onclick="goHome()">完  成</button>
    </div>
  `;
}

function renderAnnotatedEssay(essay, annotations) {
  if (!essay) return '';
  if (!annotations || annotations.length === 0) {
    return nl2br(essay);
  }

  const sorted = [...annotations].sort((a, b) => (b.anchor?.length || 0) - (a.anchor?.length || 0));
  let html = escapeHtml(essay);

  for (const anno of sorted) {
    if (!anno.anchor) continue;
    const anchorHtml = escapeHtml(anno.anchor);
    const idx = html.indexOf(anchorHtml);
    if (idx >= 0) {
      const before = html.substring(0, idx);
      const after = html.substring(idx + anchorHtml.length);
      const label = { reflection: '反映', observation: '观察', gentle_prompt: '轻引导' }[anno.type] || anno.type;
      const span = `<span class="annotated">${anchorHtml}<span class="anno-tooltip"><span class="anno-tooltip-type">${escapeHtml(label)}</span><span class="anno-tooltip-comment">${escapeHtml(anno.comment)}</span></span></span>`;
      html = before + span + after;
    }
  }

  return html.replace(/\n/g, '<br>');
}

// ============================================================
//  日志
// ============================================================
function loadJournal() {
  try {
    return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveJournal(list) {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(list));
}
function addJournalEntry(entry) {
  const list = loadJournal();
  list.unshift(entry);
  saveJournal(list);
  // 同步服务端
  apiFetch('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      status: 'completed',
      confidence: entry.confidence,
      hero_quote: entry.hero_quote,
      essay: entry.essay || '',
      annotations: entry.annotations || [],
      schema_version: entry.schema_version || 'v2',
      stances: entry.stances || '',
      premortem_change: entry.premortem_change || '',
      premortem_stay: entry.premortem_stay || '',
      blindspots: entry.blindspots || '',
      future_perspective: entry.future_perspective || '',
      calibrationDate: entry.calibrationDate,
      messages: entry.messages,
      totalTurns: entry.messages ? Math.floor(entry.messages.length / 2) : 0,
    }),
  }).catch(() => {});
}
function getDaysUntilCalibration(date) {
  if (!date) return null;
  const diff = new Date(date) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function showJournal() {
  $('historyOverlay').classList.remove('active');
  const journal = loadJournal();
  if (journal.length === 0) {
    $('journalEmpty').style.display = 'flex';
    $('journalList').innerHTML = '';
  } else {
    $('journalEmpty').style.display = 'none';
    $('journalList').innerHTML = journal.map(entry => {
      const created = new Date(entry.createdAt);
      const dateStr = `${created.getFullYear()}.${String(created.getMonth() + 1).padStart(2, '0')}.${String(created.getDate()).padStart(2, '0')}`;
      const daysLeft = getDaysUntilCalibration(entry.calibrationDate);
      const calBadge = (daysLeft !== null && entry.confidence) ? (
        daysLeft <= 0
          ? `<span class="journal-card-cal overdue">校准已过 ${Math.abs(daysLeft)} 天</span>`
          : `<span class="journal-card-cal">${daysLeft} 天后校准</span>`
      ) : '';
      return `<li class="journal-card" onclick="viewJournalEntry(${entry.id})">
        <div class="journal-card-title">${escapeHtml(entry.title || '未命名决策')}</div>
        <div class="journal-card-meta">
          <span class="journal-card-tag">${escapeHtml(entry.type || '人生')}</span>
          <span>${dateStr}</span>
          <span>${Math.floor((entry.messages || []).length / 2)} 轮</span>
        </div>
        <div class="journal-card-stances">${nl2br(entry.stances || '')}</div>
        ${calBadge}
      </li>`;
    }).join('');
  }
  showScreen('screen-journal');
  trackEvent('page_view', { page: 'journal' });
}

function viewJournalEntry(id) {
  const journal = loadJournal();
  const entry = journal.find(e => e.id === id);
  if (!entry) return;

  const calDate = entry.calibrationDate ? new Date(entry.calibrationDate) : null;
  const calDateStr = calDate ? `${calDate.getFullYear()}年${calDate.getMonth() + 1}月${calDate.getDate()}日` : '—';

  state.snapshotFromJournal = true;
  $('snapshotContent').innerHTML = renderSnapshotHtml(entry, calDateStr, entry.confidence || 7, true);
  showScreen('screen-snapshot');

  // 调整 actions:历史快照页的按钮回到 journal
  const actions = $('snapshotContent').querySelector('.snapshot-actions');
  if (actions) {
    actions.innerHTML = `<button class="end-btn primary" onclick="showJournal()">返回列表</button>`;
  }

  setTimeout(() => { state.snapshotFromJournal = false; }, 100);
}

// ============================================================
//  初始化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  checkServerHealth().then(health => {
    if (!health) console.warn('服务端未连接');
  });
  trackEvent('page_view', { page: 'home' });
  // 恢复"显示提示"开关状态
  const hintsOn = localStorage.getItem('prism_show_hints') !== '0';
  const ht = $('hintToggle');
  ht.classList.toggle('on', hintsOn);
  ht.dataset.on = hintsOn ? 'true' : 'false';
  setTimeout(() => $('homeInput').focus(), 600);
});
