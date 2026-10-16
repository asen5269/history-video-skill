// 按当前稿子裁剪首尾静音；duration和音频hash用于校验后续缓存。
// 用法：node trim.mjs <项目> [--threshold -50dB]
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson, audioHash, ttsText, validTtsMeta, safeId } from './audio-cache.mjs';

const args = process.argv.slice(2), dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--threshold');
const ti = args.indexOf('--threshold'), threshold = ti < 0 ? '-50dB' : args[ti + 1];
if (!dir || !/^-?\d+(\.\d+)?dB$/.test(threshold ?? '')) { console.error('usage: node trim.mjs <project> [--threshold -50dB]'); process.exit(2); }

try {
  const script = readJson(join(dir, 'script.json'));
  const raw = join(dir, 'audio/raw'), trim = join(dir, 'audio/trim');
  mkdirSync(trim, { recursive: true });
  const sr = 'silenceremove=start_periods=1:start_threshold=' + threshold, af = `${sr},areverse,${sr},areverse`;
  const items = {};
  for (const s of script.sentences) {
    if (!safeId(s.id)) throw new Error('非法句子ID');
    const mp3 = join(raw, s.id + '.mp3'), wav = join(trim, s.id + '.wav'), text = ttsText(s);
    const meta = readJson(mp3 + '.json'), rawHash = audioHash(mp3);
    if (!validTtsMeta(meta, text) || meta.audioHash !== rawHash)
      throw new Error(s.id + ' 配音缓存失效，重跑tts');
    let cache = null;
    if (existsSync(wav + '.json') && existsSync(wav)) { try { cache = readJson(wav + '.json'); } catch { cache = null; } }
    if (!cache || cache.rawHash !== rawHash || cache.threshold !== threshold || cache.audioHash !== audioHash(wav)) {
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', mp3, '-af', af, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { stdio: 'inherit' });
      if (r.error || r.status !== 0) throw new Error('ffmpeg失败 ' + s.id);
    }
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' });
    if (p.error || p.status !== 0) throw new Error('ffprobe失败 ' + s.id);
    const duration = Number(p.stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无有效音频 ' + s.id);
    const record = { duration, tts: text, rawHash, threshold, audioHash: audioHash(wav) };
    writeFileSync(wav + '.json', JSON.stringify(record, null, 2));
    items[s.id] = record;
  }
  writeFileSync(join(dir, 'durations.json'), JSON.stringify({ version: script.version, items }, null, 2));
  console.log('trimmed ' + Object.keys(items).length);
} catch (e) { console.error(e.message); process.exit(1); }
