// 确定性检查；不证明史实或审美正确。默认subs检查全部产物。
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson, checkAudio, audioHash, safeId, ttsText, pauseOf, PAUSE_PLAIN_MAX, TAIL_MAX } from './audio-cache.mjs';
import { alignedTimes, displayRanges, buildSubtitles, srtText } from './subtitle-data.mjs';
import { MIX_VERSION, TARGET, validateMix, configHash, probeDuration, measureLoudness } from './mix-lib.mjs';

const dir = process.argv[2], ix = process.argv.indexOf('--stage');
const stage = ix < 0 ? 'subs' : process.argv[ix + 1];
if (!dir || !['script', 'plan', 'voice', 'subs', 'mix', 'export', 'cover'].includes(stage)) {
  console.error('usage: node gate.mjs <project> [--stage script|plan|voice|subs|mix|export|cover]'); process.exit(2);
}
const res = [], warnings = [];
const gate = (name, ok, detail = '') => res.push({ name, ok: !!ok, detail });
const attempt = (name, fn) => { try { fn(); gate(name, true); } catch (e) { gate(name, false, e.message); } };
const load = file => {
  try { return readJson(join(dir, file)); }
  catch { gate(file + '存在且为有效JSON', false); return null; }
};
const proj = load('project.json'), script = load('script.json');
const squash = s => s.normalize('NFKC').replace(/[\s　]+/g, '');
const expectedPause = i => { try { return pauseOf(script, i); } catch { return NaN; } };
const fps = Number.isFinite(proj?.fps) && proj.fps > 0 ? proj.fps : 30;
const hookTarget = proj?.hookTargetSeconds === undefined ? 5 : proj.hookTargetSeconds;
const validHookTarget = Number.isFinite(hookTarget) && hookTarget > 0;
gate('钩子时长提醒配置有效', validHookTarget, validHookTarget ? '' : 'hookTargetSeconds须为正数');
const positiveVersion = x => Number.isInteger(x) && x > 0;
let sentences = [], ids = [];
if (script) {
  sentences = Array.isArray(script.sentences) ? script.sentences : [];
  ids = sentences.map(s => s.id);
  gate('稿子版本有效', positiveVersion(script.version));
  gate('句子非空、ID合法且唯一', sentences.length && ids.every(safeId) && new Set(ids).size === ids.length);
  gate('文案及TTS文本有效', sentences.every(s => typeof s.text === 'string' && s.text.trim() && typeof ttsText(s) === 'string' && ttsText(s).trim()));
  // 40字是配音切句的技术上限，不是文风要求（见 research.md「解说文风」）；正文句允许更长，由字幕自动分块。
  gate('配音单句≤40字（正文句长不设限）', sentences.every(s => [...String(ttsText(s) ?? '')].length <= 40));
  const tooLong = sentences.filter(s => [...String(s.text ?? '')].length > 60).map(s => s.id);
  if (tooLong.length) warnings.push('正文单句超过60字：' + tooLong.slice(0, 8).join(',') + (tooLong.length > 8 ? '等' + tooLong.length + '句' : '') + '。字幕会自动分块，确认节奏与可读性');
  gate('TTS文本无阿拉伯数字', sentences.every(s => !/\d/.test(ttsText(s))));
  gate('每句标明是否事实', sentences.every(s => typeof s.fact === 'boolean'));
  const numeric = /\d|[零〇一二三四五六七八九十百千万亿两]+(年|万|亿)|[十百千万亿][余多]?(人|骑|兵|户|里)/;
  const sneaky = sentences.filter(s => s.fact === false && typeof s.text === 'string' && numeric.test(s.text)).map(s => s.id);
  if (sneaky.length) warnings.push('非事实句含数字/年份/数量：' + sneaky.slice(0, 8).join(',') + (sneaky.length > 8 ? '等' + sneaky.length + '句' : '') + '。确认是评论而非事实，事实句须标fact:true并配证据');
  attempt('显示文字与TTS映射有效', () => sentences.forEach(displayRanges));
  let pauses = null;
  attempt('停顿及结尾留白有效', () => { pauses = sentences.map((_, i) => pauseOf(script, i)); });
  gate('长停顿(>' + PAUSE_PLAIN_MAX + 's)须写pauseWhy', !pauses || sentences.every((s, i) =>
    i === sentences.length - 1 || pauses[i] <= PAUSE_PLAIN_MAX || (typeof s.pauseWhy === 'string' && s.pauseWhy.trim())));
  if (pauses && sentences.length >= 20) {
    const body = pauses.slice(0, -1), counts = new Map();
    body.forEach(p => counts.set(p, (counts.get(p) ?? 0) + 1));
    if (Math.max(...counts.values()) / body.length >= 0.8) warnings.push('句间停顿80%以上相同：节奏单一，人工检查转折、段落处是否需要更长停顿');
  }
  const hooks = Array.isArray(script.hooks) ? script.hooks : [];
  gate('开场钩子候选=3且有依据', hooks.length === 3 && hooks.every(h => h.text?.trim() && h.evidence?.trim()));
  gate('钩子句数有效', Number.isInteger(script.hookSentences) && script.hookSentences > 0 && script.hookSentences <= sentences.length);
  gate('标题候选3–5', Array.isArray(script.titles) && script.titles.length >= 3 && script.titles.length <= 5 && script.titles.every(t => typeof t === 'string' && t.trim()));
  gate('结尾为提问', /[？?]/.test((sentences.at(-1)?.text ?? '').slice(-30)));
  const evidence = Array.isArray(script.evidence) ? script.evidence : [];
  const covered = new Set(evidence.flatMap(e => e.ids ?? []));
  gate('事实句均有证据记录', sentences.every(s => !s.fact || covered.has(s.id)));
  gate('证据有出处定位且已标记核实', evidence.every(e => Array.isArray(e.ids) && e.ids.length && e.ids.every(id => ids.includes(id)) &&
       e.claim?.trim() && e.source?.trim() && e.locator?.trim() && e.status === 'verified'));
  const snaps = new Map();
  const snapText = rel => {
    if (typeof rel !== 'string' || !rel.trim() || isAbsolute(rel)) return null;
    const file = resolve(dir, rel);
    if (relative(resolve(dir), file).startsWith('..') || !existsSync(file)) return null;
    if (!snaps.has(file)) snaps.set(file, squash(readFileSync(file, 'utf8')));
    return snaps.get(file);
  };
  const anchorBad = [];
  evidence.forEach((e, i) => {
    const text = snapText(e.snapshot), quote = squash(e.quote ?? '');
    if ([...quote].length < 8) anchorBad.push('#' + i + '摘录过短或缺失');
    else if (text === null) anchorBad.push('#' + i + '快照文件缺失或越界');
    else if (!text.includes(quote)) anchorBad.push('#' + i + '摘录不在快照中');
  });
  gate('证据摘录可在原文快照中检索到', evidence.length === 0 || !anchorBad.length, anchorBad.slice(0, 5).join('；'));
  gate('无标题党套话', sentences.every(s => !/史书不敢写|所有人都被骗|震惊|惊天/.test(s.text)));
  // 口播人工验收痕迹：只校验"做过、且是当前版本"，不判断写得好不好（质量仍须人工）。
  // 已确认导出的历史工程不追溯否定，只警告；未导出的稿子必须补齐记录。
  let reviewProblem = null;
  try {
    const file = join(dir, 'script-review.md');
    const hint = `在 script-review.md 首部写 review-version: ${script.version} 与 review-audio: 已试听|未试听`;
    if (!existsSync(file)) throw new Error('缺少 script-review.md：' + hint);
    const head = readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 12).join('\n');
    const v = head.match(/^\s*review-version:\s*(\d+)\s*$/m), a = head.match(/^\s*review-audio:\s*(已试听|未试听)\s*$/m);
    if (!v) throw new Error('script-review.md 首部缺少 review-version：' + hint);
    if (Number(v[1]) !== script.version) throw new Error(`验收记录版本 ${v[1]} 与稿子版本 ${script.version} 不一致：改稿后须复核受影响部分并更新该行`);
    if (!a) throw new Error('script-review.md 首部缺少 review-audio: 已试听 或 未试听（未试听音频时不得声称做过听觉验收）');
  } catch (e) { reviewProblem = e.message; }
  if (!reviewProblem) gate('口播验收记录存在且版本匹配', true);
  else if (proj?.confirmed?.export != null) warnings.push('口播验收记录未覆盖当前稿子（已确认导出，不追溯否定）：' + reviewProblem);
  else gate('口播验收记录存在且版本匹配', false, reviewProblem);
}
if (stage !== 'script') {
  gate('当前稿子已确认', script && proj?.confirmed?.script === script.version);
  gate('开场钩子已确认（confirmed.hook等于稿子版本）', script && proj?.confirmed?.hook === script.version);
}
if (stage === 'cover') {
  const title = proj?.title;
  gate('成片已确认导出', !!proj?.confirmed?.export);
  gate('最终标题已确认且与project.title一致', typeof title === 'string' && title.trim() && proj?.confirmed?.title === title);
}

let timeline = null, durations = null;
if (stage === 'mix') {
  timeline = load('timeline.json');
  const mix = load('mix.json'), meta = load('mix.meta.json');
  if (mix && timeline && script && meta) {
    attempt('混音配置有效', () => validateMix(dir, mix, timeline.total));
    gate('混音版本、稿子版本与配音一致', meta.version === MIX_VERSION && meta.scriptVersion === script.version &&
         timeline.version === script.version && !!timeline.voiceHash && meta.voiceHash === timeline.voiceHash);
    attempt('混音配置及BGM文件未变（否则重跑mix）', () => { if (meta.configHash !== configHash(dir, mix)) throw new Error('mix.json或BGM已变'); });
    attempt('mix.wav存在、内容匹配、时长等于配音总时长', () => {
      const f = join(dir, 'mix.wav');
      if (!existsSync(f) || audioHash(f) !== meta.mixHash) throw new Error('mix.wav缺失或被改动');
      if (Math.abs(probeDuration(f) - timeline.total) > 0.002) throw new Error('mix.wav时长与配音总时长不符');
    });
    attempt('响度在目标范围且真峰值未削波', () => {
      const m = measureLoudness(join(dir, 'mix.wav'));
      if (Math.abs(m.i - TARGET.lufs) > TARGET.lufsTol) throw new Error('积分响度' + m.i.toFixed(1) + 'LUFS，目标' + TARGET.lufs + '±' + TARGET.lufsTol);
      if (m.tp > TARGET.tpMax) throw new Error('真峰值' + m.tp.toFixed(1) + 'dBTP，须≤' + TARGET.tpMax);
    });
    // BGM来源与授权：必须在assets.json登记，且有授权页链接
    if (mix.bgm) attempt('BGM已在assets.json登记来源、授权页与取用日期', () => {
      const assets = readJson(join(dir, 'assets.json')), list = Array.isArray(assets) ? assets : (assets.items ?? assets.bgm ?? []);
      const rec = list.find(a => a && a.type === 'bgm' && a.file === mix.bgm.file);
      if (!rec) throw new Error('assets.json缺少 type:"bgm", file:"' + mix.bgm.file + '" 的记录');
      for (const k of ['title', 'source', 'license', 'licenseUrl', 'retrieved'])
        if (typeof rec[k] !== 'string' || !rec[k].trim()) throw new Error('BGM记录缺少' + k);
      if (!/^https?:\/\//.test(rec.licenseUrl)) throw new Error('licenseUrl须为http(s)链接');
      if (/\bBY\b|署名|attribution/i.test(rec.license) && !(rec.attribution ?? '').trim()) throw new Error('该授权需署名，请填attribution');
    });
    if (!mix.bgm) warnings.push('mix.json未配置BGM');
  }
}
if (stage === 'voice' || stage === 'subs') {
  timeline = load('timeline.json'); durations = load('durations.json');
  if (timeline && script && durations) {
    gate('时间轴及裁剪记录版本匹配', timeline.version === script.version && durations.version === script.version);
    const items = Array.isArray(timeline.items) ? timeline.items : [];
    gate('时间轴逐句覆盖且顺序匹配', items.length === sentences.length && items.every((it, i) => it.id === ids[i] && it.tts === ttsText(sentences[i])));
    const range = proj?.durationMinutes ?? { min: 10, max: 20 };
    const validRange = Number.isFinite(range.min) && Number.isFinite(range.max) && range.min > 0 && range.max >= range.min;
    gate('总时长有效且时长范围配置合法', validRange && Number.isFinite(timeline.total) && timeline.total > 0);
    if (validRange && Number.isFinite(timeline.total) && (timeline.total < range.min * 60 || timeline.total > range.max * 60))
      warnings.push('总时长' + (timeline.total / 60).toFixed(1) + '分钟，超出' + range.min + '–' + range.max + '分钟：内容自然如此可保留，否则检查注水或压缩');
    gate('首句从0开始', items[0]?.start === 0);
    const hookEnd = Number.isInteger(script.hookSentences) && script.hookSentences > 0 ? items[script.hookSentences - 1]?.end : NaN;
    gate('钩子实测时长有效', Number.isFinite(hookEnd) && hookEnd > 0);
    if (validHookTarget && Number.isFinite(hookEnd) && hookEnd > hookTarget)
      warnings.push('开场钩子实测' + hookEnd.toFixed(2) + '秒，超过提醒目标' + hookTarget + '秒：人工复查入题与初步兑现，不为达标截断表达或统一加速');
    gate('时长、停顿及相邻偏移一致', items.length && items.every((it, i) =>
      Number.isFinite(it.start) && Number.isFinite(it.end) && it.start >= 0 && it.end > it.start &&
      Number.isFinite(it.pause) && it.pause >= 0 && it.pause <= TAIL_MAX &&
      Math.abs((items[i + 1]?.start ?? timeline.total) - it.end - it.pause) < 1 / 48000 + 1e-9 &&
      Math.abs(it.pause - expectedPause(i)) < 1 / 48000 + 1e-9));
    attempt('逐句配音缓存及实测时长匹配', () => {
      if (!items.length || items.length !== sentences.length) throw new Error('时间轴不完整');
      items.forEach((it, i) => {
        const record = durations.items?.[it.id], hash = checkAudio(dir, sentences[i], record);
        if (it.audioHash !== hash || Math.abs(it.end - it.start - record.duration) > 1 / 48000)
          throw new Error(it.id + ' 时间轴音频或时长失效');
      });
    });
    attempt('voice.wav存在、内容及时长匹配', () => {
      const voice = join(dir, 'voice.wav');
      if (!timeline.voiceHash || audioHash(voice) !== timeline.voiceHash) throw new Error('完整配音缺失或缓存失效');
      const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', voice], { encoding: 'utf8' });
      const seconds = Number(r.stdout?.trim());
      if (r.error || r.status !== 0 || !Number.isFinite(seconds) || Math.abs(seconds - timeline.total) > 0.002)
        throw new Error('完整配音时长与时间轴不匹配');
    });
    const odd = items.map((it, i) => {
      const n = [...ttsText(sentences[i] ?? { text: '' })].filter(c => /\p{Script=Han}/u.test(c)).length;
      return { id: it.id, n, speed: n / (it.end - it.start), waived: typeof sentences[i]?.speedOk === 'string' && !!sentences[i].speedOk.trim() };
    }).filter(x => x.n > 3 && (x.speed > 7.5 || x.speed < 2.5) && !x.waived);
    gate('语速无异常（异常句试听后重做；确认无误可在句子上写speedOk说明）', !odd.length, odd.map(x => x.id + '(' + x.speed.toFixed(1) + '字/秒)').join(','));
  }
}

let shots = null;
if (stage === 'plan' || stage === 'subs') {
  shots = load('shots.json');
  if (shots && script) {
    const list = Array.isArray(shots.shots) ? shots.shots : [];
    const recipes = ['parallax-dolly', 'crane-reveal', 'focus-pull', 'scroll-pan', 'detail-hunt', 'map-fly',
                     'data-morph', 'ink-transition', 'match-cut', 'light-shift', 'split-time', 'evidence-hold'];
    gate('镜头方案版本匹配稿子', positiveVersion(shots.version) && shots.scriptVersion === script.version);
    gate('镜头非空、ID合法且唯一', list.length && list.every(x => safeId(x.id)) && new Set(list.map(x => x.id)).size === list.length);
    gate('镜头时长及景别有效', list.every(x => Number.isFinite(x.dur) && x.dur > 0 && ['wide', 'medium', 'close'].includes(x.size)));
    gate('主配方合法', list.every(x => recipes.includes(x.recipe)));
    gate('镜头关联句子有效且覆盖全文', list.every(x => Array.isArray(x.sids) && x.sids.length && x.sids.every(id => ids.includes(id))) &&
         ids.every(id => list.some(x => x.sids?.includes(id))));
    gate('分层满足配方需要', list.every(x => Array.isArray(x.layers) && x.layers.length >= (x.recipe === 'parallax-dolly' ? 3 : 1) &&
         (!['detail-hunt', 'evidence-hold'].includes(x.recipe) || x.overlay)));
    gate('镜头有落点或静止目的', list.every(x => typeof x.landing === 'string' && x.landing.trim()));
    // dur是逻辑时长（切点，之和必须等于配音总时长）；overlap是转场渲染余量，向后伸入下一镜，不计入dur。
    gate('转场余量overlap有效（0–2秒，末镜为0）', list.every((x, i) => x.overlap === undefined ||
         (Number.isFinite(x.overlap) && x.overlap >= 0 && x.overlap <= 2 && (i < list.length - 1 || x.overlap === 0) &&
          (i === list.length - 1 || x.overlap <= list[i + 1].dur))));
    if (stage === 'subs') {
      gate('当前画面方案已确认', proj?.confirmed?.plan === shots.version);
      gate('镜头逻辑时长之和匹配配音（不含overlap）', timeline && Math.abs(list.reduce((n, x) => n + x.dur, 0) - timeline.total) <= 1 / fps + 1e-9);
    }
    if (list.some((x, i) => i && x.recipe === list[i - 1].recipe)) warnings.push('相邻镜头同配方：人工检查是否有叙事理由');
    if (list.some((x, i) => i > 1 && x.size === list[i - 1].size && x.size === list[i - 2].size)) warnings.push('连续三镜同景别：人工检查节奏');
    if (list.filter(x => x.recipe === 'ink-transition').length > 6) warnings.push('水墨转场较多：人工检查是否重复');
  }
}

if (stage === 'subs') {
  const align = load('align.json'), subs = load('subs.json'), meta = load('subs.meta.json');
  gate('output.srt存在', existsSync(join(dir, 'output.srt')));
  if (align && timeline && script) attempt('逐字对齐完整、缓存及时基有效', () => {
    if (timeline.items.length !== sentences.length) throw new Error('时间轴不完整');
    sentences.forEach((s, i) => alignedTimes(dir, s, timeline.items[i], align));
  });
  if (subs && meta && script && timeline && align) attempt('网页字幕与SRT匹配当前对齐及时间轴', () => {
    if (!Array.isArray(subs) || !subs.length) throw new Error('字幕为空或格式无效');
    if (meta.scriptVersion !== script.version) throw new Error('字幕版本过期');
    const rebuilt = buildSubtitles(dir, script, timeline, align, meta.max);
    if (JSON.stringify(subs) !== JSON.stringify(rebuilt)) throw new Error('字幕文字或时间过期，重跑srt');
    for (let i = 0; i < subs.length; i++) {
      const b = subs[i], item = timeline.items.find(it => it.id === b.id);
      if (!item || !Number.isFinite(b.s) || !Number.isFinite(b.e) || b.s < item.start - 0.000001 || b.e > item.end + 0.002 ||
          b.e <= b.s || (i && b.s < subs[i - 1].e - 0.001)) throw new Error('字幕时长、偏移或顺序无效');
    }
    if (readFileSync(join(dir, 'output.srt'), 'utf8').replace(/\r\n/g, '\n') !== srtText(subs))
      throw new Error('SRT与网页字幕不一致');
  });
}
// 导出核对：编码完成后检查output.mp4是否符合工程声明（默认1920×1080、30fps）。
if (stage === 'export') {
  gate('已确认导出', !!proj?.confirmed?.export);
  const okNum = (x, int) => x === undefined || (Number.isFinite(x) && x > 0 && (!int || Number.isInteger(x)));
  // HyperFrames render的--fps只支持24/30/60（hyperframes-cli文档）；Remotion不受此限。
  const hfFps = (proj?.engine ?? 'remotion') === 'remotion' || proj?.fps === undefined || [24, 30, 60].includes(proj.fps);
  gate('fps及画幅配置有效（HyperFrames仅支持fps 24/30/60）', hfFps && okNum(proj?.fps) && okNum(proj?.width, true) && okNum(proj?.height, true));
  const want = { w: proj?.width ?? 1920, h: proj?.height ?? 1080, fps };
  const tl = load('timeline.json'), subs = load('subs.json');
  attempt('output.mp4画幅、帧率、时长、音轨及字幕范围匹配', () => {
    const file = join(dir, 'output.mp4');
    if (!existsSync(file)) throw new Error('output.mp4不存在');
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,duration:format=duration', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (r.error || r.status !== 0) throw new Error('ffprobe无法读取output.mp4');
    const info = JSON.parse(r.stdout), v = info.streams.find(s => s.codec_type === 'video'), a = info.streams.find(s => s.codec_type === 'audio');
    if (!v) throw new Error('无视频流');
    if (!a) throw new Error('无音轨');
    if (v.width !== want.w || v.height !== want.h) throw new Error('画幅' + v.width + '×' + v.height + '，应为' + want.w + '×' + want.h);
    const [fn, fd] = v.r_frame_rate.split('/').map(Number), real = fn / (fd || 1);
    if (!(Math.abs(real - want.fps) < 0.01)) throw new Error('帧率' + real.toFixed(2) + '，应为' + want.fps);
    const total = tl?.total, dur = Number(info.format.duration);
    if (!Number.isFinite(total) || !Number.isFinite(dur)) throw new Error('缺少时间轴或时长');
    if (Math.abs(dur - total) > 2 / want.fps) throw new Error('时长' + dur.toFixed(3) + 's，配音总时长' + total.toFixed(3) + 's');
    const ad = Number(a.duration);
    if (Number.isFinite(ad) && Math.abs(ad - total) > 0.1) throw new Error('音轨时长' + ad.toFixed(3) + 's与配音总时长不符');
    if (!Array.isArray(subs) || !subs.length || subs.at(-1).e > dur + 0.05) throw new Error('字幕为空或超出视频时长');
  });
  gate('output.srt存在', existsSync(join(dir, 'output.srt')));
}
let failed = 0;
for (const r of res) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  ' + r.detail : ''));
}
warnings.forEach(w => console.log('WARN  ' + w));
console.log((res.length - failed) + '/' + res.length + ' 通过');
process.exit(failed ? 1 : 0);
