// 逐句合成；--ids强制重做选中句子，默认仅复用内容和配置均匹配的缓存。
// 用法：node tts.mjs <项目> [--ids s001,s002] [--force]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson, audioHash, ttsText, ttsSpec, safeId } from './audio-cache.mjs';
import { importHvEnv, curl, curlEsc } from './env.mjs';

const args = process.argv.slice(2), dir = args.find(a => !a.startsWith('--'));
const opt = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] ?? ''; };
if (!dir) { console.error('usage: node tts.mjs <project> [--ids s001,s002] [--force]'); process.exit(2); }
const force = args.includes('--force');
const ids = (opt('--ids') ?? '').split(',').filter(Boolean);

importHvEnv(dir);
const appid = process.env.DOUBAO_TTS_APPID, token = process.env.DOUBAO_TTS_TOKEN;
const url = process.env.HV_TTS_URL ?? 'https://openspeech.bytedance.com/api/v1/tts';   // HV_TTS_URL仅供测试指向本机服务
const script = readJson(join(dir, 'script.json'));
const known = new Set(script.sentences.map(s => s.id));
if (ids.some(id => !known.has(id))) { console.error('未知句子ID'); process.exit(2); }
const out = join(dir, 'audio/raw');
mkdirSync(out, { recursive: true });

let fail = 0;
for (const s of script.sentences) {
  if (ids.length && !ids.includes(s.id)) continue;
  if (!safeId(s.id)) { console.error('非法句子ID'); process.exit(2); }
  const mp3 = join(out, s.id + '.mp3'), text = ttsText(s), spec = ttsSpec(text);
  if (existsSync(mp3) && existsSync(mp3 + '.json') && !force && !ids.length) {
    let meta = null; try { meta = readJson(mp3 + '.json'); } catch { /* 缓存损坏则重做 */ }
    if (meta && Object.entries(spec).every(([k, v]) => meta[k] === v) && meta.audioHash === audioHash(mp3)) continue;
  }
  if (!appid || !token) { console.error('缺少 DOUBAO_TTS_APPID 或 DOUBAO_TTS_TOKEN'); process.exit(2); }
  const body = JSON.stringify({
    app: { appid, token: 'access_token', cluster: spec.cluster },
    user: { uid: 'history-video' },
    audio: { voice_type: spec.voice, encoding: spec.encoding, speed_ratio: spec.speed },
    request: { reqid: randomUUID(), text, operation: 'query' }
  });
  const cfg = `url = "${curlEsc(url)}"\nheader = "Authorization: Bearer;${curlEsc(token)}"\nheader = "Content-Type: application/json"\n` +
              `data-binary = "${curlEsc(body)}"\nsilent\nmax-time = 300\n`;
  const r = curl(cfg);
  let j = null; try { j = JSON.parse(r.out); } catch { /* 非JSON */ }
  if (r.status === 0 && j && j.code === 3000 && j.data) {
    const bytes = Buffer.from(j.data, 'base64');
    if (!bytes.length) { console.error('空配音 ' + s.id); process.exit(1); }
    writeFileSync(mp3, bytes);
    writeFileSync(mp3 + '.json', JSON.stringify({ ...spec, audioHash: audioHash(mp3) }, null, 2));
    console.log('ok ' + s.id);
  } else {
    fail++;
    console.log('FAIL ' + s.id + ' code=' + (j ? j.code : 'no-json') + ' curl=' + r.status);
  }
}
process.exit(fail ? 1 : 0);
