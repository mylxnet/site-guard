/** 极简 HTTP 工具：统一 JSON 形状、请求体解析、Cookie、同源校验。 */

export const MAX_BODY_BYTES = 1024 * 1024;

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message, fields) => new HttpError(400, 'VALIDATION_FAILED', message, fields);
export const unauthorized = (message = '请先登录') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = '来源不合法') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = '资源不存在') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message) => new HttpError(409, 'CONFLICT', message);

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

export const ok = (res, data = null, status = 200) => sendJson(res, status, { ok: true, data });

export const fail = (res, err) => {
  // ValidationError 由 validate.js 抛出，没有 status，这里统一映射成 400。
  const status = err.status ?? (err.code === 'VALIDATION_FAILED' ? 400 : 500);
  const body = {
    ok: false,
    error: {
      code: err.code ?? 'INTERNAL',
      message: status === 500 ? '服务器内部错误' : err.message
    }
  };
  if (err.fields) body.error.fields = err.fields;
  sendJson(res, status, body);
};

/** 读取 JSON 请求体，限制大小并拒绝非对象。 */
export async function readJson(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体过大');
    chunks.push(chunk);
  }

  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw badRequest('请求体不是合法的 JSON 对象');
  }
}

export function setCookie(res, name, value, { maxAge, expires } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/'];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
  const existing = res.getHeader('set-cookie');
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader('set-cookie', [...list, parts.join('; ')]);
}

/**
 * CSRF 纵深防御：浏览器跨站请求一定带 Origin，握不上就拒。
 * 不带 Origin 的请求（curl、健康检查）放行，因为 Cookie 是 SameSite=Strict。
 *
 * 飞牛统一网关会改写 Host（反向代理到 Unix Socket），Origin 与 Host 天然对不上，
 * 所以前端每个请求都带自定义头 x-siteguard-client: 1，表示“这是同源页面发出的”。
 * 跨站表单无法伪造自定义头；跨站 fetch 加头会触发预检，而本服务不返回 CORS 头，浏览器会直接拦下。
 */
export function assertSameOrigin(req, { allowHosts = [] } = {}) {
  if (req.headers['x-siteguard-client'] === '1') return;

  const origin = req.headers.origin;
  if (!origin) return;

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden('Origin 头无法解析');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const allowed = new Set([host.split(',')[0].trim(), ...allowHosts.filter(Boolean)]);
  if (!allowed.has(originHost)) throw forbidden('跨站请求被拒绝');
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}
