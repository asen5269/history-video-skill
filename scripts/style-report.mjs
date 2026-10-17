// 文风体检：只做可解释的文本统计，不判断"像不像人说话"，也不阻断流程。
// 用法: node style-report.mjs <项目|script.json> [--baseline <上一版script.json>] [--json] [--out <文件>] [--strict]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const valueOf = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const target = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--baseline' && argv[i - 1] !== '--out');

if (!target) {
  console.error('usage: node style-report.mjs <项目|script.json> [--baseline <script.json>] [--json] [--out <文件>] [--strict]');
  process.exit(2);
}

const readScript = p => {
  const file = p.endsWith('.json') ? p : join(p, 'script.json');
  return JSON.parse(readFileSync(file, 'utf8'));
};

// 只统计中文字符与字母数字，标点不计入句长
const PUNC = /[\p{P}\p{Z}\s]/u;
const content = s => [...String(s ?? '')].filter(c => !PUNC.test(c));

// 抽象词与总结腔：这些词本身没错，密集出现通常意味着作者在替听众总结
const ABSTRACT = ['本质', '意义', '关键在于', '这说明', '这就叫', '说明了什么', '值得深思',
  '换句话说', '也就是说', '从某种意义上', '综上所述', '归根结底', '不难看出', '由此可见'];
// 直接对听众说话的痕迹
const ADDRESS = ['我', '你', '咱'];

function metrics(script) {
  const sentences = (script.sentences ?? []).map(s => String(s.text ?? '')).filter(Boolean);
  const lens = sentences.map(s => content(s).length);
  const n = sentences.length || 1;
  const total = lens.reduce((a, b) => a + b, 0);
  const mean = total / n;
  const sorted = [...lens].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
  const sd = Math.sqrt(lens.reduce((a, x) => a + (x - mean) ** 2, 0) / n) || 0;
  const questions = sentences.filter(s => /[？?]/.test(s)).length;
  // 连续问句：相邻两句都是问句
  let runs = 0;
  for (let i = 1; i < sentences.length; i++) if (/[？?]/.test(sentences[i]) && /[？?]/.test(sentences[i - 1])) runs++;
  const text = sentences.join('');
  const abstractHits = ABSTRACT.reduce((a, w) => a + text.split(w).length - 1, 0);
  const addressHits = ADDRESS.reduce((a, w) => a + text.split(w).length - 1, 0);
  const dupes = sentences.length - new Set(sentences).size;
  return {
    sentences: sentences.length,
    chars: total,
    meanLen: mean,
    medianLen: median,
    sdLen: sd,
    shortRatio: lens.filter(x => x <= 6).length / n,
    longRatio: lens.filter(x => x >= 25).length / n,
    questionRatio: questions / n,
    questionRuns: runs,
    abstractPer1k: total ? abstractHits / total * 1000 : 0,
    addressPer100: addressHits / n * 100,
    dupes,
  };
}

const pct = x => (x * 100).toFixed(1) + '%';
const num = (x, d = 1) => Number(x).toFixed(d);
const ROWS = [
  ['句数', m => m.sentences, m => String(m.sentences)],
  ['正文字数（不含标点）', m => m.chars, m => String(m.chars)],
  ['平均句长', m => m.meanLen, m => num(m.meanLen)],
  ['句长中位数', m => m.medianLen, m => num(m.medianLen)],
  ['句长标准差', m => m.sdLen, m => num(m.sdLen)],
  ['≤6字句占比', m => m.shortRatio, m => pct(m.shortRatio)],
  ['≥25字句占比', m => m.longRatio, m => pct(m.longRatio)],
  ['问句占比', m => m.questionRatio, m => pct(m.questionRatio)],
  ['连续问句对数', m => m.questionRuns, m => String(m.questionRuns)],
  ['抽象/总结词（每千字）', m => m.abstractPer1k, m => num(m.abstractPer1k, 2)],
  ['我/你（每百句）', m => m.addressPer100, m => num(m.addressPer100)],
  ['重复句（同文）', m => m.dupes, m => String(m.dupes)],
];

// 阈值是提示，不是及格线；触发只说明"值得回看这段"，不证明文风好坏
const HINTS = [
  [m => m.shortRatio > 0.45, '碎句偏多：可能是靠拆句制造口语感，回看该合并的是否被切成了短句'],
  [m => m.meanLen < 8, '平均句长偏短：留意是否全篇都是短句对仗'],
  [m => m.longRatio > 0.25, '长句偏多：试读时确认能否一口气念完'],
  [m => m.questionRatio > 0.12, '设问偏密：确认提问出现在真容易糊涂处，不是每段抛题再自答'],
  [m => m.questionRuns >= 3, '存在连续问句：检查是否变成主持人式自问自答'],
  [m => m.abstractPer1k > 2.5, '抽象/总结词偏密：这些位置容易写成旁白替听众总结'],
  [m => m.addressPer100 < 3, '几乎没有"我/你"：确认是否通篇第三人称说明，而不是在跟人讲话'],
  [m => m.dupes > 0, '存在完全相同的句子：确认不是复制粘贴残留'],
];

const script = readScript(target);
const now = metrics(script);
const basePath = valueOf('baseline');
const base = basePath ? metrics(readScript(basePath)) : null;

if (flag('json')) {
  const hints = HINTS.filter(([t]) => t(now)).map(([, h]) => h);
  const out = { target: basename(target), metrics: now, ...(base ? { baseline: base } : {}), hints };
  console.log(JSON.stringify(out, null, 2));
  process.exit(flag('strict') && hints.length ? 1 : 0);
}

const lines = [];
lines.push('# 文风体检报告', '');
lines.push(`口径：只统计正文文本，标点与空白不计入句长；本报告不判断文风是否合格，也不阻断流程。`);
lines.push(basePath ? `对比基线：${basename(basePath)}` : '未指定基线（加 --baseline <上一版 script.json> 可看变化）', '');
lines.push('| 指标 | 当前 |' + (base ? ' 基线 | 变化 |' : ''));
lines.push('| --- | --- |' + (base ? ' --- | --- |' : ''));
for (const [name, get, fmt] of ROWS) {
  const cur = fmt(now);
  if (!base) { lines.push(`| ${name} | ${cur} |`); continue; }
  const b = get(base), c = get(now);
  const delta = typeof c === 'number' ? (c - b) : NaN;
  const show = Number.isFinite(delta) ? (delta > 0 ? '+' : '') + num(delta, 2) : '—';
  lines.push(`| ${name} | ${cur} | ${fmt(base)} | ${show} |`);
}
const hits = HINTS.filter(([t]) => t(now)).map(([, h]) => h);
lines.push('', hits.length ? '## 提示（供回看，不是判定）' : '## 提示', '');
if (hits.length) for (const h of hits) lines.push('- ' + h);
else lines.push('- 未触发任何提示。这不证明文风合格，仍需按 research.md 逐段试读。');
lines.push('', '> 统计只能指出可疑位置；"像不像有人在讲事"必须靠试读判断，不要把本报告当验收。');

const md = lines.join('\n') + '\n';
const outPath = valueOf('out');
if (outPath) { writeFileSync(outPath, md, 'utf8'); console.log(`已写入 ${outPath}`); }
else console.log(md);

if (flag('strict') && hits.length) process.exit(1);
