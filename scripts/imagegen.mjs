// 生图：OpenAI兼容Images API（默认gpt-image-2.5-1k）
// 用法：node imagegen.mjs --prompt "..." --out shot.png [--size 1536x1024] [--ref a.png,b.png] [--quality high] [--background opaque|transparent]
// 凭据：环境变量或项目 .env（从 --out 所在目录向上查找）：HV_IMAGE_BASE_URL、HV_IMAGE_API_KEY、HV_IMAGE_MODEL（可选）、HV_IMAGE_SIZE（可选）
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { importHvEnv, curl, curlEsc } from './env.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i < 0 ? def : argv[i + 1] ?? def; };
const prompt = opt('--prompt'), outArg = opt('--out');
if (!prompt || !outArg) { console.error('usage: node imagegen.mjs --prompt "..." --out file.png [--size WxH] [--ref a.png,b.png] [--quality high] [--background opaque|transparent]'); process.exit(2); }
const out = resolve(outArg);
importHvEnv(out);
const size = opt('--size') ?? (process.env.HV_IMAGE_SIZE || '1024x1024');
const quality = opt('--quality', 'high'), background = opt('--background', 'opaque');
const refs = (opt('--ref') ?? '').split(',').filter(Boolean);
const key = process.env.HV_IMAGE_API_KEY, model = process.env.HV_IMAGE_MODEL || 'gpt-image-2.5-1k';
let base = process.env.HV_IMAGE_BASE_URL;
if (!base || !key) { console.error('缺少 HV_IMAGE_BASE_URL 或 HV_IMAGE_API_KEY'); process.exit(2); }
base = base.replace(/\/+$/, ''); if (!/\/v\d+$/.test(base)) base += '/v1';   // 根地址自动补 /v1
for (const r of refs) if (!existsSync(r)) { console.error('参考图不存在: ' + r); process.exit(2); }

// 统一禁止项（OpenAI 协议无 negative prompt，并入正文）
const full = prompt + '\n\nAvoid: seals, stamps, watermarks, signatures, logos, any text or calligraphy, visible faces of identifiable people.';

// 参考图复制成ASCII临时文件名并以cwd相对路径交给curl：Windows上curl读不了非ASCII路径。
let tmp = null, cfg = `header = "Authorization: Bearer ${curlEsc(key)}"\nsilent\nshow-error\n`;
try {
  if (refs.length) {
    tmp = mkdtempSync(join(tmpdir(), 'hv-img-'));
    cfg += `url = "${curlEsc(base)}/images/edits"\nform = "model=${curlEsc(model)}"\nform = "size=${curlEsc(size)}"\nform = "quality=${curlEsc(quality)}"\n` +
           `form = "background=${curlEsc(background)}"\nform-string = "prompt=${curlEsc(full)}"\n`;
    refs.forEach((r, i) => {
      const name = `ref${i}${extname(r).replace(/[^.A-Za-z0-9]/g, '')}`;
      copyFileSync(r, join(tmp, name));
      cfg += `form = "image[]=@${name}"\n`;
    });
  } else {
    const body = JSON.stringify({ model, prompt: full, size, quality, background, n: 1 });
    cfg += `url = "${curlEsc(base)}/images/generations"\nheader = "Content-Type: application/json"\ndata-binary = "${curlEsc(body)}"\n`;
  }
  cfg += 'max-time = 300\nwrite-out = "\\n%{http_code}"\n';
  const r = curl(cfg, { cwd: tmp ?? undefined });
  const raw = r.out ?? '', i = raw.lastIndexOf('\n'), http = raw.slice(i + 1).trim(), resp = raw.slice(0, Math.max(0, i));
  if (r.status !== 0 || http !== '200') { console.log('FAIL HTTP ' + http); process.exit(1); }
  let j; try { j = JSON.parse(resp); } catch { console.log('FAIL 非JSON响应 ' + resp.length + 'B'); process.exit(1); }
  if (j.error) { console.log('FAIL API error'); process.exit(1); }
  const d = j.data?.[0];
  mkdirSync(dirname(out), { recursive: true });
  if (d?.b64_json) writeFileSync(out, Buffer.from(d.b64_json, 'base64'));
  else if (d?.url) {
    const dl = curl(`url = "${curlEsc(d.url)}"\nsilent\nfail\nlocation\nmax-time = 300\n`, { binary: true });
    if (dl.status !== 0 || !dl.out?.length) { console.log('FAIL 图像下载'); process.exit(1); }
    writeFileSync(out, dl.out);
  } else { console.log('FAIL 响应无图像'); process.exit(1); }
  // 记录提示词，便于复现与一致性（不含凭据）
  writeFileSync(out + '.json', JSON.stringify({ prompt: full, model, size, quality, background, ref: refs.length ? refs : null, revised: d.revised_prompt ?? null, time: new Date().toISOString().slice(0, 19) }, null, 2));
  console.log('ok ' + out);
} finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
