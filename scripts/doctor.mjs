// 环境自检：缺什么直接报，不用等流水线跑到一半。用法：node scripts/doctor.mjs [工程目录]
// 只检查是否存在，不读出、不打印凭据值。
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const win = process.platform === 'win32', mac = process.platform === 'darwin';
const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = process.argv[2] ? resolve(process.argv[2]) : null;
const rows = [];
const add = (level, name, detail = '') => rows.push({ level, name, detail });
const probe = (cmd, args, timeout = 20000) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout });
  return r.error || r.status !== 0 ? null : (r.stdout + r.stderr).trim();
};
const hint = {
  ffmpeg: win ? 'scoop install ffmpeg' : mac ? 'brew install ffmpeg' : '用系统包管理器安装ffmpeg',
};

// 运行时
const major = Number(process.versions.node.split('.')[0]);
add(major >= 18 ? 'PASS' : 'FAIL', 'Node ≥ 18（本skill脚本）', 'v' + process.versions.node);
if (major >= 18 && major < 22) add('WARN', 'Node ≥ 22（HyperFrames要求）', 'v' + process.versions.node + '；用HyperFrames渲染前升级，并运行 npx hyperframes doctor');
for (const tool of ['ffmpeg', 'ffprobe']) {
  const v = probe(tool, ['-version']);
  add(v ? 'PASS' : 'FAIL', tool, v ? v.split('\n')[0] : '未找到；' + hint.ffmpeg);
}
const curlName = process.env.HV_CURL ?? (win ? 'curl.exe' : 'curl');
const curl = probe(curlName, ['--version']);
add(curl ? 'PASS' : 'FAIL', curlName + '（tts/imagegen的HTTP客户端）', curl ? curl.split('\n')[0] : '未找到；' + (mac ? 'macOS自带curl，检查PATH' : '请安装curl'));

// 对齐（whisperX）
const py = ['python3', 'python'].find(c => probe(c, ['--version']));
if (!py) add('WARN', 'Python', '未找到；align.py不可用。' + (mac ? 'brew install python' : ''));
else {
  add('PASS', 'Python', py + ' ' + probe(py, ['--version']));
  const ws = probe(py, ['-c', 'import websockets; assert int(websockets.__version__.split(".")[0]) >= 15']);
  add(ws !== null ? 'PASS' : 'WARN', 'websockets ≥ 15（新版TTS）', ws !== null ? '' : '未安装或版本过低；pip install "websockets>=15"');
  const wx = probe(py, ['-c', 'import whisperx'], 90000);
  add(wx !== null ? 'PASS' : 'WARN', 'whisperx', wx !== null ? '' : '未安装或导入失败；pip install whisperx（Apple Silicon用CPU即可，--device cpu为默认）。SKILL.md里的`python`在Mac上请写`' + py + '`');
}

// 地图回归（可选）
let pw = null;
try { pw = probe(process.execPath, ['-e', "require('playwright');console.log('ok')"], 15000); } catch { /* 可选 */ }
add(pw ? 'PASS' : 'WARN', 'playwright（仅地图回归verify.mjs需要）', pw ? '' : '未安装；npm i -D playwright');

// 路径：非ASCII路径在Windows上已实测会让curl读不到本地文件，HyperFrames也有ASCII路径要求（记录于用户记忆；Mac是否同样未验证）
const nonAscii = p => /[^\x00-\x7F]/.test(p);
for (const [label, p] of [['skill目录', skill], ['工程目录', project]]) {
  if (!p) continue;
  add(nonAscii(p) ? 'WARN' : 'PASS', label + '路径为ASCII', nonAscii(p) ? p + ' 含非ASCII字符：本skill脚本已兼容，但HyperFrames需要ASCII路径（见用户记忆），工程建议放ASCII目录' : '');
}

// 凭据：只报键是否存在
if (project) {
  const keys = new Set();
  for (let d = project, last = ''; d !== last; last = d, d = dirname(d)) {
    const f = ['.env', 'key.env'].map(n => join(d, n)).find(existsSync);
    if (!f) continue;
    for (const line of readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')) keys.add(m[1]);
    }
    break;
  }
  for (const k of ['DOUBAO_TTS_API_KEY', 'DOUBAO_TTS_APPID', 'DOUBAO_TTS_TOKEN', 'HV_IMAGE_BASE_URL', 'HV_IMAGE_API_KEY'])
    add(keys.has(k) || process.env[k] ? 'PASS' : 'WARN', '凭据 ' + k, keys.has(k) || process.env[k] ? '已设置' : '未设置：写入工程或上级目录的.env');
  const hasTts = keys.has('DOUBAO_TTS_API_KEY') || process.env.DOUBAO_TTS_API_KEY ||
    ((keys.has('DOUBAO_TTS_APPID') || process.env.DOUBAO_TTS_APPID) && (keys.has('DOUBAO_TTS_TOKEN') || process.env.DOUBAO_TTS_TOKEN));
  add(hasTts ? 'PASS' : 'WARN', 'TTS可用鉴权组合', hasTts ? '新版API Key或旧版APPID/TOKEN已设置；不代表额度足够' : '至少配置一种鉴权组合');
  add(existsSync(join(project, 'project.json')) ? 'PASS' : 'WARN', 'project.json', existsSync(join(project, 'project.json')) ? '' : '工程目录无project.json');
} else add('WARN', '凭据与工程检查', '未传工程目录，已跳过');

let fail = 0;
for (const r of rows) {
  if (r.level === 'FAIL') fail++;
  console.log(r.level.padEnd(4) + '  ' + r.name + (r.detail ? '  ' + r.detail : ''));
}
console.log(fail ? fail + ' 项必需检查未通过' : '必需检查通过（WARN为可选能力或需注意项）');
process.exit(fail ? 1 : 0);
