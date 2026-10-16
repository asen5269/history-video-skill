// 读取凭据：已有环境变量优先；否则从起点目录逐级向上找 .env 或 key.env，只载入当前进程。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export function importHvEnv(from = process.cwd()) {
  let d = resolve(from);
  if (existsSync(d) && statSync(d).isFile()) d = dirname(d);
  for (;;) {
    const f = ['.env', 'key.env'].map(n => join(d, n)).find(existsSync);
    if (f) {
      for (const line of readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
        if (/^\s*(#|$)/.test(line)) continue;
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        const v = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']+|["']+$/g, '');
        if (!process.env[m[1]]) process.env[m[1]] = v;
      }
      return;
    }
    const p = dirname(d);
    if (p === d) return;
    d = p;
  }
}

// 请求统一经系统curl发出（已验证可绕过代理截断问题）；配置经stdin传入，凭据不进命令行。
export const curlBin = process.env.HV_CURL ?? (process.platform === 'win32' ? 'curl.exe' : 'curl');
export const curlEsc = s => String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
export function curl(config, { cwd, args = [], binary = false } = {}) {
  const r = spawnSync(curlBin, [...args, '-K', '-'], { input: Buffer.from(config, 'utf8'), cwd, maxBuffer: 1 << 30, encoding: binary ? undefined : 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  return { status: r.error ? -1 : r.status, out: r.stdout };
}
