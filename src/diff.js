import crypto from 'node:crypto';

/**
 * 指纹与差异（PROJECT.md 4.4）。
 * 用多重集合差集而不是 LCS：列表页动辄几千行，LCS 的 O(n·m) 在 NAS 上会拖垮一轮巡检；
 * 差集能回答“多了什么、少了什么”，且不受段落重排影响。
 */

const DEFAULT_LIMIT = 200;

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

const splitLines = (text) => String(text ?? '').split('\n').filter((line) => line.length > 0);

const countOf = (lines) => {
  const map = new Map();
  for (const line of lines) map.set(line, (map.get(line) ?? 0) + 1);
  return map;
};

/** 按原文本顺序取出“多出来的”那一侧，重复行按差值分配。 */
const excess = (lines, own, other) => {
  const quota = new Map();
  for (const [line, count] of own) {
    const extra = count - (other.get(line) ?? 0);
    if (extra > 0) quota.set(line, extra);
  }
  const out = [];
  for (const line of lines) {
    const left = quota.get(line) ?? 0;
    if (left <= 0) continue;
    quota.set(line, left - 1);
    out.push(line);
  }
  return out;
};

/**
 * @param {string} before 基线正文
 * @param {string} after  本次正文
 * @param {{ limit?: number }} options 每个方向最多输出的行数
 * @returns {{ added: string[], removed: string[], addedCount: number, removedCount: number, truncated: boolean }}
 */
export function diffLines(before, after, { limit = DEFAULT_LIMIT } = {}) {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const oldCount = countOf(oldLines);
  const newCount = countOf(newLines);

  const removed = excess(oldLines, oldCount, newCount);
  const added = excess(newLines, newCount, oldCount);

  const cap = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  return {
    added: added.slice(0, cap),
    removed: removed.slice(0, cap),
    addedCount: added.length,
    removedCount: removed.length,
    truncated: added.length > cap || removed.length > cap
  };
}
