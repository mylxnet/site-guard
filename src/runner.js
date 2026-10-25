import { listPages } from './db.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const detailOf = (result) => {
  if (result.httpCode == null) return '';
  return `（HTTP ${result.httpCode} · ${result.responseMs ?? 0}ms · ${result.textLen ?? 0} 字）`;
};

/**
 * 一轮巡检的执行器：负责遍历页面、拉间隔、汇总结果。
 * 单页的抓取/判定在 checker.js，这里只管节奏与整轮成败。
 */
export function createSiteRunner({ db, logger, config, checkPage = null }) {
  const gapMs = Math.max(0, Number(config.pageGapMs ?? 3000));

  return async function runSite(site, { batchId, trigger, line, progress = () => {} }) {
    const pages = listPages(db, site.id).filter((page) => page.enabled);
    line(`站点「${site.name}」共 ${pages.length} 个页面`);
    progress({ total: pages.length, done: 0 });

    if (!pages.length) {
      return { verdicts: {}, changed: 0, checked: 0, skipped: 0, events: 0 };
    }

    if (!checkPage) {
      line('检测引擎未接入，本轮只演练调度，不抓取页面');
      logger.warn('engine.missing', { site: site.id, batch: batchId, pages: pages.length });
      return { verdicts: {}, changed: 0, checked: 0, skipped: pages.length, events: 0 };
    }

    const summary = { verdicts: {}, changed: 0, checked: 0, skipped: 0, events: 0 };

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (index > 0 && gapMs) await sleep(gapMs);

      try {
        const result = await checkPage(page, { site, trigger, batchId });
        summary.checked += 1;
        summary.verdicts[result.verdict] = (summary.verdicts[result.verdict] ?? 0) + 1;
        if (result.changed) summary.changed += 1;
        if (result.eventType) summary.events += 1;
        line(
          `${page.name}：${result.verdict}${result.changed ? ' · 内容变更' : ''}${detailOf(result)}${
            result.verdict !== 'normal' && result.message ? ` · ${result.message}` : ''
          }`
        );
      } catch (err) {
        // 单页失败不能拖垮整轮：记录后继续下一页。
        summary.skipped += 1;
        line(`${page.name}：执行失败（${err.message}）`);
        logger.error('check.page.fail', { page: page.id, message: err.message });
      } finally {
        progress({ done: index + 1, total: pages.length });
      }
    }

    return summary;
  };
}
