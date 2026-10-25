import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const int = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
};
// 重试次数允许为 0（关掉重试），所以单独用一个非负解析。
const count = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
};

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

/** 网关前缀统一成 "/app/xxx" 形式；空值表示直连（无前缀）。 */
const normalizePrefix = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
};

/** 允许的跨站来源，写成 host 便于和 Origin 比对（ALLOWED_ORIGINS=a.example.com,https://b.example.com）。 */
const allowedOrigins = String(process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => {
    try {
      return new URL(item.includes('://') ? item : `http://${item}`).host;
    } catch {
      return '';
    }
  })
  .filter(Boolean);

// 打包后的应用把前端产物放在固定目录，用 FRONTEND_DIST 指过去；本地开发用仓库里的 public/。
const publicDir = process.env.FRONTEND_DIST
  ? pathToFileURL(path.join(path.resolve(process.env.FRONTEND_DIST), path.sep))
  : new URL('../public/', import.meta.url);

export const config = {
  version: pkg.version,
  port: int(process.env.PORT, 8686),
  // 飞牛统一网关：SOCKET_PATH 非空则监听 Unix Socket，否则监听 TCP 端口。
  socketPath: process.env.SOCKET_PATH || '',
  gatewayPrefix: normalizePrefix(process.env.GATEWAY_PREFIX),
  allowedOrigins,
  dataDir,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'app.db'),
  timezone: process.env.TZ || 'Asia/Shanghai',
  logLevel: process.env.LOG_LEVEL || 'info',
  maxPagesPerSite: int(process.env.MAX_PAGES_PER_SITE, 30),
  allowPrivateTargets: bool(process.env.ALLOW_PRIVATE_TARGETS, true),
  fetchTimeoutMs: int(process.env.FETCH_TIMEOUT_MS, 20000),
  fetchMaxBytes: int(process.env.FETCH_MAX_BYTES, 5 * 1024 * 1024),
  fetchRetries: count(process.env.FETCH_RETRIES, 1),
  fetchRetryDelayMs: int(process.env.FETCH_RETRY_DELAY_MS, 5000),
  // 页间隔允许 0：测试和单页站点不必等 3 秒。
  pageGapMs: count(process.env.PAGE_GAP_MS, 3000),
  schedulerTickMs: int(process.env.SCHEDULER_TICK_MS, 20000),
  maxConcurrency: int(process.env.MAX_CONCURRENCY, 2),
  publicDir,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  loginWindowMs: 5 * 60 * 1000,
  loginMaxFailures: 8
};
