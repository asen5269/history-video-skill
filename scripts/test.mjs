// 离线回归：真实FFmpeg；TTS用本地函数替身，生图请求仅发往本机测试服务器。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { readJson, audioHash, ttsSpec } from './audio-cache.mjs';
import { contentChars, displayRanges } from './subtitle-data.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'history-video-tests-'));
after(() => {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('history-video-tests-')) throw new Error('临时目录越界');
  rmSync(root, { recursive: true, force: true });
});
const json = (dir, file, data) => writeFileSync(join(dir, file), JSON.stringify(data, null, 2));
const run = (tool, args, env = {}) => spawnSync(tool, args, { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 90000 });
const python = ['python3', 'python'].find(c => spawnSync(c, ['--version']).status === 0) ?? 'python';
const node = (name, dir, ...args) => run(process.execPath, [join(scripts, name), dir, ...args]);
const success = r => assert.equal(r.status, 0, r.error?.message ?? r.stdout + r.stderr);
const failed = r => assert.notEqual(r.status, 0, r.stdout + r.stderr);

function wav(seconds) {
  const frames = Math.round(seconds * 48000), buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF'); buf.writeUInt32LE(buf.length - 8, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(96000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buf.writeInt16LE(Math.round(6000 * Math.sin(i * 2 * Math.PI * 440 / 48000)), 44 + i * 2);
  return buf;
}
const sampleWav = join(root, 'sample.wav'), sampleMp3 = join(root, 'sample.mp3');
writeFileSync(sampleWav, wav(2));
success(run('ffmpeg', ['-v', 'error', '-y', '-i', sampleWav, sampleMp3]));
const sampleRaw = readFileSync(sampleMp3), sampleTrim = readFileSync(sampleWav), sampleMp3Raw = sampleRaw;

function project(count = 2) {
  const dir = mkdtempSync(join(root, 'project-'));
  mkdirSync(join(dir, 'audio/raw'), { recursive: true });
  mkdirSync(join(dir, 'audio/trim'), { recursive: true });
  const sentences = Array.from({ length: count }, (_, i) => ({ id: 's' + String(i + 1).padStart(3, '0'), text: '甲乙丙丁戊己？', fact: false }));
  json(dir, 'project.json', { confirmed: { script: 1, plan: 1, hook: 1 }, ...(count < 10 ? { durationMinutes: { min: 0.01, max: 1 } } : {}) });
  json(dir, 'script.json', { version: 1, hookSentences: 1, titles: ['甲', '乙', '丙'], hooks: [1, 2, 3].map(() => ({ text: '甲？', evidence: '测试文献' })), sentences, evidence: [] });
  writeFileSync(join(dir, 'script-review.md'), 'review-version: 1\nreview-audio: 未试听\n\n# 口播验收\n\n测试夹具，非真实验收。\n');
  const durations = {}, aligns = {};
  for (const sentence of sentences) {
    const raw = join(dir, 'audio/raw', sentence.id + '.mp3'), trim = join(dir, 'audio/trim', sentence.id + '.wav');
    writeFileSync(raw, sampleRaw); writeFileSync(trim, sampleTrim);
    const rawHash = audioHash(raw), hash = audioHash(trim);
    json(dir, 'audio/raw/' + sentence.id + '.mp3.json', { ...ttsSpec(sentence.text), audioHash: rawHash });
    durations[sentence.id] = { duration: 2, tts: sentence.text, rawHash, audioHash: hash, threshold: '-50dB' };
    json(dir, 'audio/trim/' + sentence.id + '.wav.json', durations[sentence.id]);
    aligns[sentence.id] = { tts: sentence.text, audioHash: hash, model: 'jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn', chars: [...sentence.text].map((c, i) => ({ c, s: i < 6 ? i / 3 : null, e: i < 6 ? (i + 1) / 3 : null })) };
  }
  json(dir, 'durations.json', { version: 1, items: durations });
  json(dir, 'align.json', { schema: 2, timebase: 'sentence', items: aligns });
  return dir;
}
function complete(dir) {
  success(node('timeline.mjs', dir));
  const timeline = readJson(join(dir, 'timeline.json'));
  json(dir, 'shots.json', { version: 1, scriptVersion: 1, shots: timeline.items.map((it, i) => ({ id: 'c' + (i + 1), sids: [it.id], dur: it.end - it.start + it.pause, size: 'close', recipe: 'evidence-hold', layers: ['史料原图'], overlay: '史料细节标注', landing: '静止便于读懂证据' })) });
  success(node('srt.mjs', dir));
  return timeline;
}

test('未指定stage时执行全部检查，缺文件不得通过', () => {
  const dir = project(), r = node('gate.mjs', dir);
  failed(r); assert.match(r.stdout, /timeline.json/); assert.match(r.stdout, /align|subs/);
});
test('voice缺时间轴、未知stage或缺stage参数均失败', () => {
  const dir = project();
  failed(node('gate.mjs', dir, '--stage', 'voice'));
  assert.equal(node('gate.mjs', dir, '--stage', 'typo').status, 2);
  assert.equal(node('gate.mjs', dir, '--stage').status, 2);
});
test('空稿子和空镜头不能靠every空数组通过', () => {
  const dir = project(), script = readJson(join(dir, 'script.json'));
  script.sentences = []; json(dir, 'script.json', script);
  failed(node('gate.mjs', dir, '--stage', 'script'));
  json(dir, 'shots.json', { version: 1, scriptVersion: 1, shots: [] });
  failed(node('gate.mjs', dir, '--stage', 'plan'));
});
test('完整产物通过；连续静止史料镜头允许但提示人工审美检查', () => {
  const dir = project(); complete(dir);
  const r = node('gate.mjs', dir); success(r); assert.match(r.stdout, /WARN/);
});
test('证据摘录必须能在原文快照中检索到', () => {
  const dir = project(); complete(dir);
  mkdirSync(join(dir, 'sources'), { recursive: true });
  writeFileSync(join(dir, 'sources/a.txt'), '八月 己酉，车驾至土木，\n被也先追及。');
  const script = readJson(join(dir, 'script.json'));
  script.sentences[0].fact = true;
  const ev = { ids: ['s001'], claim: 'x', source: 's', locator: 'l', status: 'verified', snapshot: 'sources/a.txt', quote: '车驾至土木，被也先追及' };
  script.evidence = [ev]; json(dir, 'script.json', script);
  success(node('gate.mjs', dir, '--stage', 'script'));
  for (const bad of [{ quote: '编造的一句话不在原文里' }, { quote: '车驾至土木' }, { snapshot: 'sources/none.txt' }, { snapshot: '../../etc/passwd' }]) {
    script.evidence = [{ ...ev, ...bad }]; json(dir, 'script.json', script);
    const r = node('gate.mjs', dir, '--stage', 'script'); failed(r); assert.match(r.stdout, /FAIL  证据摘录/);
  }
});
test('停顿档位、长停顿理由与结尾留白', () => {
  const dir = project(); complete(dir);
  const t = readJson(join(dir, 'timeline.json'));
  assert.equal(t.items[0].pause, 0.35); assert.equal(t.items[1].pause, 2);
  const script = readJson(join(dir, 'script.json'));
  script.sentences[0].pause = 'breath'; json(dir, 'script.json', script);
  let r = node('gate.mjs', dir, '--stage', 'script'); failed(r); assert.match(r.stdout, /FAIL  长停顿/);
  script.sentences[0].pauseWhy = '钩子之后留白'; json(dir, 'script.json', script);
  success(node('gate.mjs', dir, '--stage', 'script'));
  success(node('timeline.mjs', dir));
  assert.equal(readJson(join(dir, 'timeline.json')).items[0].pause, 1);
  script.sentences[0].pause = 2; json(dir, 'script.json', script); failed(node('timeline.mjs', dir));
  script.sentences[0].pause = 'turn'; script.tail = 9; json(dir, 'script.json', script); failed(node('timeline.mjs', dir));
});
test('doctor自检不泄露凭据值，缺凭据只警告', () => {
  const dir = project();
  writeFileSync(join(dir, '.env'), 'DOUBAO_TTS_APPID=secret-appid-123\n');
  const r = node('doctor.mjs', dir);
  assert.match(r.stdout, /PASS  凭据 DOUBAO_TTS_APPID/);
  assert.match(r.stdout, /WARN  凭据 DOUBAO_TTS_TOKEN/);
  assert.doesNotMatch(r.stdout + r.stderr, /secret-appid-123/);
});
test('总时长超出目标范围只警告，不阻断', () => {
  const dir = project(); complete(dir);
  json(dir, 'project.json', { durationMinutes: { min: 10, max: 20 }, confirmed: { script: 1, plan: 1, hook: 1 } });
  const r = node('gate.mjs', dir, '--stage', 'voice'); success(r); assert.match(r.stdout, /WARN  总时长/);
});
test('稿子及画面确认不能沿用旧版本', () => {
  const dir = project(); complete(dir);
  json(dir, 'project.json', { durationMinutes: { min: 0.01, max: 1 }, confirmed: { script: 0, plan: 0 } });
  const r = node('gate.mjs', dir); failed(r); assert.match(r.stdout, /FAIL  当前稿子已确认/); assert.match(r.stdout, /FAIL  当前画面方案已确认/);
});
function mixProject({ voiceSecs = 10, bgmSecs = 5, silentAfter = null } = {}) {
  const dir = project(1);
  const voice = join(dir, 'voice.wav');
  const af = silentAfter === null ? 'anull' : `volume=enable='gte(t,${silentAfter})':volume=0`;
  success(run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=1000:d=${voiceSecs}`, '-af', af, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', voice]));
  success(run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=220:d=${bgmSecs}`, '-ar', '44100', '-ac', '2', join(dir, 'bgm.wav')]));
  json(dir, 'timeline.json', { version: 1, total: voiceSecs, voiceHash: audioHash(voice), items: [] });
  json(dir, 'mix.json', { bgm: { file: 'bgm.wav', fadeIn: 0, fadeOut: 0 }, sfx: [{ type: 'whoosh', at: 1 }, { type: 'impact', at: voiceSecs - 2 }] });
  json(dir, 'assets.json', [{ type: 'bgm', file: 'bgm.wav', title: 't', source: 'Pixabay', license: 'CC0', licenseUrl: 'https://example.com/license', retrieved: '2026-01-01' }]);
  return dir;
}
const loud = (file, args = []) => {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', [...args, 'volumedetect'].join(','), '-f', 'null', '-']);
  return Number(r.stderr.match(/mean_volume: (-?[\d.]+) dB/)[1]);
};
test('混音：时长精确、响度达标、BGM循环、gate mix通过', () => {
  const dir = mixProject();
  success(node('mix.mjs', dir));
  const d = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'mix.wav')]).stdout);
  assert.ok(Math.abs(d - 10) < 0.002, '时长' + d);
  const meta = readJson(join(dir, 'mix.meta.json'));
  assert.ok(Math.abs(meta.measured.i - -16) <= 1.5 && meta.measured.tp <= -1);
  assert.ok(meta.bgm.loops >= 3, 'BGM5秒应循环铺满10秒');
  success(node('gate.mjs', dir, '--stage', 'mix'));
});
test('混音：人声段BGM被压低（闪避生效）', () => {
  const dir = mixProject({ silentAfter: 5 });
  json(dir, 'mix.json', { bgm: { file: 'bgm.wav', fadeIn: 0, fadeOut: 0 } });
  success(node('mix.mjs', dir));
  const band = ['bandpass=f=220:width_type=h:w=40'];
  const withVoice = loud(join(dir, 'mix.wav'), ['atrim=1:3', ...band]), without = loud(join(dir, 'mix.wav'), ['atrim=7:9', ...band]);
  assert.ok(without - withVoice > 4, `闪避不足: 有人声${withVoice}dB 无人声${without}dB`);
});
test('混音：配置非法、BGM缺失、授权登记缺失均失败', () => {
  const dir = mixProject();
  for (const mix of [{ sfx: [{ type: 'boom', at: 1 }] }, { sfx: [{ type: 'ping', at: 99 }] }, { bgm: { file: 'nope.wav' } }, { bgm: { file: '../x.wav' } }, { bgm: { file: 'bgm.wav', gainDb: 5 } }]) {
    json(dir, 'mix.json', mix); failed(node('mix.mjs', dir));
  }
  json(dir, 'mix.json', { bgm: { file: 'bgm.wav' } }); success(node('mix.mjs', dir));
  json(dir, 'assets.json', []);
  let r = node('gate.mjs', dir, '--stage', 'mix'); failed(r); assert.match(r.stdout, /FAIL  BGM已在assets/);
  json(dir, 'assets.json', [{ type: 'bgm', file: 'bgm.wav', title: 't', source: 's', license: 'CC BY 4.0', licenseUrl: 'https://x.test/l', retrieved: '2026-01-01' }]);
  r = node('gate.mjs', dir, '--stage', 'mix'); failed(r); assert.match(r.stdout, /署名|attribution/);
  json(dir, 'assets.json', [{ type: 'bgm', file: 'bgm.wav', title: 't', source: 's', license: 'CC BY 4.0', licenseUrl: 'https://x.test/l', retrieved: '2026-01-01', attribution: 'x by y' }]);
  success(node('gate.mjs', dir, '--stage', 'mix'));
});
test('混音：改配音、改配置或篡改mix.wav后gate失败', () => {
  const dir = mixProject(); success(node('mix.mjs', dir));
  const mix = readJson(join(dir, 'mix.json')); mix.bgm.gainDb = -12; json(dir, 'mix.json', mix);
  let r = node('gate.mjs', dir, '--stage', 'mix'); failed(r); assert.match(r.stdout, /FAIL  混音配置及BGM文件未变/);
  success(node('mix.mjs', dir)); success(node('gate.mjs', dir, '--stage', 'mix'));
  const tl = readJson(join(dir, 'timeline.json')); tl.voiceHash = 'x'; json(dir, 'timeline.json', tl);
  failed(node('gate.mjs', dir, '--stage', 'mix')); failed(node('mix.mjs', dir));
  tl.voiceHash = audioHash(join(dir, 'voice.wav')); json(dir, 'timeline.json', tl); success(node('mix.mjs', dir));
  writeFileSync(join(dir, 'mix.wav'), wav(10));
  r = node('gate.mjs', dir, '--stage', 'mix'); failed(r); assert.match(r.stdout, /FAIL  mix.wav存在/);
});
test('非事实句含数字只警告；语速异常可用speedOk说明放行；钩子超时信息可操作', () => {
  const dir = project(); complete(dir);
  const script = readJson(join(dir, 'script.json'));
  script.sentences[0].text = '此时明军损失五十万人？'; json(dir, 'script.json', script);
  let r = node('gate.mjs', dir, '--stage', 'script'); assert.match(r.stdout, /WARN  非事实句含数字/);
  script.sentences[0].text = '甲乙丙丁戊己？'; json(dir, 'script.json', script);
  let tl = readJson(join(dir, 'timeline.json')); tl.items[0].end = tl.items[0].start + 0.5; json(dir, 'timeline.json', tl);
  r = node('gate.mjs', dir, '--stage', 'voice'); assert.match(r.stdout, /FAIL  语速无异常.*s001\(\d/);
  script.sentences[0].speedOk = '试听确认为快节奏长句'; json(dir, 'script.json', script);
  assert.doesNotMatch(node('gate.mjs', dir, '--stage', 'voice').stdout, /FAIL  语速无异常/);
  tl = readJson(join(dir, 'timeline.json')); tl.items[0].end = 6; json(dir, 'timeline.json', tl);
  r = node('gate.mjs', dir, '--stage', 'voice'); assert.match(r.stdout, /FAIL  钩子≤5秒  实测6\.00秒：缩短钩子句/);
});
test('export门核对output.mp4的画幅、帧率、时长、音轨与字幕范围', () => {
  const dir = project(); complete(dir);
  const proj = readJson(join(dir, 'project.json')); proj.confirmed.export = 1; json(dir, 'project.json', proj);
  const total = readJson(join(dir, 'timeline.json')).total;
  const make = (size, rate, extra = []) => success(run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${size}:r=${rate}:d=${total}`, '-i', join(dir, 'voice.wav'), '-t', String(total), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ...extra, join(dir, 'output.mp4')]));
  make('1920x1080', 30); success(node('gate.mjs', dir, '--stage', 'export'));
  make('1280x720', 30); let r = node('gate.mjs', dir, '--stage', 'export'); failed(r); assert.match(r.stdout, /画幅1280×720，应为1920×1080/);
  make('1920x1080', 25); r = node('gate.mjs', dir, '--stage', 'export'); failed(r); assert.match(r.stdout, /帧率25\.00，应为30/);
  proj.fps = 25; json(dir, 'project.json', proj); success(node('gate.mjs', dir, '--stage', 'export'));
  proj.engine = 'hyperframes'; json(dir, 'project.json', proj); r = node('gate.mjs', dir, '--stage', 'export'); failed(r); assert.match(r.stdout, /FAIL  fps及画幅配置有效/);
  proj.engine = 'remotion'; json(dir, 'project.json', proj); success(node('gate.mjs', dir, '--stage', 'export'));
  success(run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=25:d=${total}`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'output.mp4')]));
  r = node('gate.mjs', dir, '--stage', 'export'); failed(r); assert.match(r.stdout, /无音轨/);
});
test('转场overlap不计入逻辑时长；非法overlap失败', () => {
  const dir = project(); complete(dir);
  const shots = readJson(join(dir, 'shots.json'));
  shots.shots[0].overlap = 0.5; json(dir, 'shots.json', shots);
  success(node('gate.mjs', dir));
  for (const bad of [-1, 3, 'x', 99]) { shots.shots[0].overlap = bad; json(dir, 'shots.json', shots); failed(node('gate.mjs', dir, '--stage', 'plan')); }
  shots.shots[0].overlap = 0; shots.shots[1].overlap = 0.5; json(dir, 'shots.json', shots);
  failed(node('gate.mjs', dir, '--stage', 'plan'));
});
test('钩子未确认时plan/voice/subs门失败', () => {
  const dir = project(); complete(dir);
  const proj = readJson(join(dir, 'project.json')); delete proj.confirmed.hook; json(dir, 'project.json', proj);
  for (const stage of ['plan', 'voice', 'subs']) { const r = node('gate.mjs', dir, '--stage', stage); failed(r); assert.match(r.stdout, /FAIL  开场钩子已确认/); }
  success(node('gate.mjs', dir, '--stage', 'script'));
});
test('cover门要求导出已确认且最终标题已确认', () => {
  const dir = project(); complete(dir);
  const proj = readJson(join(dir, 'project.json'));
  let r = node('gate.mjs', dir, '--stage', 'cover'); failed(r); assert.match(r.stdout, /FAIL  成片已确认导出/);
  proj.confirmed.export = 1; proj.title = '土木堡'; json(dir, 'project.json', proj);
  r = node('gate.mjs', dir, '--stage', 'cover'); failed(r); assert.match(r.stdout, /FAIL  最终标题已确认/);
  proj.confirmed.title = '另一个标题'; json(dir, 'project.json', proj); failed(node('gate.mjs', dir, '--stage', 'cover'));
  proj.confirmed.title = '土木堡'; json(dir, 'project.json', proj); success(node('gate.mjs', dir, '--stage', 'cover'));
});
test('未知配方、过期方案和漏句镜头均失败', () => {
  const dir = project(); complete(dir);
  const shots = readJson(join(dir, 'shots.json'));
  shots.scriptVersion = 0; shots.shots[0].recipe = 'invented'; shots.shots.pop(); json(dir, 'shots.json', shots);
  failed(node('gate.mjs', dir, '--stage', 'plan'));
});
test('无音频时间轴不能通过voice门', () => {
  const dir = project(); success(node('timeline.mjs', dir, '--no-audio'));
  const r = node('gate.mjs', dir, '--stage', 'voice'); failed(r); assert.match(r.stdout, /FAIL  voice.wav/);
});
test('钩子索引无效不得以零秒通过', () => {
  const dir = project(); complete(dir);
  const script = readJson(join(dir, 'script.json')); script.hookSentences = 99; json(dir, 'script.json', script);
  failed(node('gate.mjs', dir, '--stage', 'voice'));
});
test('改TTS文本或篡改音频使配音缓存失效', () => {
  const dir = project(), script = readJson(join(dir, 'script.json'));
  script.sentences[0].tts = '换了一句话？'; json(dir, 'script.json', script);
  failed(node('timeline.mjs', dir));
  failed(node('trim.mjs', dir));
  delete script.sentences[0].tts; json(dir, 'script.json', script);
  writeFileSync(join(dir, 'audio/trim/s001.wav'), wav(3)); failed(node('timeline.mjs', dir));
});
test('trim复用正确缓存，阈值改变后真实重裁剪', () => {
  const dir = project();
  success(node('trim.mjs', dir, '--threshold', '-45dB'));
  const durations = readJson(join(dir, 'durations.json'));
  assert.equal(durations.items.s001.threshold, '-45dB');
  assert.ok(durations.items.s001.duration > 1.9);
  success(node('timeline.mjs', dir));
});
test('带标点的不同长度替换按非标点坐标映射，字幕使用真实覆盖区间', () => {
  const dir = project(1), script = readJson(join(dir, 'script.json'));
  const s = script.sentences[0]; s.text = '甲，21年，乙？'; s.tts = '甲，二十一年，乙？'; s.map = [[1, 3, 1, 4]];
  assert.deepEqual(displayRanges(s), [[0, 1], [1, 3], [2, 4], [4, 5], [5, 6]]);
  json(dir, 'script.json', script);
  const raw = join(dir, 'audio/raw/s001.mp3'), hash = audioHash(join(dir, 'audio/trim/s001.wav'));
  json(dir, 'audio/raw/s001.mp3.json', { ...ttsSpec(s.tts), audioHash: audioHash(raw) });
  const durations = readJson(join(dir, 'durations.json')); durations.items.s001.tts = s.tts; json(dir, 'durations.json', durations);
  const chars = contentChars(s.tts).map((c, i) => ({ c, s: i / 3, e: (i + 1) / 3 }));
  json(dir, 'align.json', { schema: 2, timebase: 'sentence', items: { s001: { tts: s.tts, audioHash: hash, chars } } });
  success(node('timeline.mjs', dir)); success(node('srt.mjs', dir, '--max', '1'));
  const subs = readJson(join(dir, 'subs.json'));
  assert.deepEqual(subs.map(b => b.t), ['甲', '21年', '乙？']);
  assert.equal(subs[1].s, 0.333333); assert.equal(subs[1].e, 1.666667); assert.equal(subs[2].s, 1.666667);
});
test('长度变化缺map、重叠map、旧绝对时间缓存不得兜底', () => {
  assert.throws(() => displayRanges({ id: 's001', text: '21年', tts: '二十一年' }), /map/);
  assert.throws(() => displayRanges({ id: 's001', text: '21年', tts: '二十一年', map: [[0, 2, 0, 3], [1, 2, 1, 3]] }), /map/);
  const dir = project(); complete(dir); json(dir, 'align.json', { s001: { chars: [] } }); failed(node('srt.mjs', dir));
});
test('漏字、null时间和倒序时间必须失败', () => {
  const dir = project(); complete(dir);
  const original = readJson(join(dir, 'align.json'));
  for (const mutate of [a => a.items.s001.chars.shift(), a => a.items.s001.chars[0].s = null, a => a.items.s001.chars[1].s = 0]) {
    const a = structuredClone(original); mutate(a); json(dir, 'align.json', a);
    failed(node('srt.mjs', dir)); failed(node('gate.mjs', dir));
  }
});
test('即使时间仍在句界内，过期字幕和不同步SRT也失败', () => {
  const dir = project(); complete(dir);
  const subs = readJson(join(dir, 'subs.json')); subs[0].s += 0.1; json(dir, 'subs.json', subs);
  failed(node('gate.mjs', dir));
  success(node('srt.mjs', dir)); writeFileSync(join(dir, 'output.srt'), '损坏字幕'); failed(node('gate.mjs', dir));
});
test('局部改音频后复用未变句内对齐，并正确移动后续字幕', () => {
  const dir = project(); complete(dir);
  const old = readJson(join(dir, 'align.json')).items.s002;
  const trim = join(dir, 'audio/trim/s001.wav'), raw = join(dir, 'audio/raw/s001.mp3');
  writeFileSync(trim, wav(3)); success(run('ffmpeg', ['-v', 'error', '-y', '-i', trim, raw]));
  const sentence = readJson(join(dir, 'script.json')).sentences[0], hash = audioHash(trim);
  json(dir, 'audio/raw/s001.mp3.json', { ...ttsSpec(sentence.text), audioHash: audioHash(raw) });
  const durations = readJson(join(dir, 'durations.json'));
  durations.items.s001 = { duration: 3, tts: sentence.text, rawHash: audioHash(raw), audioHash: hash }; json(dir, 'durations.json', durations);
  success(node('timeline.mjs', dir));
  const shim = join(dir, 'python-shim'); mkdirSync(shim);
  writeFileSync(join(shim, 'whisperx.py'), 'def load_align_model(**kw):\n return None, {}\ndef load_audio(path):\n return None\ndef align(seg, model, meta, audio, device, **kw):\n assert seg[0]["start"] == 0\n text = seg[0]["text"]; dur = seg[0]["end"]; n = len(text)-1\n return {"segments": [{"chars": [{"char": c, "start": i*dur/n if i<n else None, "end": (i+1)*dur/n if i<n else None} for i,c in enumerate(text)]}]}\n');
  success(run(python, [join(scripts, 'align.py'), dir, '--ids', 's001'], { PYTHONPATH: shim }));
  assert.deepEqual(readJson(join(dir, 'align.json')).items.s002, old);
  success(node('srt.mjs', dir));
  const next = readJson(join(dir, 'subs.json')).find(b => b.id === 's002'); assert.equal(next.s, 3.35);
  success(run(python, [join(scripts, 'align.py'), dir], { PYTHONPATH: shim }));
});
test('TTS --ids会重做已有文件，默认复用缓存，文本变化会自动重做', async () => {
  const dir = project(), calls = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', b => body += b); req.on('end', () => {
      calls.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 3000, data: sampleMp3Raw.toString('base64') }));
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const env = { DOUBAO_TTS_APPID: 'test', DOUBAO_TTS_TOKEN: 'test', HV_TTS_URL: 'http://127.0.0.1:' + server.address().port + '/api/v1/tts' };
  const tts = (...a) => promisify(execFile)(process.execPath, [join(scripts, 'tts.mjs'), dir, ...a], { env: { ...process.env, ...env }, timeout: 30000 });
  try {
    await tts();
    assert.equal(calls.length, 0, '缓存完全匹配时不应请求');
    await tts('--ids', 's001,s002');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].auth, 'Bearer;test');
    assert.equal(calls[0].body.audio.speed_ratio, 1.1); assert.equal(calls[0].body.request.operation, 'query');
    assert.notEqual(calls[0].body.request.reqid, calls[1].body.request.reqid);
    const script = readJson(join(dir, 'script.json')); script.sentences[0].tts = '另一句话？'; json(dir, 'script.json', script);
    await tts();
    assert.equal(calls.length, 3);
    assert.equal(readJson(join(dir, 'audio/raw/s001.mp3.json')).text, '另一句话？');
    await assert.rejects(tts('--ids', 'nope'));
  } finally { await new Promise(done => server.close(done)); }
});
test('参考图请求实际携带transparent及多行提示词；.env尺寸生效', async () => {
  const dir = project(), received = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', b => body += b); req.on('end', () => {
      received.push({ url: req.url, body }); res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' }] }));
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    writeFileSync(join(dir, '.env'), 'HV_IMAGE_SIZE=1536x1024\n');
    const reference = join(dir, 'reference.png'); writeFileSync(reference, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
    const out = join(dir, 'generated.png');
    await promisify(execFile)(process.execPath, [join(scripts, 'imagegen.mjs'), '--prompt', 'first line\nsecond line', '--out', out, '--ref', reference, '--background', 'transparent'], { env: { ...process.env, HV_IMAGE_BASE_URL: base, HV_IMAGE_API_KEY: 'test', HV_IMAGE_SIZE: '' }, timeout: 20000 });
    assert.equal(received[0].url, '/v1/images/edits');
    assert.match(received[0].body, /name="background"\r\n\r\ntransparent/);
    assert.match(received[0].body, /first line\nsecond line/); assert.match(received[0].body, /1536x1024/);
    assert.equal(readJson(out + '.json').background, 'transparent');
    await promisify(execFile)(process.execPath, [join(scripts, 'imagegen.mjs'), '--prompt', 'scene', '--out', out], { env: { ...process.env, HV_IMAGE_BASE_URL: base, HV_IMAGE_API_KEY: 'test', HV_IMAGE_SIZE: '' }, timeout: 20000 });
    assert.equal(received[1].url, '/v1/images/generations'); assert.equal(JSON.parse(received[1].body).size, '1536x1024');
  } finally { await new Promise(done => server.close(done)); }
});
test('320句实际拼接达到10–20分钟且无Windows命令行长度问题', () => {
  const dir = project(320); complete(dir);
  success(node('gate.mjs', dir));
  const probe = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'voice.wav')]); success(probe);
  assert.ok(Math.abs(Number(probe.stdout.trim()) - (320 * 2 + 319 * 0.35 + 2)) < 0.002);
});

test('配音单句≤40字：正文可更长，超限按TTS文本判定', () => {
  const dir = project(), file = join(dir, 'script.json'), script = readJson(file);
  // 正文靠标点撑到50字符，实际内容25字，TTS 25字：应通过
  script.sentences = [{ id: 's001', text: '甲，'.repeat(24) + '甲？', tts: '甲'.repeat(24) + '甲？', fact: false }];
  json(dir, 'script.json', script);
  success(node('gate.mjs', dir, '--stage', 'script'));
  // TTS 内容45字：应失败，且报错指向配音单句
  script.sentences = [{ id: 's001', text: '甲，'.repeat(44) + '甲？', tts: '甲'.repeat(44) + '甲？', fact: false }];
  json(dir, 'script.json', script);
  const r = node('gate.mjs', dir, '--stage', 'script');
  failed(r); assert.match(r.stdout, /配音单句≤40字/);
});

test('口播验收记录缺失、版本不符或未声明试听状态均失败', () => {
  const dir = project(), review = join(dir, 'script-review.md');
  rmSync(review);
  failed(node('gate.mjs', dir, '--stage', 'script'));
  assert.match(node('gate.mjs', dir, '--stage', 'script').stdout, /script-review\.md/);
  writeFileSync(review, 'review-version: 2\nreview-audio: 未试听\n');
  assert.match(node('gate.mjs', dir, '--stage', 'script').stdout, /不一致/);
  writeFileSync(review, 'review-version: 1\n');
  assert.match(node('gate.mjs', dir, '--stage', 'script').stdout, /review-audio/);
  writeFileSync(review, 'review-version: 1\nreview-audio: 未试听\n');
  success(node('gate.mjs', dir, '--stage', 'script'));
});

test('文风体检只报告不阻断，指标可被基线对比', () => {
  const dir = project(), r = node('style-report.mjs', dir, '--json');
  success(r);
  const out = JSON.parse(r.stdout);
  assert.equal(out.metrics.sentences, 2);
  assert.ok(Array.isArray(out.hints));
  // 碎句、设问密集时给出提示，但仍不改退出码
  const file = join(dir, 'script.json'), script = readJson(file);
  script.sentences = Array.from({ length: 20 }, (_, i) => ({ id: 's' + String(i + 1).padStart(3, '0'), text: '甲？乙？', fact: false }));
  json(dir, 'script.json', script);
  const hot = node('style-report.mjs', dir, '--json');
  success(hot);
  assert.ok(JSON.parse(hot.stdout).hints.length > 0);
  failed(node('style-report.mjs', dir, '--json', '--strict'));
});
