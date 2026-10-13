// 混音：voice.wav + BGM（循环交叉淡化、人声闪避）+ 程序合成音效 → 响度归一的mix.wav。
// 用法：node mix.mjs <项目>    配置：<项目>/mix.json（格式见references/project.md）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson, audioHash } from './audio-cache.mjs';
import { MIX_VERSION, TARGET, DUCK, SFX, bgmOpts, bgmPath, validateMix, configHash, probeDuration, measureLoudness, sfxFile } from './mix-lib.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node mix.mjs <project>'); process.exit(2); }
const ff = args => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.error || r.status !== 0) throw new Error('ffmpeg失败: ' + (r.stderr ?? r.error?.message ?? '').trim().split('\n').slice(-3).join(' | '));
};

try {
  const timeline = readJson(join(dir, 'timeline.json')), script = readJson(join(dir, 'script.json'));
  const mix = readJson(join(dir, 'mix.json')), voice = join(dir, 'voice.wav');
  if (timeline.version !== script.version) throw new Error('时间轴版本失效，重跑timeline');
  if (!timeline.voiceHash || audioHash(voice) !== timeline.voiceHash) throw new Error('voice.wav与时间轴不匹配，重跑timeline');
  const T = timeline.total, sec = T.toFixed(6);
  validateMix(dir, mix, T);

  const cues = (mix.sfx ?? []).map(s => ({ gainDb: -10, ...s }));
  mkdirSync(join(dir, 'audio/sfx'), { recursive: true });
  const sfxParams = {};
  for (const type of new Set(cues.map(c => c.type))) {
    ff(['-f', 'lavfi', '-i', SFX[type].src, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', sfxFile(dir, type)]);
    sfxParams[type] = SFX[type].src;
  }
  if (Object.keys(sfxParams).length) writeFileSync(join(dir, 'audio/sfx/params.json'), JSON.stringify(sfxParams, null, 2));

  const inputs = ['-i', voice], f = [];
  let idx = 1, loops = 0;
  f.push('[0:a]aformat=sample_rates=48000:channel_layouts=stereo[v]');
  let mixIn;
  if (mix.bgm) {
    const o = bgmOpts(mix.bgm), file = bgmPath(dir, mix.bgm), d = probeDuration(file), xf = o.loopCrossfade;
    if (d < T) {
      if (d < 2 * xf + 1) throw new Error('BGM过短，无法循环交叉淡化（至少' + (2 * xf + 1) + '秒）');
      loops = Math.ceil((T - xf) / (d - xf));
      if (loops > 30) throw new Error('BGM需循环超过30次，请换更长的曲目');
    } else loops = 1;
    const first = idx;
    for (let i = 0; i < loops; i++) inputs.push('-i', file);
    idx += loops;
    let cur = `[${first}:a]`;
    for (let i = 1; i < loops; i++) { f.push(`${cur}[${first + i}:a]acrossfade=d=${xf}:c1=tri:c2=tri[x${i}]`); cur = `[x${i}]`; }
    const chain = [cur + 'aformat=sample_rates=48000:channel_layouts=stereo', `atrim=duration=${sec}`, 'asetpts=PTS-STARTPTS', `volume=${o.gainDb}dB`];
    if (o.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${o.fadeIn}`);
    if (o.fadeOut > 0) chain.push(`afade=t=out:st=${(T - o.fadeOut).toFixed(6)}:d=${o.fadeOut}`);
    f.push(chain.join(',') + '[b]');
    f.push('[v]asplit=2[v1][v2]');
    f.push(`[b][v1]sidechaincompress=threshold=${DUCK.threshold}:ratio=${DUCK.ratio}:attack=${DUCK.attack}:release=${DUCK.release}:makeup=1[bd]`);
    mixIn = ['[v2]', '[bd]'];
  } else mixIn = ['[v]'];
  cues.forEach((c, k) => {
    inputs.push('-i', sfxFile(dir, c.type));
    const ms = Math.round(c.at * 1000);
    f.push(`[${idx++}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${c.gainDb}dB,adelay=${ms}|${ms}[s${k}]`);
    mixIn.push(`[s${k}]`);
  });
  f.push(mixIn.length === 1 ? `${mixIn[0]}anull[m]` : `${mixIn.join('')}amix=inputs=${mixIn.length}:duration=first:normalize=0:dropout_transition=0[m]`);

  const premix = join(dir, 'audio/premix.wav');
  ff([...inputs, '-filter_complex', f.join(';'), '-map', '[m]', '-ar', '48000', '-c:a', 'pcm_f32le', premix]);
  const a = measureLoudness(premix).raw, N = Math.round(T * 48000);
  const norm = `loudnorm=I=${TARGET.lufs}:TP=${TARGET.tp}:LRA=${TARGET.lra}:measured_I=${a.input_i}:measured_TP=${a.input_tp}:measured_LRA=${a.input_lra}` +
               `:measured_thresh=${a.input_thresh}:offset=${a.target_offset}:linear=true,aresample=48000,apad=whole_len=${N},atrim=end_sample=${N}`;
  const out = join(dir, 'mix.wav');
  ff(['-i', premix, '-af', norm, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out]);

  const m = measureLoudness(out);
  writeFileSync(join(dir, 'mix.meta.json'), JSON.stringify({
    version: MIX_VERSION, scriptVersion: script.version, voiceHash: timeline.voiceHash, configHash: configHash(dir, mix),
    mixHash: audioHash(out), target: TARGET, measured: { i: m.i, tp: m.tp, lra: m.lra },
    bgm: mix.bgm ? { file: mix.bgm.file, loops } : null, sfx: cues.length
  }, null, 2));
  console.log(`mix ok  ${T.toFixed(2)}s  ${m.i.toFixed(1)} LUFS  ${m.tp.toFixed(1)} dBTP` + (loops > 1 ? `  BGM循环${loops}段` : ''));
} catch (e) { console.error(e.message); process.exit(1); }
