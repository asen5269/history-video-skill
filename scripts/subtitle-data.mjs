import { join } from 'node:path';
import { audioHash, safeId, ttsText } from './audio-cache.mjs';

const PUNC = /[\p{P}\p{Z}\s]/u;
export const contentChars = text => [...text].filter(c => !PUNC.test(c));

export function displayRanges(sentence) {
  const display = contentChars(sentence.text), spoken = contentChars(ttsText(sentence));
  const map = sentence.map ?? [];
  if (!Array.isArray(map)) throw new Error(`${sentence.id} map须为数组`);
  const ranges = [];
  let d = 0, t = 0;
  for (const m of map) {
    if (!Array.isArray(m) || m.length !== 4 || !m.every(Number.isInteger) ||
        m[0] < d || m[2] < t || m[1] <= m[0] || m[3] <= m[2] ||
        m[1] > display.length || m[3] > spoken.length || m[0] - d !== m[2] - t)
      throw new Error(`${sentence.id} map范围无效或未覆盖长度变化`);
    while (d < m[0]) ranges.push([t, ++t]), d++;
    const dn = m[1] - m[0], tn = m[3] - m[2];
    for (let j = 0; j < dn; j++) ranges.push([
      m[2] + Math.floor(j * tn / dn),
      m[2] + Math.max(Math.floor(j * tn / dn) + 1, Math.ceil((j + 1) * tn / dn))
    ]);
    d = m[1]; t = m[3];
  }
  if (display.length - d !== spoken.length - t)
    throw new Error(`${sentence.id} 显示与TTS长度不同，须提供map`);
  while (d < display.length) ranges.push([t, ++t]), d++;
  return ranges;
}

export function alignedTimes(dir, sentence, item, align) {
  if (!safeId(sentence.id)) throw new Error('非法句子ID');
  const a = align?.items?.[sentence.id];
  if (align?.schema !== 2 || align.timebase !== 'sentence' || !a ||
      a.tts !== ttsText(sentence) || a.audioHash !== item.audioHash ||
      a.audioHash !== audioHash(join(dir, 'audio/trim', `${sentence.id}.wav`)))
    throw new Error(`${sentence.id} 对齐缓存缺失或失效，重跑align`);
  const chars = (a.chars ?? []).filter(c => !PUNC.test(c.c));
  if (chars.map(c => c.c).join('') !== contentChars(ttsText(sentence)).join(''))
    throw new Error(`${sentence.id} 对齐漏字或字符不匹配`);
  let previous = 0;
  for (const c of chars) {
    if (!Number.isFinite(c.s) || !Number.isFinite(c.e) || c.s < 0 || c.e <= c.s ||
        c.s < previous - 0.001 || c.e > item.end - item.start + 0.002)
      throw new Error(`${sentence.id} 字级时间戳无效`);
    previous = c.e;
  }
  return chars;
}

export function buildSubtitles(dir, script, timeline, align, max = 16) {
  if (!Number.isInteger(max) || max < 1) throw new Error('字幕长度须为正整数');
  if (timeline.version !== script.version || timeline.items.length !== script.sentences.length)
    throw new Error('时间轴版本失效，重跑timeline');
  const subs = [];
  script.sentences.forEach((s, i) => {
    const item = timeline.items[i];
    if (item.id !== s.id || item.tts !== ttsText(s)) throw new Error(`${s.id} 时间轴与稿子不匹配`);
    const times = alignedTimes(dir, s, item, align), ranges = displayRanges(s);
    let k = 0, cur = '', st = null, en = null, count = 0;
    const flush = () => {
      const text = cur.replace(/[，、；：,;:\s]+$/, '');
      if (text && st !== null) {
        const block = { id: s.id, s: +(item.start + st).toFixed(6), e: +(item.start + en).toFixed(6), t: text };
        if (block.e <= block.s || (subs.length && block.s < subs.at(-1).e - 0.001))
          throw new Error(`${s.id} 字幕块重叠或无有效时长，调整map/断句`);
        subs.push(block);
      }
      cur = ''; st = en = null; count = 0;
    };
    for (const ch of s.text) {
      if (!PUNC.test(ch)) {
        const [from, to] = ranges[k++];
        st ??= times[from].s; en = times[to - 1].e; count++;
      }
      cur += ch;
      if (/[。！？!?；;]/.test(ch) || (count >= max && /[，、,：:]/.test(ch)) || count >= max + 4) flush();
    }
    flush();
  });
  return subs;
}

export const srtText = subs => {
  const ts = x => {
    const ms = Math.round(x * 1000), p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return subs.map((b, i) => `${i + 1}\n${ts(b.s)} --> ${ts(b.e)}\n${b.t}\n`).join('\n');
};
