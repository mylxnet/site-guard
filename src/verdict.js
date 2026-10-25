/**
 * 四档判定（PROJECT.md 4.3）。
 * 判定 = 规则集合 + 聚合优先级：unknown > bad > suspect > normal。
 * unknown 最高，因为“判不出来”不能冒充“异常”；bad 其次，避免慢响应把真故障降级。
 */

export const ERROR_WORDS = [
  'bad gateway',
  'service unavailable',
  '502 bad gateway',
  '404 not found',
  '页面不存在',
  '该域名已过期',
  '域名未绑定',
  '站点已被暂停',
  '该站点已暂停',
  '数据库连接失败',
  '连接数据库失败',
  'internal server error',
  'access denied',
  'forbidden',
  '站点建设中',
  '网站维护中',
  '服务器错误'
];

export const TITLE_BAD_WORDS = [
  '404',
  '500',
  '502',
  '503',
  '504',
  'error',
  'forbidden',
  'not found',
  '无法访问',
  '该站点已暂停',
  '站点已暂停',
  '建设中',
  '维护中',
  '系统维护',
  '网站维护',
  '访问受限'
];

export const ANTIBOT_WORDS = [
  'just a moment',
  'checking your browser',
  'verify you are human',
  '验证您是否为真人',
  '请开启 javascript',
  '请开启javascript',
  '请启用 javascript',
  'cf-chl',
  '__cf_chl'
];

const LOGIN_PATH = /\/(?:login|signin|sign-in|auth\/login)(?:[/?#]|$)/i;
const LOGIN_TEXT = ['请登录后查看', '请先登录', '登录后可见', 'sign in to continue'];

const hostOf = (value) => {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const pathOf = (value) => {
  try {
    const url = new URL(String(value));
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return pathname + url.search;
  } catch {
    return '';
  }
};

const hitWord = (haystack, words) => words.find((word) => haystack.includes(word)) ?? null;

/** R-01 传输失败 */
const r01 = ({ fetch: f }) => {
  if (f.ok) return null;
  return { level: 'bad', reason: `${f.error}：${f.message}` };
};

/** R-02 非 HTML */
const r02 = ({ fetch: f }) => {
  if (!f.ok || !f.contentType) return null;
  const type = f.contentType.toLowerCase();
  if (type.includes('html') || type.includes('xml')) return null;
  return { level: 'bad', reason: `返回类型为 ${f.contentType.split(';')[0].trim()}，不是网页` };
};

/** R-03 5xx */
const r03 = ({ fetch: f }) => {
  if (!f.ok || !f.status || f.status < 500) return null;
  return { level: 'bad', reason: `服务器返回 ${f.status}` };
};

/**
 * R-04 跨域跳转
 * 参照物必须是“本次请求的页面地址”，不是站点首页：
 * 一个站点常有 blog.example.com、/post/1 这类页面，拿首页去比会把正常页面判成跨域。
 */
const r04 = ({ fetch: f, url, baseUrl }) => {
  if (!f.ok || !f.finalUrl) return null;
  const target = hostOf(f.finalUrl);
  const reference = hostOf(url || baseUrl);
  if (!target || !reference || target === reference) return null;
  return { level: 'bad', reason: `被跳转到 ${target}` };
};

/** R-05 标题异常 */
const r05 = ({ fetch: f, title }) => {
  if (!f.ok) return null;
  if (!title) return { level: 'bad', reason: '页面没有标题' };
  const lower = title.toLowerCase();
  const hit = TITLE_BAD_WORDS.find((word) => lower.includes(word.toLowerCase()));
  return hit ? { level: 'bad', reason: `页面标题变为「${title}」` } : null;
};

/** R-06 错误页特征 */
const r06 = ({ fetch: f, text }) => {
  if (!f.ok) return null;
  const head = text.slice(0, 2000).toLowerCase();
  const hit = hitWord(head, ERROR_WORDS);
  return hit ? { level: 'bad', reason: `正文命中错误页特征：${hit}` } : null;
};

/**
 * R-07 正文近空白。
 * 50 字以下是真正的空白/错误页；50~199 字只算“偏少”（R-07b）。
 * 200 字一刀切会把 example.com 这类真实但简短的页面永久判坏，反而逼用户忽略告警。
 */
const r07 = ({ fetch: f, charCount, baseline }) => {
  if (!f.ok) return null;
  if (charCount >= 50) return null;
  const baselineLen = Number(baseline?.textLen ?? 0);
  if (baselineLen > 0 && baselineLen < 50) return null;
  return { level: 'bad', reason: `正文仅 ${charCount} 字，接近空白页` };
};

/** R-07b 正文偏少：内容真实但不足 200 字，首次抓取允许作为基线，只提醒不判故障。 */
const r07b = ({ fetch: f, charCount, baseline }) => {
  if (!f.ok || charCount < 50 || charCount >= 200) return null;
  const baselineLen = Number(baseline?.textLen ?? 0);
  if (baselineLen > 0 && baselineLen < 200) return null;
  return { level: 'suspect', reason: `正文仅 ${charCount} 字，内容偏少` };
};

/** R-08 正文骤降 */
const r08 = ({ fetch: f, charCount, baseline }) => {
  if (!f.ok) return null;
  const baselineLen = Number(baseline?.textLen ?? 0);
  if (baselineLen <= 0) return null;
  if (charCount >= baselineLen * 0.3) return null;
  return { level: 'bad', reason: `正文由 ${baselineLen} 字降至 ${charCount} 字` };
};

/** R-09 关键断言缺失 */
const r09 = ({ fetch: f, text, mustContain }) => {
  if (!f.ok || !Array.isArray(mustContain) || !mustContain.length) return null;
  const missing = mustContain.find((item) => item && !text.includes(item));
  return missing ? { level: 'bad', reason: `缺少必须包含的文字「${missing}」` } : null;
};

/** R-10 反爬挑战 */
const r10 = ({ fetch: f, html, text }) => {
  if (!f.ok) return null;
  const haystack = `${html.slice(0, 200_000)}\n${text}`.toLowerCase();
  const hit = hitWord(haystack, ANTIBOT_WORDS);
  return hit ? { level: 'unknown', reason: `疑似反爬挑战页（${hit}），无法确认内容` } : null;
};

/** R-11 需要登录 */
const r11 = ({ fetch: f, text }) => {
  if (!f.ok) return null;
  if (f.finalUrl && LOGIN_PATH.test(pathOf(f.finalUrl))) {
    return { level: 'unknown', reason: '页面要求登录，无法确认内容' };
  }
  const hit = hitWord(text.toLowerCase(), LOGIN_TEXT);
  return hit ? { level: 'unknown', reason: '页面要求登录，无法确认内容' } : null;
};

/** R-12 SPA 空壳 */
const r12 = ({ fetch: f, charCount, html }) => {
  if (!f.ok || charCount >= 200) return null;
  if (!/<div[^>]+id\s*=\s*["'](?:app|root)["']/i.test(html) && !html.includes('__NEXT_DATA__')) return null;
  return { level: 'unknown', reason: '该页依赖 JS 渲染，抓取到的是空壳' };
};

/** R-13 响应缓慢 */
const r13 = ({ fetch: f }) => {
  if (!f.ok || !f.responseMs || f.responseMs <= 10_000) return null;
  return { level: 'suspect', reason: `响应耗时 ${f.responseMs}ms，超过 10 秒` };
};

/** R-14 正文下降 */
const r14 = ({ fetch: f, charCount, baseline }) => {
  if (!f.ok) return null;
  const baselineLen = Number(baseline?.textLen ?? 0);
  if (baselineLen <= 0) return null;
  const ratio = charCount / baselineLen;
  if (ratio < 0.3 || ratio >= 0.6) return null;
  return { level: 'suspect', reason: `正文较基线下降 ${Math.round((1 - ratio) * 100)}%` };
};

/** R-15 同域跳转（同样以请求地址为参照） */
const r15 = ({ fetch: f, url, baseUrl }) => {
  if (!f.ok || !f.finalUrl) return null;
  const reference = url || baseUrl;
  if (hostOf(f.finalUrl) !== hostOf(reference)) return null;
  const target = pathOf(f.finalUrl);
  const requested = pathOf(reference);
  if (!target || !requested || target === requested) return null;
  return { level: 'suspect', reason: `被重定向到 ${target}` };
};

export const RULES = [r01, r02, r03, r04, r05, r06, r07, r07b, r08, r09, r10, r11, r12, r13, r14, r15];

const PRIORITY = ['unknown', 'bad', 'suspect'];

/**
 * @param {{
 *   fetch: { ok: boolean, status?: number, contentType?: string, finalUrl?: string, responseMs?: number, error?: string, message?: string },
 *   baseUrl: string, html: string, title: string, text: string, charCount: number,
 *   mustContain?: string[], baseline?: { textLen: number, hash: string } | null
 * }} ctx
 */
export function evaluate(ctx) {
  const hits = [];
  for (const rule of RULES) {
    let hit = null;
    try {
      hit = rule(ctx);
    } catch {
      // 单条规则异常不能改变结论：跳过它，其余规则继续。
      hit = null;
    }
    if (hit) hits.push(hit);
  }

  const verdict = PRIORITY.find((level) => hits.some((hit) => hit.level === level)) ?? 'normal';
  return {
    verdict,
    reasons: hits.map((hit) => ({ hit: true, level: hit.level, text: hit.reason }))
  };
}
