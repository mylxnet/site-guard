/**
 * 正文提取与归一化（PROJECT.md 4.2）。
 * 任何输入都不抛错：解析失败退化成空正文，交给判定层报“接近空白页”，
 * 而不是让一个畸形页面把整轮巡检打挂。
 */

const INLINE_SPACE = /[\t\f\v\r\n\u00a0\u3000 ]+/g;
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;

const NAMED_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  mdash: '—',
  copy: '©'
};

/**
 * 与被丢弃的容器标签：内容整体无意义（脚本、样式、内嵌框架等）。
 * head 也要丢：<title> 已单独提取，留在正文里会把标题重复计入字数。
 */
const DROP_BLOCKS = /<(script|style|noscript|svg|iframe|template|canvas|object|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DROP_OPEN = /<(script|style|noscript|svg|iframe|template|canvas|object|head)\b[^>]*\/?>/gi;

/** 块级标签的结束位置就是“换行”：它们是正文的段落边界。 */
const BLOCK_CLOSE =
  /<\/(?:p|div|li|tr|td|th|h[1-6]|section|article|header|footer|main|aside|nav|table|thead|tbody|tfoot|ul|ol|dl|dt|dd|blockquote|pre|figure|figcaption|form|fieldset|address)\s*>/gi;

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

const collapse = (line) => String(line ?? '').replace(INLINE_SPACE, ' ').trim();

/** 编译忽略规则；单条写错只丢这一条，不影响整页。 */
export function compileIgnorePatterns(patterns = []) {
  const out = [];
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    try {
      out.push(new RegExp(String(pattern)));
    } catch {
      // 入库前已校验过；这里只是兜底，忽略坏规则比整页失败合理。
    }
  }
  return out;
}

export function extractTitle(html, { maxLength = 200 } = {}) {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html ?? ''));
  if (!match) return '';
  const text = collapse(decodeEntities(match[1].replace(/<[^>]*>/g, ' ')));
  return text.slice(0, maxLength);
}

/**
 * 主入口。
 * @param {string} html 原始 HTML
 * @param {{ ignorePatterns?: string[], maxTitle?: number }} options
 * @returns {{ title: string, text: string, lines: string[], charCount: number, ignoredLines: number }}
 */
export function extractHtml(html, { ignorePatterns = [], maxTitle = 200 } = {}) {
  // 只接受字符串：数字/对象说明上游给错了，返回空正文让判定层报异常，比 String() 出垃圾更诚实。
  const raw = typeof html === 'string' ? html : '';
  const title = extractTitle(raw, { maxLength: maxTitle });

  let work = raw;
  try {
    work = work
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(DROP_BLOCKS, ' ')
      // 未闭合的 <script> 会让后面的正文全被吞掉；截到文末更接近可见内容。
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*$/gi, ' ')
      // 缺 <head> 的碎片 HTML 里 <title> 仍会被当正文，单独再清一次。
      .replace(/<title[^>]*>[\s\S]*?<\/title\s*>/gi, ' ')
      .replace(DROP_OPEN, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK_CLOSE, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(ZERO_WIDTH, '');

    work = decodeEntities(work);
  } catch {
    // 正则回溯异常等极端情况：宁可空正文，也不要抛给调度器。
    work = '';
  }

  const patterns = compileIgnorePatterns(ignorePatterns);
  const seen = work.split(/\r?\n/).map(collapse).filter(Boolean);
  const kept = seen.filter((line) => !patterns.some((regex) => regex.test(line)));

  const text = kept.join('\n');
  return {
    title,
    text,
    lines: kept,
    // “字”按可见字符算，不含换行，避免长页面被行数虚高。
    charCount: text.replace(/\n/g, '').length,
    ignoredLines: seen.length - kept.length
  };
}
