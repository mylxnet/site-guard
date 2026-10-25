import {
  getSite,
  getSnapshot,
  promoteBaseline,
  insertSnapshot,
  insertCheck,
  pruneSnapshots,
  setPageState,
  addEvent
} from './db.js';
import { fetchPage as defaultFetch } from './fetch-page.js';
import { extractHtml } from './extract.js';
import { evaluate } from './verdict.js';
import { hashText, diffLines } from './diff.js';

/**
 * 单页检测：抓取 → 提取 → 判定 → 与基线比对 → 落库 → 生成事件。
 * 不负责发信（0.6.0），也不负责调度（scheduler）。每次调用只处理一个页面，
 * 这样 runner 能在页间控制间隔，单页复检接口也能直接复用。
 */
export function createChecker({ db, config, logger, fetchPage = defaultFetch }) {
  const fetchOptions = {
    timeoutMs: config.fetchTimeoutMs,
    maxBytes: config.fetchMaxBytes,
    retries: config.fetchRetries,
    retryDelayMs: config.fetchRetryDelayMs,
    userAgent: `SiteGuard/${config.version} (+self-hosted monitor)`
  };

  return async function checkPage(page, { site = null, trigger = 'manual', batchId = null } = {}) {
    const home = site ?? getSite(db, page.site_id) ?? { base_url: page.url };

    // 基线必须在抓取前读：本轮结果只和“本轮之前”的基线比。
    const baseline = page.baseline_id ? getSnapshot(db, page.baseline_id) : null;

    const fetched = await fetchPage(page.url, fetchOptions);
    const extracted = fetched.ok
      ? extractHtml(fetched.html, { ignorePatterns: page.ignorePatterns })
      : { title: '', text: '', lines: [], charCount: 0, ignoredLines: 0 };

    const baselineInfo = baseline
      ? { textLen: Number(baseline.meta.textLen ?? baseline.text.length), hash: baseline.hash, title: baseline.meta.title ?? '' }
      : null;

    const { verdict, reasons } = evaluate({
      fetch: fetched,
      url: page.url,
      baseUrl: home.base_url,
      html: fetched.ok ? fetched.html : '',
      title: extracted.title,
      text: extracted.text,
      charCount: extracted.charCount,
      mustContain: page.mustContain,
      baseline: baselineInfo
    });

    const hash = hashText(extracted.text);
    const contentChanged = Boolean(baseline) && hash !== baseline.hash;

    const snapshotMeta = {
      verdict,
      httpCode: fetched.ok ? fetched.status : null,
      responseMs: fetched.responseMs,
      finalUrl: fetched.ok ? fetched.finalUrl : page.url,
      title: extracted.title,
      textLen: extracted.charCount,
      truncated: Boolean(fetched.truncated),
      error: fetched.ok ? null : fetched.error
    };

    const snapshotId = fetched.ok
      ? insertSnapshot(db, { pageId: page.id, kind: 'check', hash, text: extracted.text, meta: snapshotMeta })
      : null;

    insertCheck(db, {
      batchId: batchId ?? `single-${page.id}-${Date.now()}`,
      pageId: page.id,
      verdict,
      httpCode: fetched.ok ? fetched.status : null,
      responseMs: fetched.responseMs,
      finalUrl: fetched.ok ? fetched.finalUrl : page.url,
      title: extracted.title || null,
      textLen: extracted.charCount,
      changed: verdict === 'normal' && contentChanged,
      reasons
    });

    const prevState = page.state;
    const prevChanged = page.changed;
    // 新页面初始 state 就是 unknown，不能因此把“第一次就判不出”当成“无变化”而静默。
    const neverChecked = !page.last_checked_at;
    let pageChanged = false;
    let baselineId;
    let message = '';
    let diff = null;
    let event = null;

    // suspect 也可以建基线：慢响应、正文偏少只影响“健康结论”，内容本身是有效的。
    // 但 bad/unknown 绝不能当基准：错误页、反爬页一旦成基线，以后每次都“内容变更”。
    const canBaseline = !baseline && snapshotId && (verdict === 'normal' || verdict === 'suspect');

    if (canBaseline) {
      // 必须把快照标记成 baseline：否则 60 份 check 的保留策略会把它清掉。
      promoteBaseline(db, page.id, snapshotId);
      baselineId = snapshotId;
      const suffix = verdict === 'normal' ? '' : ` · ${reasons[0]?.text ?? ''}`;
      message = `已建立基线（${extracted.charCount} 字）${suffix}`;
      event = { type: 'system', message };
    } else if (verdict !== 'normal') {
      message = reasons.map((reason) => reason.text).slice(0, 3).join('；') || '无法确认';
      if (neverChecked || prevState !== verdict) event = { type: verdict, message };
    } else if (!baseline) {
      message = '抓取成功但没有可保存的正文';
    } else if (contentChanged) {
      pageChanged = true;
      diff = diffLines(baseline.text, extracted.text);
      message = `内容有变化：新增 ${diff.addedCount} 行、删除 ${diff.removedCount} 行`;
      if (!prevChanged) event = { type: 'changed', message };
    } else {
      message = '与基线一致';
    }

    // 从异常/无法确认回到正常，优先级高于“内容变更”：用户最关心的是“恢复了”。
    if (verdict === 'normal' && baseline && prevState && prevState !== 'normal') {
      event = { type: 'recovered', message: `已恢复正常（${prevState} → 正常）` };
    }

    // 注意 baselineId 不能只在 normal 分支传：suspect 首次抓取同样要落基线。
    setPageState(db, page.id, {
      state: verdict,
      changed: verdict === 'normal' ? pageChanged : false,
      message,
      baselineId
    });

    if (event) {
      addEvent(db, {
        batchId: batchId ?? null,
        siteId: page.site_id,
        pageId: page.id,
        type: event.type,
        message: event.message
      });
    }

    if (snapshotId) pruneSnapshots(db, page.id, 60);

    logger.debug('check.page', {
      page: page.id,
      verdict,
      changed: pageChanged,
      ms: fetched.responseMs,
      len: extracted.charCount,
      trigger
    });

    return {
      pageId: page.id,
      verdict,
      changed: pageChanged,
      contentChanged,
      message,
      reasons,
      httpCode: fetched.ok ? fetched.status : null,
      responseMs: fetched.responseMs,
      textLen: extracted.charCount,
      title: extracted.title,
      finalUrl: fetched.ok ? fetched.finalUrl : page.url,
      snapshotId,
      baselineId: baselineId ?? page.baseline_id ?? null,
      diff: diff ? { addedCount: diff.addedCount, removedCount: diff.removedCount } : null,
      eventType: event?.type ?? null
    };
  };
}
