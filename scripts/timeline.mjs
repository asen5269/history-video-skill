// 稿子+裁剪记录 → 真实配音时间轴；concat避免数百输入撑爆Windows命令行。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson, checkAudio, audioHash, ttsText, pauseOf } from './audio-cache.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node timeline.mjs <project> [--no-audio]'); process.exit(2); }
try {
  const script = readJson(join(dir, 'script.json')), durations = readJson(join(dir, 'durations.json'));
  if (!script.sentences?.length || durations.version !== script.version || !durations.items)
    throw new Error('稿子为空或裁剪记录过期，重跑trim');
  const rate = 48000;
  let frame = 0;
  const items = script.sentences.map((s, i) => {
    const record = durations.items[s.id], hash = checkAudio(dir, s, record);
    const count = Math.round(record.duration * rate);
    const pause = pauseOf(script, i);
    const gap = Math.round(pause * rate);
    const item = { id: s.id, start: frame / rate, end: (frame + count) / rate, pause: gap / rate,
                   tts: ttsText(s), audioHash: hash };
    frame += count + gap;
    return item;
  });
  const timeline = { version: script.version, total: frame / rate, items };
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2));
  if (!process.argv.includes('--no-audio')) {
    const run = args => {
      const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
      if (r.error || r.status !== 0) throw new Error(r.error?.message ?? 'ffmpeg失败');
    };
    const gaps = join(dir, 'audio/gaps');
    mkdirSync(gaps, { recursive: true });
    const made = new Set(), list = [];
    const line = path => "file '" + resolve(path).replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
    for (const item of items) {
      list.push(line(join(dir, 'audio/trim', item.id + '.wav')));
      if (!item.pause) continue;
      const frames = Math.round(item.pause * rate), path = join(gaps, frames + '.wav');
      if (!made.has(frames)) {
        run(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
             '-af', 'atrim=end_sample=' + frames, '-c:a', 'pcm_s16le', path]);
        made.add(frames);
      }
      list.push(line(path));
    }
    const concat = join(dir, 'audio/voice.concat');
    writeFileSync(concat, 'ffconcat version 1.0\n' + list.join('\n') + '\n');
    run(['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat,
         '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', join(dir, 'voice.wav')]);
    timeline.voiceHash = audioHash(join(dir, 'voice.wav'));
    writeFileSync(join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2));
  }
  console.log('timeline ' + items.length + ' 句，总长 ' + timeline.total + 's');
} catch (e) { console.error(e.message); process.exit(1); }
