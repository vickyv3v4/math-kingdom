const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// ── 基础配置 ──
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 页面路由 ──
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));

const upload = multer({ dest: path.join(__dirname, 'uploads') });

const PROBLEMS_FILE = path.join(__dirname, 'data', 'problems.json');
const PROGRESS_FILE = path.join(__dirname, 'data', 'progress.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ── 配置加载 ──
const config = readJSON(CONFIG_FILE);
const ADMIN_PASSWORD = config.adminPassword || 'math2024';

// ── 简易 Token 鉴权 ──
const authTokens = new Set();
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !authTokens.has(token)) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  next();
}

// ── JSON 读写工具 ──
function readJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf-8')); }
  catch { return filepath.endsWith('problems.json') ? [] : { tiles: [], problemStats: {} }; }
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function genId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── 初始化 ──
if (!fs.existsSync(PROGRESS_FILE)) {
  const init = { tiles: [], problemStats: {} };
  for (let i = 0; i < 20; i++) init.tiles.push({ index: i, status: 'locked', building: null });
  writeJSON(PROGRESS_FILE, init);
}

// ══════════════════════════════════════
//  API：家长登录
// ══════════════════════════════════════

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '请输入密码' });
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: '密码错误' });

  const token = 'tk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  authTokens.add(token);
  res.json({ ok: true, token });
});

app.post('/api/auth/logout', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  authTokens.delete(token);
  res.json({ ok: true });
});

// ══════════════════════════════════════
//  API：错题管理
// ══════════════════════════════════════

// 获取所有错题（支持按学科筛选）
app.get('/api/problems', (req, res) => {
  const problems = readJSON(PROBLEMS_FILE);
  const { subject } = req.query;
  if (subject && ['math', 'chinese', 'english'].includes(subject)) {
    return res.json(problems.filter(p => (p.subject || 'math') === subject));
  }
  res.json(problems);
});

// 手动添加错题
app.post('/api/problems', authMiddleware, (req, res) => {
  const { title, content, answer, hint, tags, difficulty, subject } = req.body;
  if (!content || answer === undefined || answer === '') {
    return res.status(400).json({ error: '题目内容和答案不能为空' });
  }
  const validSubject = ['math', 'chinese', 'english'].includes(subject) ? subject : 'math';
  const problems = readJSON(PROBLEMS_FILE);
  const problem = {
    id: genId(),
    title: title || '未命名题目',
    content: content.trim(),
    answer: String(answer).trim(),
    hint: hint || '',
    tags: tags || [],
    subject: validSubject,
    difficulty: difficulty || 1,
    createdAt: new Date().toISOString().slice(0, 10)
  };
  problems.push(problem);
  writeJSON(PROBLEMS_FILE, problems);
  res.json({ ok: true, problem });
});

// 更新错题
app.put('/api/problems/:id', authMiddleware, (req, res) => {
  const problems = readJSON(PROBLEMS_FILE);
  const idx = problems.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '未找到该题目' });

  const { title, content, answer, hint, tags, difficulty, subject } = req.body;
  if (content !== undefined) problems[idx].content = content.trim();
  if (answer !== undefined) problems[idx].answer = String(answer).trim();
  if (title !== undefined) problems[idx].title = title;
  if (hint !== undefined) problems[idx].hint = hint;
  if (tags !== undefined) problems[idx].tags = tags;
  if (difficulty !== undefined) problems[idx].difficulty = difficulty;
  if (subject !== undefined && ['math', 'chinese', 'english'].includes(subject)) problems[idx].subject = subject;

  writeJSON(PROBLEMS_FILE, problems);
  res.json({ ok: true, problem: problems[idx] });
});

// 删除错题
app.delete('/api/problems/:id', authMiddleware, (req, res) => {
  let problems = readJSON(PROBLEMS_FILE);
  const before = problems.length;
  problems = problems.filter(p => p.id !== req.params.id);
  if (problems.length === before) return res.status(404).json({ error: '未找到该题目' });

  writeJSON(PROBLEMS_FILE, problems);

  // 同步清理进度
  const progress = readJSON(PROGRESS_FILE);
  delete progress.problemStats[req.params.id];
  writeJSON(PROGRESS_FILE, progress);

  res.json({ ok: true });
});

// ══════════════════════════════════════
//  API：OCR 识别
// ══════════════════════════════════════

// 图片 OCR
app.post('/api/ocr/image', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传图片' });

  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('chi_sim+eng');
    const { data } = await worker.recognize(req.file.path);
    await worker.terminate();

    // 清理临时文件
    fs.unlink(req.file.path, () => {});

    // 尝试智能提取题目和答案
    const text = data.text.trim();
    const extracted = extractProblem(text);

    res.json({ ok: true, raw: text, ...extracted });
  } catch (err) {
    res.status(500).json({ error: 'OCR 识别失败: ' + err.message });
  }
});

// PDF 文字提取
app.post('/api/ocr/pdf', authMiddleware, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传 PDF' });

  try {
    const pdfParse = require('pdf-parse');
    const dataBuffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(dataBuffer);

    // 清理临时文件
    fs.unlink(req.file.path, () => {});

    const text = data.text.trim();
    if (!text || text.length < 5) {
      return res.json({
        ok: true,
        raw: '',
        warning: 'PDF 内容极少，可能是扫描件。请尝试截图后用"拍照识别"功能。'
      });
    }

    const extracted = extractProblem(text);
    res.json({ ok: true, raw: text, pageCount: data.numpages, ...extracted });
  } catch (err) {
    res.status(500).json({ error: 'PDF 解析失败: ' + err.message });
  }
});

// 智能提取：尝试从 OCR 文本中识别题目、答案、提示
function extractProblem(text) {
  const result = { content: '', answer: '', hint: '' };

  // 按行处理
  const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

  // 找答案行（包含 答案/答/结果/＝/= 的行）
  const answerLine = lines.find(l =>
    /^答[案]?\s*[：:＝=]/.test(l) ||
    /答案\s*[：:＝=]/.test(l) ||
    /^[＝=]/.test(l)
  );
  if (answerLine) {
    result.answer = answerLine.replace(/^答[案]?\s*[：:＝=]\s*/, '').replace(/^[＝=]\s*/, '').trim();
  }

  // 找提示行
  const hintLine = lines.find(l => /^(提示|思路)[：:]/.test(l));
  if (hintLine) {
    result.hint = hintLine.replace(/^(提示|思路)[：:]\s*/, '').trim();
  }

  // 其余作为题目内容
  const excludeLines = [answerLine, hintLine].filter(Boolean);
  result.content = lines.filter(l => !excludeLines.includes(l)).join('\n');

  return result;
}

// ══════════════════════════════════════
//  API：答题评分
// ══════════════════════════════════════

app.post('/api/grade', (req, res) => {
  const { problemId, answer, tileIndex } = req.body;
  if (!problemId) return res.status(400).json({ error: '缺少题目 ID' });

  const problems = readJSON(PROBLEMS_FILE);
  const problem = problems.find(p => p.id === problemId);
  if (!problem) return res.status(404).json({ error: '题目不存在' });

  const correct = isAnswerCorrect(problem.subject || 'math', problem.answer, String(answer || '').trim());
  const progress = readJSON(PROGRESS_FILE);

  // 更新统计
  if (!progress.problemStats[problemId]) {
    progress.problemStats[problemId] = {
      attempts: 0, correct: 0, consecutiveCorrect: 0,
      lastAttempt: null, nextReview: null, mastered: false
    };
  }
  const stats = progress.problemStats[problemId];
  stats.attempts++;
  stats.lastAttempt = new Date().toISOString().slice(0, 10);

  if (correct) {
    stats.correct++;
    stats.consecutiveCorrect++;
    // 连续对 3 次 = 已掌握
    if (stats.consecutiveCorrect >= 3) {
      stats.mastered = true;
    }
    // 1 天后复习（如果还没掌握）
    if (!stats.mastered) {
      stats.nextReview = addDays(new Date(), 1).toISOString().slice(0, 10);
    }
  } else {
    stats.consecutiveCorrect = 0;
    // 错了第二天复习
    const days = Math.min(stats.attempts - stats.correct, 5);
    stats.nextReview = addDays(new Date(), days || 1).toISOString().slice(0, 10);
  }

  // 答对则解锁指定地块（或第一个锁定的地块）
  let unlockedTile = null;
  if (correct) {
    let tile;
    if (tileIndex !== undefined && tileIndex !== null) {
      tile = progress.tiles.find(t => t.index === tileIndex && t.status === 'locked');
    }
    if (!tile) {
      tile = progress.tiles.find(t => t.status === 'locked');
    }
    if (tile) {
      tile.status = 'unlocked';
      tile.building = randomBuilding();
      unlockedTile = tile;
    }
  }

  writeJSON(PROGRESS_FILE, progress);

  res.json({
    correct,
    answer: problem.answer,
    hint: problem.hint,
    mastered: stats.mastered,
    unlockedTile,
    stats: {
      total: progress.tiles.filter(t => t.status === 'unlocked').length,
      remaining: progress.tiles.filter(t => t.status === 'locked').length
    }
  });
});

// ══════════════════════════════════════
//  答案比对引擎（分学科）
// ══════════════════════════════════════

// 主入口：根据学科分发
function isAnswerCorrect(subject, correctAnswer, userAnswer) {
  const raw = String(correctAnswer || '').trim();
  const input = String(userAnswer || '').trim();
  if (!raw && !input) return true;
  if (!raw || !input) return false;

  // 多答案支持：老师用 | 分隔多个可接受答案
  const acceptableAnswers = raw.split('|').map(s => s.trim()).filter(Boolean);

  for (const acceptable of acceptableAnswers) {
    let match;
    switch (subject) {
      case 'chinese': match = gradeChinese(acceptable, input); break;
      case 'english': match = gradeEnglish(acceptable, input); break;
      default:        match = gradeMath(acceptable, input); break;
    }
    if (match) return true;
  }
  return false;
}

// ── 数学评分（现有逻辑） ──
function gradeMath(c, u) {
  // 直接匹配
  if (c === u) return true;

  // 标准化：全角数字转半角、去空格
  c = normalizeMath(c);
  u = normalizeMath(u);
  if (c === u) return true;

  // 移除常见量词后缀
  const suffixes = ['元', '个', '只', '颗', '本', '支', '条', '张', '块', '次', '人',
    '米', '厘米', '毫米', '分米', '千米', '公里', '分钟', '小时', '天', '岁', '倍',
    '克', '千克', '斤', '吨', '升', '毫升', '角', '分', '秒', '道', '题'];
  for (const s of suffixes) {
    c = c.replace(new RegExp(s + '\\s*$'), '').trim();
    u = u.replace(new RegExp(s + '\\s*$'), '').trim();
  }
  if (c === u) return true;

  // 数值比较
  const nc = parseFloat(c);
  const nu = parseFloat(u);
  if (!isNaN(nc) && !isNaN(nu) && Math.abs(nc - nu) < 0.001) return true;

  // 分数比较
  const fc = parseFraction(c);
  const fu = parseFraction(u);
  if (fc !== null && fu !== null && Math.abs(fc - fu) < 0.001) return true;

  // 中文数字互转
  const cnC = cnToNum(c);
  const cnU = cnToNum(u);
  if (cnC !== null && cnU !== null && cnC === cnU) return true;
  if (cnC !== null && !isNaN(nu) && cnC === nu) return true;
  if (cnU !== null && !isNaN(nc) && cnU === nc) return true;

  return false;
}

function normalizeMath(s) {
  return s
    .replace(/[\s　]+/g, '')
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/．/g, '.').replace(/＝/g, '=').replace(/＋/g, '+')
    .replace(/－/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
}

function parseFraction(s) {
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return parseFloat(m[1]) / parseFloat(m[2]);
  const m2 = s.match(/^(\d+)\s*又?\s*(\d+)\s*\/\s*(\d+)$/);
  if (m2) return parseFloat(m2[1]) + parseFloat(m2[2]) / parseFloat(m2[3]);
  return null;
}

function cnToNum(s) {
  const mixed = s.match(/^(\d+)\s*([万亿千百十])$/);
  if (mixed) {
    const unitMap = { '十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000 };
    return parseInt(mixed[1]) * (unitMap[mixed[2]] || 1);
  }
  if (!/^[零一二两三四五六七八九十百千万亿]+$/.test(s)) return null;
  if (s.includes('亿')) {
    const parts = s.split('亿');
    const yi = parts[0] ? cnToNumSimple(parts[0]) : 1;
    const rest = parts[1] ? cnToNumSimple(parts[1]) : 0;
    return yi * 100000000 + rest;
  }
  if (s.includes('万')) {
    const parts = s.split('万');
    const wan = parts[0] ? cnToNumSimple(parts[0]) : 1;
    const rest = parts[1] ? cnToNumSimple(parts[1]) : 0;
    return wan * 10000 + rest;
  }
  return cnToNumSimple(s);
}

function cnToNumSimple(s) {
  if (!s) return 0;
  const map = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000 };
  let result = 0, current = 0, hasDigit = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '零') { hasDigit = true; continue; }
    if (ch === '十' || ch === '百' || ch === '千') {
      const unit = map[ch];
      if (!hasDigit && (ch === '十' || ch === '百' || ch === '千')) current = 1;
      result += current * unit;
      current = 0;
      hasDigit = false;
    } else {
      if (current > 0) result += current;
      current = map[ch];
      hasDigit = true;
    }
  }
  result += current;
  return result;
}

// ── 语文评分 ──
function gradeChinese(c, u) {
  // 标准化：去空格、统一标点
  c = normalizeChinese(c);
  u = normalizeChinese(u);
  return c === u;
}

function normalizeChinese(s) {
  return s
    .replace(/[\s　\r\n]+/g, '')     // 去所有空白
    .replace(/[，]/g, ',')            // 中文逗号→英文逗号
    .replace(/[、]/g, ',')            // 顿号→逗号
    .replace(/[；]/g, ';')            // 中文分号→英文分号
    .replace(/[．。]/g, '.')          // 中文句号→英文句号
    .replace(/[：]/g, ':')            // 中文冒号→英文冒号
    .replace(/[！]/g, '!')            // 中文感叹号→英文
    .replace(/[？]/g, '?')            // 中文问号→英文
    .replace(/[""]/g, '"')           // 中文引号→英文
    .replace(/[【\[\]】]/g, '')       // 去掉括号（填空答案可能带括号）
    .replace(/[《》<>]/g, '')         // 去掉书名号
    .replace(/^[,.!?;:'"]+/, '')     // 去首部标点
    .replace(/[,.!?;:'"]+$/, '')     // 去尾部标点
    .toLowerCase();
}

// ── 英语评分 ──
function gradeEnglish(c, u) {
  c = normalizeEnglish(c);
  u = normalizeEnglish(u);
  if (c === u) return true;

  // 尝试还原常见变形后再比
  const cBase = stemWord(c);
  const uBase = stemWord(u);
  return cBase === uBase || stemWordLenient(c) === stemWordLenient(u);
}

function normalizeEnglish(s) {
  return s
    .replace(/[\s\r\n]+/g, ' ')      // 多空格→单空格
    .replace(/[．。！？，、；：""【】《》]/g, '') // 去中文标点
    .replace(/[.!?,;:'"()]+$/g, '')  // 去尾部英文标点
    .trim()
    .toLowerCase();
}

// 英语词汇还原（处理常见变形）
function stemWord(s) {
  // 按空格分词处理
  return s.split(/\s+/).map(w => {
    // be 动词
    if (['am', 'is', 'are', 'was', 'were', 'been'].includes(w)) return 'be';
    // have
    if (['has', 'had', 'having'].includes(w)) return 'have';
    // 常见不规则动词过去式
    const irregular = {
      went: 'go', gone: 'go', going: 'go', goes: 'go',
      did: 'do', done: 'do', doing: 'do', does: 'do',
      made: 'make', making: 'make', makes: 'make',
      took: 'take', taken: 'take', taking: 'take', takes: 'take',
      got: 'get', gotten: 'get', getting: 'get', gets: 'get',
      ate: 'eat', eaten: 'eat', eating: 'eat', eats: 'eat',
      ran: 'run', running: 'run', runs: 'run',
      saw: 'see', seen: 'see', seeing: 'see', sees: 'see',
      wrote: 'write', written: 'write', writing: 'write', writes: 'write',
      read: 'read', reading: 'read', reads: 'read',
      spoke: 'speak', spoken: 'speak', speaking: 'speak', speaks: 'speak',
      bought: 'buy', buying: 'buy', buys: 'buy',
      thought: 'think', thinking: 'think', thinks: 'think',
      knew: 'know', known: 'know', knowing: 'know', knows: 'know',
      came: 'come', coming: 'come', comes: 'come',
      gave: 'give', given: 'give', giving: 'give', gives: 'give',
      found: 'find', finding: 'find', finds: 'find',
      told: 'tell', telling: 'tell', tells: 'tell',
      said: 'say', saying: 'say', says: 'say',
      sat: 'sit', sitting: 'sit', sits: 'sit',
      stood: 'stand', standing: 'stand', stands: 'stand',
      flew: 'fly', flew: 'fly', flying: 'fly', flies: 'fly',
      swam: 'swim', swimming: 'swim', swims: 'swim',
      sang: 'sing', sung: 'sing', singing: 'sing', sings: 'sing',
      drew: 'draw', drawn: 'draw', drawing: 'draw', draws: 'draw',
      drank: 'drink', drunk: 'drink', drinking: 'drink', drinks: 'drink',
      drove: 'drive', driven: 'drive', driving: 'drive', drives: 'drive',
      rode: 'ride', ridden: 'ride', riding: 'ride', rides: 'ride',
    };
    if (irregular[w]) return irregular[w];
    // 常见复数
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';   // babies → baby
    if (w.endsWith('ves') && w.length > 4) return w.slice(0, -3) + 'f';   // knives → knife
    if (w === 'children') return 'child';
    if (w === 'men') return 'man';
    if (w === 'women') return 'woman';
    if (w === 'teeth') return 'tooth';
    if (w === 'feet') return 'foot';
    if (w === 'mice') return 'mouse';
    if (w === 'sheep') return 'sheep';
    if (w === 'fish') return 'fish';
    // 规则复数 -es (boxes, watches)
    if (w.endsWith('es') && w.length > 4 && !w.endsWith('ees') && !w.endsWith('ies')) return w.slice(0, -2);
    // 规则复数 -s
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
    // 规则过去式 -ed
    if (w.endsWith('ed') && !w.endsWith('eed') && w.length > 4) return w.slice(0, -2);
    if (w.endsWith('ied') && w.length > 4) return w.slice(0, -3) + 'y';  // carried → carry
    // 规则进行时 -ing
    if (w.endsWith('ing') && w.length > 5) {
      const base = w.slice(0, -3);
      // running → run (双写辅音)
      if (base.length >= 4 && base[base.length - 1] === base[base.length - 2]) return base.slice(0, -1);
      return base;
    }
    return w;
  }).join(' ');
}

// 更宽松的词形还原（只处理最常见的，作为后备）
function stemWordLenient(s) {
  return s.replace(/s$/, '').replace(/ed$/, '').replace(/ing$/, '');
}

// ══════════════════════════════════════
//  API：王国进度
// ══════════════════════════════════════

// 获取进度
app.get('/api/progress', (_req, res) => {
  const progress = readJSON(PROGRESS_FILE);
  const problems = readJSON(PROBLEMS_FILE);

  // 返回可用题目（需要复习的）
  const today = new Date().toISOString().slice(0, 10);
  const available = problems.filter(p => {
    const stats = progress.problemStats[p.id];
    if (!stats) return true;
    if (stats.mastered) return false;
    if (!stats.nextReview) return true;
    return stats.nextReview <= today;
  });

  // 按学科统计
  const subjectStats = {};
  for (const s of ['math', 'chinese', 'english']) {
    const subProblems = problems.filter(p => (p.subject || 'math') === s);
    const mastered = subProblems.filter(p => progress.problemStats[p.id] && progress.problemStats[p.id].mastered).length;
    subjectStats[s] = { total: subProblems.length, mastered };
  }

  res.json({
    ...progress,
    availableCount: available.length,
    totalProblems: problems.length,
    masteredCount: Object.values(progress.problemStats).filter(s => s.mastered).length,
    subjectStats
  });
});

// 重置进度
app.post('/api/progress/reset', authMiddleware, (_req, res) => {
  const init = { tiles: [], problemStats: {} };
  for (let i = 0; i < 20; i++) init.tiles.push({ index: i, status: 'locked', building: null });
  writeJSON(PROGRESS_FILE, init);
  res.json({ ok: true });
});

// ══════════════════════════════════════
//  辅助函数
// ══════════════════════════════════════

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const BUILDINGS = ['🏰', '🏯', '🏠', '🏡', '🚀', '🌾', '🏗️', '🎡', '⛲', '🏛️', '🕌', '🏭', '🔬', '🗼', '🎪', '🏟️', '🛖', '🏘️', '🕍', '🏤'];

function randomBuilding() {
  return BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)];
}

// ══════════════════════════════════════
//  启动
// ══════════════════════════════════════

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏰  错题王国已启动！`);
  console.log(`    本机访问: http://localhost:${PORT}`);
  console.log(`    局域网访问: http://<你的IP>:${PORT}\n`);
});
