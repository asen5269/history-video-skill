// 混音共用：配置校验、程序合成音效定义、响度测量。mix.mjs与gate.mjs共用。
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { audioHash } from './audio-cache.mjs';

export const MIX_VERSION = 1;
// 响度目标：-16 LUFS积分响度、真峰值≤-1.5dBTP（门禁容差±1.5LU、真峰值≤-1.0dBTP）。短视频平台通常再做自己的响度处理，此处只保证不削波、前后一致。
export const TARGET = { lufs: -16, tp: -1.5, lra: 11, lufsTol: 1.5, tpMax: -1 };
export const BGM_DEFAULTS = { gainDb: -18, fadeIn: 2, fadeOut: 3, loopCrossfade: 2 };
export const DUCK = { threshold: 0.02, ratio: 8, attack: 30, release: 500 };

// 音效仅程序合成，点状事件；seed固定，同参数同结果。
export const SFX = {
  whoosh: { dur: 0.9, src: 'anoisesrc=d=0.9:c=pink:r=48000:a=0.6:seed=1,highpass=f=300,lowpass=f=5000,afade=t=in:d=0.45,afade=t=out:st=0.45:d=0.45' },
  impact: { dur: 1.4, src: "aevalsrc='0.9*sin(2*PI*(45+110*exp(-t*16))*t)*exp(-t*3.5)':d=1.4:s=48000" },
  ping:   { dur: 0.8, src: "aevalsrc='0.5*sin(2*PI*1320*t)*exp(-t*6)':d=0.8:s=48000" },
  drum:   { dur: 0.5, src: "aevalsrc='0.9*sin(2*PI*(70+80*exp(-t*30))*t)*exp(-t*9)':d=0.5:s=48000" }
};

const num = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
export const bgmOpts = b => ({ ...BGM_DEFAULTS, ...b });
export const bgmPath = (dir, b) => resolve(dir, b.file);

export function validateMix(dir, mix, total) {
  if (!mix || typeof mix !== 'object' || Array.isArray(mix)) throw new Error('mix.json须为对象');
  const b = mix.bgm;
  if (b != null) {
    if (typeof b.file !== 'string' || !b.file.trim() || isAbsolute(b.file)) throw new Error('bgm.file须为工程内相对路径');
    const f = bgmPath(dir, b);
    if (relative(resolve(dir), f).startsWith('..')) throw new Error('bgm.file越出工程目录');
    if (!existsSync(f)) throw new Error('BGM文件不存在: ' + b.file);
    const o = bgmOpts(b);
    if (!num(o.gainDb, -30, -6)) throw new Error('bgm.gainDb须在-30到-6之间');
    if (!num(o.fadeIn, 0, 10) || !num(o.fadeOut, 0, 10)) throw new Error('bgm淡入淡出须在0到10秒');
    if (o.fadeIn + o.fadeOut > total) throw new Error('bgm淡入淡出之和超过总时长');
    if (!num(o.loopCrossfade, 0.5, 8)) throw new Error('bgm.loopCrossfade须在0.5到8秒');
  }
  const sfx = mix.sfx ?? [];
  if (!Array.isArray(sfx)) throw new Error('sfx须为数组');
  sfx.forEach((s, i) => {
    if (!SFX[s?.type]) throw new Error('sfx#' + i + ' 类型未知，可选: ' + Object.keys(SFX).join('/'));
    if (!num(s.at, 0, total)) throw new Error('sfx#' + i + ' 时间超出0–' + total + '秒');
    if (s.gainDb !== undefined && !num(s.gainDb, -30, 0)) throw new Error('sfx#' + i + ' gainDb须在-30到0之间');
  });
}

// 配置+BGM文件内容+混音版本的指纹；任一变化则已有mix.wav失效。
export function configHash(dir, mix) {
  const h = createHash('sha256').update(JSON.stringify({ v: MIX_VERSION, mix, duck: DUCK, target: TARGET }));
  if (mix.bgm) h.update(audioHash(bgmPath(dir, mix.bgm)));
  return h.digest('hex');
}

export function probeDuration(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' });
  const d = Number(r.stdout?.trim());
  if (r.error || r.status !== 0 || !Number.isFinite(d) || d <= 0) throw new Error('ffprobe读取时长失败: ' + path);
  return d;
}

// loudnorm第一遍：返回原始字符串（供第二遍原样回填）及数值。
export function measureLoudness(path) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af',
    `loudnorm=I=${TARGET.lufs}:TP=${TARGET.tp}:LRA=${TARGET.lra}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = (r.stderr ?? '').match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (r.error || r.status !== 0 || !m) throw new Error('响度测量失败');
  const j = JSON.parse(m[0]);
  const out = { raw: j, i: parseFloat(j.input_i), tp: parseFloat(j.input_tp), lra: parseFloat(j.input_lra) };
  if (!Number.isFinite(out.i) || !Number.isFinite(out.tp)) throw new Error('响度无效（静音或过短）');
  return out;
}

export const sfxFile = (dir, type) => join(dir, 'audio/sfx', type + '.wav');
