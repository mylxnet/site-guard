/**
 * 抓取页面（PROJECT.md 4.1）。
 * 手动处理重定向：需要限跳数、要记录最终地址，Node 的 fetch 自动跟随不暴露跳数。
 * 所有失败都归一成 { ok:false, error, message }，判定层只认分类，不解析原始异常。
 */

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_CHARSET = 'utf-8';

class FetchFailure extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'FetchFailure';
    this.code = code;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function classifyFetchError(err, timeoutMs = 20_000) {
  const name = err?.name ?? '';
  const message = String(err?.message ?? err ?? '');
  const code = String(err?.cause?.code ?? err?.code ?? '');

  if (name === 'TimeoutError' || name === 'AbortError' || /aborted|timed out/i.test(message)) {
    return new FetchFailure('TIMEOUT', `请求超时（${Math.round(timeoutMs / 1000)}s）`, { retryable: true });
  }
  if (/ENOTFOUND|EAI_AGAIN|EAI_FAIL/.test(code)) {
    return new FetchFailure('DNS', `域名解析失败（${code}）`, { retryable: true });
  }
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(code) || /certificate/i.test(message)) {
    // 证书错误重试也不会好，直接报，省一轮等待。
    return new FetchFailure('TLS', 'HTTPS 证书校验失败', { retryable: false });
  }
  return new FetchFailure('CONN', `连接失败（${code || message || '未知网络错误'}）`, { retryable: true });
}

const normalizeCharset = (value) => {
  if (!value) return DEFAULT_CHARSET;
  const lower = String(value).trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (lower === 'gb2312' || lower === 'gb18030' || lower === 'x-gbk') return 'gbk';
  if (lower === 'utf8') return 'utf-8';
  return lower;
};

/** 先看响应头，再看 <meta charset>（只看前 4 KB，够 HTML 声明用）。 */
export function detectCharset(buffer, contentType = '') {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return normalizeCharset(fromHeader);

  const head = buffer.subarray(0, 4096).toString('latin1');
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1];
  return normalizeCharset(fromMeta);
}

export function decodeBody(buffer, contentType = '') {
  const charset = detectCharset(buffer, contentType);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return new TextDecoder(DEFAULT_CHARSET, { fatal: false }).decode(buffer);
  }
}

async function readCapped(res, maxBytes) {
  const chunks = [];
  let received = 0;
  let truncated = false;
  const reader = res.body?.getReader();
  if (!reader) return { buffer: Buffer.alloc(0), truncated };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > maxBytes) {
      const keep = maxBytes - received;
      if (keep > 0) chunks.push(Buffer.from(value.subarray(0, keep)));
      received = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(Buffer.from(value));
    received += value.byteLength;
  }

  return { buffer: Buffer.concat(chunks), truncated };
}

async function request(url, { timeoutMs, maxBytes, maxRedirects, userAgent, headers }) {
  let current = url;
  const startedAt = Date.now();

  for (let hop = 0; ; hop += 1) {
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
          ...headers
        }
      });
    } catch (err) {
      throw classifyFetchError(err, timeoutMs);
    }

    if (REDIRECT_STATUS.has(res.status)) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!location) throw new FetchFailure('HTTP', `重定向缺少 Location（${res.status}）`);
      if (hop >= maxRedirects) throw new FetchFailure('REDIRECT', `重定向超过 ${maxRedirects} 跳`);
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new FetchFailure('HTTP', '重定向地址无法解析');
      }
      continue;
    }

    let body;
    try {
      body = await readCapped(res, maxBytes);
    } catch (err) {
      throw classifyFetchError(err, timeoutMs);
    }

    const contentType = res.headers.get('content-type') ?? '';
    return {
      ok: true,
      status: res.status,
      finalUrl: current,
      contentType,
      html: decodeBody(body.buffer, contentType),
      responseMs: Date.now() - startedAt,
      truncated: body.truncated,
      bytes: body.buffer.length,
      redirects: hop
    };
  }
}

/**
 * @returns {Promise<
 *   | { ok: true, status: number, finalUrl: string, contentType: string, html: string,
 *       responseMs: number, truncated: boolean, bytes: number, redirects: number }
 *   | { ok: false, error: string, message: string, responseMs: number }
 * >}
 */
export async function fetchPage(url, {
  timeoutMs = 20_000,
  maxBytes = 5 * 1024 * 1024,
  maxRedirects = 5,
  retries = 1,
  retryDelayMs = 5_000,
  userAgent = 'SiteGuard/0.5 (+self-hosted monitor)',
  headers = {}
} = {}) {
  const startedAt = Date.now();
  let left = Math.max(0, Number(retries) || 0);

  for (;;) {
    try {
      return await request(url, { timeoutMs, maxBytes, maxRedirects, userAgent, headers });
    } catch (err) {
      const failure = err instanceof FetchFailure ? err : classifyFetchError(err, timeoutMs);
      if (failure.retryable && left > 0) {
        left -= 1;
        await sleep(retryDelayMs);
        continue;
      }
      return {
        ok: false,
        error: failure.code,
        message: failure.message,
        responseMs: Date.now() - startedAt
      };
    }
  }
}
