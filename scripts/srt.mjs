// align.json + 当前timeline.json → subs.json + output.srt
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './audio-cache.mjs';
import { buildSubtitles, srtText } from './subtitle-data.mjs';

const dir = process.argv[2], index = process.argv.indexOf('--max');
const max = index < 0 ? 16 : Number(process.argv[index + 1]);
if (!dir) { console.error('usage: node srt.mjs <project> [--max 16]'); process.exit(2); }
try {
  const subs = buildSubtitles(dir, readJson(join(dir, 'script.json')), readJson(join(dir, 'timeline.json')), readJson(join(dir, 'align.json')), max);
  writeFileSync(join(dir, 'subs.json'), JSON.stringify(subs, null, 1));
  writeFileSync(join(dir, 'subs.meta.json'), JSON.stringify({ scriptVersion: readJson(join(dir, 'script.json')).version, max }));
  writeFileSync(join(dir, 'output.srt'), srtText(subs));
  console.log('srt ' + subs.length + ' 块');
} catch (e) { console.error(e.message); process.exit(1); }
