import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
export const audioHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export const ttsText = s => s.tts ?? s.text;
export const safeId = id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id);
export const PAUSE_LEVELS = { beat: 0.35, turn: 0.6, breath: 1.0, hold: 1.5 };
export const PAUSE_MAX = 1.5, PAUSE_PLAIN_MAX = 0.6, TAIL_DEFAULT = 2, TAIL_MAX = 5;
// 句后停顿秒数：数字或档位名；最后一句取script.tail（结尾留白）。
export function pauseOf(script, i) {
  const s = script.sentences[i];
  if (i === script.sentences.length - 1) {
    const tail = script.tail ?? TAIL_DEFAULT;
    if (!Number.isFinite(tail) || tail < 0 || tail > TAIL_MAX) throw new Error('script.tail须在0–' + TAIL_MAX + '秒');
    return tail;
  }
  const p = typeof s.pause === 'string' ? PAUSE_LEVELS[s.pause] : (s.pause ?? PAUSE_LEVELS.beat);
  if (!Number.isFinite(p) || p < 0.3 || p > PAUSE_MAX) throw new Error(s.id + ' 停顿无效：数字0.3–' + PAUSE_MAX + '或档位' + Object.keys(PAUSE_LEVELS).join('/'));
  return p;
}
export const ttsSpec = (text, protocol = 'v1') => protocol === 'v3' ?
  { text, voice: 'zh_male_liufei_uranus_bigtts', speed: 1.1, encoding: 'mp3', protocol: 'v3',
    resourceId: 'seed-tts-2.0', sampleRate: 24000, bitRate: 160000, speechRate: 10, enableSubtitle: true } :
  { text, voice: 'zh_male_liufei_uranus_bigtts', speed: 1.1, cluster: 'volcano_tts', encoding: 'mp3' };
export function validTtsMeta(meta, text) {
  if (!meta || (meta.protocol != null && !['v1', 'v3'].includes(meta.protocol))) return false;
  return Object.entries(ttsSpec(text, meta.protocol ?? 'v1')).every(([key, value]) => meta[key] === value);
}

export function checkAudio(dir, sentence, record) {
  if (!safeId(sentence.id)) throw new Error('非法句子ID');
  const raw = join(dir, 'audio/raw', `${sentence.id}.mp3`);
  const wav = join(dir, 'audio/trim', `${sentence.id}.wav`);
  const meta = readJson(`${raw}.json`);
  const spec = ttsSpec(ttsText(sentence), meta.protocol ?? 'v1');
  if (!validTtsMeta(meta, spec.text) || meta.audioHash !== audioHash(raw))
    throw new Error(`${sentence.id} 原始配音缓存失效，重跑tts`);
  const hash = audioHash(wav);
  if (!record || record.tts !== spec.text || record.rawHash !== meta.audioHash || record.audioHash !== hash ||
      !Number.isFinite(record.duration) || record.duration <= 0)
    throw new Error(`${sentence.id} 裁剪缓存失效，重跑trim`);
  return hash;
}
