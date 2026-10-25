import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { chmodSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as defaultConfig } from './config.js';
import { createLogger } from './logger.js';
import { openDb, getSetting } from './db.js';
import { createBatchStore } from './batches.js';
import { createSiteRunner } from './runner.js';
import { createChecker } from './checker.js';
import { createNotifier } from './notify.js';
import { createScheduler } from './scheduler.js';
import { createApi } from './routes.js';
import { purgeSessions } from './auth.js';
import { fail, HttpError, notFound } from './http.js';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8'
};

/**
 * 飞牛桌面用 iframe 内嵌应用（统一网关模式），同源嵌套必须放行，
 * 否则桌面里只会看到一片空白。直连/新标签页模式仍然禁止被嵌套。
 */
function securityHeaders({ framed = false } = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': framed ? 'SAMEORIGIN' : 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      `frame-ancestors ${framed ? "'self'" : "'none'"}`,
      // 网关入口可能是 /app/siteguard（无尾斜杠），靠注入的 <base> 让相对资源落到前缀下，这里必须放行同源 base。
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  };
}

/**
 * Windows 没有 AF_UNIX，给本地开发/模拟环境用：把文件路径映射成命名管道；
 * fnOS（Linux）上原样返回，打包后的行为不受影响。
 */
export function socketTargetFor(socketPath) {
  if (!socketPath || process.platform !== 'win32' || socketPath.startsWith('\\\\.\\pipe\\')) return socketPath;
  const safe = socketPath.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
  return `\\\\.\\pipe\\siteguard-${safe}`;
}

export function createApp({
  config = defaultConfig,
  logger = createLogger(config.logLevel),
  db = openDb(config.dbFile),
  checkPage = null,
  sendMail = null
} = {}) {
  const batches = createBatchStore();
  // 测试可以注入假的 checkPage / sendMail；生产环境走真实的抓取、判定与 SMTP 链路。
  const engine = checkPage ?? createChecker({ db, logger, config });
  const notifier = createNotifier({ db, config, logger, sendMail });
  const runSite = createSiteRunner({ db, logger, config, checkPage: engine });
  const scheduler = createScheduler({
    db,
    config,
    logger,
    batches,
    runSite,
    notifyBatch: notifier.notifyBatch,
    intervalMs: config.schedulerTickMs,
    maxConcurrency: config.maxConcurrency
  });
  const api = createApi({ db, config, logger, scheduler, batches, checkPage: engine, notifier });

  // 会话过期清理：启动时做一次（createApi 里），之后每小时一次；unref 不阻塞进程退出。
  const sessionSweeper = setInterval(() => purgeSessions(db), 60 * 60 * 1000);
  sessionSweeper.unref?.();

  // fileURLToPath 对目录 URL 会保留结尾分隔符，先 resolve 掉，否则 startsWith 判断永远不成立。
  const publicDir = path.resolve(fileURLToPath(config.publicDir));
  const socketTarget = socketTargetFor(config.socketPath);
  const headers = securityHeaders({ framed: Boolean(config.gatewayPrefix) });
  /**
   * 飞牛桌面入口是 /app/siteguard（没有尾斜杠），浏览器会把 style.css 解析成 /app/style.css，
   * 而网关只转发 /app/siteguard/* —— 不注入 base，CSS/JS 就会 404、页面裸奔。
   * 直连调试（/ 或 /sites/3）则用根路径，避免把资源指到用不到的前缀上。
   */
  function baseHrefFor(pathname) {
    const prefix = config.gatewayPrefix;
    if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) return `${prefix}/`;
    return '/';
  }

  async function sendFile(req, res, target, baseHref) {
    const info = await stat(target);
    if (!info.isFile()) throw notFound('页面不存在');
    const ext = path.extname(target).toLowerCase();
    let body = await readFile(target);
    if (ext === '.html') {
      const baseTag = `<base href="${baseHref}">`;
      body = Buffer.from(String(body).replace(/<head>/i, `<head>\n  ${baseTag}`), 'utf8');
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[ext],
      'content-length': body.length,
      'cache-control': 'no-cache',
      ...headers
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function serveStatic(req, res, pathname, baseHref) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      fail(res, new HttpError(400, 'BAD_PATH', '路径无法解析'));
      return;
    }

    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const target = path.resolve(publicDir, relative);

    // 只允许 public/ 内的文件，且扩展名在白名单里——不做任何路径拼接信任。
    const inside = target.startsWith(publicDir + path.sep) && CONTENT_TYPES[path.extname(target).toLowerCase()];

    try {
      if (!inside) throw notFound('页面不存在');
      await sendFile(req, res, target, baseHref);
    } catch {
      // 单页应用兜底：无扩展名的页面路径交给 index.html；静态资源缺文件仍然是 404。
      const acceptsHtml = String(req.headers.accept ?? '').includes('text/html');
      if (req.method === 'GET' && acceptsHtml && !path.extname(decoded)) {
        try {
          await sendFile(req, res, path.join(publicDir, 'index.html'), baseHref);
          return;
        } catch {
          // 连 index.html 都没有，走下面的 404。
        }
      }
      fail(res, notFound('页面不存在'));
    }
  }

  /**
   * 飞牛统一网关把请求转成 /app/<appname>/...，路由和静态文件按去掉前缀后的路径处理。
   * 直连（本地 PORT 模式）时 gatewayPrefix 为空，路径原样返回。
   */
  function withoutGatewayPrefix(pathname) {
    const prefix = config.gatewayPrefix;
    if (!prefix) return pathname;
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
    return pathname;
  }

  async function handleRequest(req, res) {
    const startedAt = process.hrtime.bigint();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const routed = { pathname: withoutGatewayPrefix(url.pathname), searchParams: url.searchParams, href: url.href };

    res.on('finish', () => {
      logger.debug('http.request', {
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - startedAt) / 1_000_000n)
      });
    });

    try {
      if (await api.handle(req, res, routed)) return;
      if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, routed.pathname, baseHrefFor(url.pathname));
        return;
      }
      fail(res, new HttpError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法'));
    } catch (err) {
      logger.error('http.error', { path: url.pathname, message: err.message, stack: err.stack });
      if (!res.headersSent) fail(res, new HttpError(500, 'INTERNAL', '服务器内部错误'));
      else res.end();
    }
  }

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;

  function listen(port = config.port, host = '0.0.0.0') {
    // Windows 开发环境把 socket 路径当命名管道，没有文件可删，rmSync 会抛；统一收在这里。
    const removeStaleSocket = () => {
      if (!socketTarget) return;
      try {
        rmSync(socketTarget, { force: true });
      } catch {
        // 删不掉就不删，让 listen 自己报错，错误信息更准。
      }
    };

    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);

      const started = () => {
        server.off('error', onError);
        scheduler.start();
        const address = server.address();
        const tcp = typeof address === 'object' && address !== null;
        logger.info('server.start', {
          version: config.version,
          socket: config.socketPath || null,
          host: tcp ? address.address : null,
          port: tcp ? address.port : null,
          gatewayPrefix: config.gatewayPrefix || null,
          dataDir: config.dataDir,
          db: config.dbFile,
          needSetup: !getSetting(db, 'admin_password')
        });
        resolve(address);
      };

      if (socketTarget) {
        // 上次异常退出会留下 socket 文件，不清掉 listen 直接 EADDRINUSE。
        removeStaleSocket();
        server.listen(socketTarget, () => {
          try {
            chmodSync(socketTarget, 0o660);
          } catch {
            // 收紧权限失败不影响监听本身（命名管道上不需要）。
          }
          started();
        });
        return;
      }

      server.listen(port, host, started);
    });
  }

  async function close() {
    scheduler.stop();
    clearInterval(sessionSweeper);
    await new Promise((resolve) => server.close(resolve));
    if (socketTarget) {
      try {
        rmSync(socketTarget, { force: true });
      } catch {
        // 同 listen：Windows 命名管道不是文件。
      }
    }
    db.close();
    logger.info('server.stop', {});
  }

  return { server, db, logger, scheduler, batches, listen, close };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const app = createApp();
  await app.listen();

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    app.logger.info('server.shutdown', { signal });
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.logger.error('server.shutdown.fail', { message: err.message });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    app.logger.error('process.unhandledRejection', { message: String(reason) });
  });
}
