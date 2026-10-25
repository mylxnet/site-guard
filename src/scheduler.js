import { listSites, getSite, markSiteRun } from './db.js';
import { isDue, isCatchUp, nextRunAt, localParts } from './schedule.js';
import { conflict, notFound } from './http.js';

const MAX_ROUNDS_PER_DAY = 24;
const CATCHUP_CHECK_MS = 60 * 60 * 1000;

const triggerLabel = (trigger) => {
  if (trigger === 'manual') return '手动';
  if (trigger === 'catchup') return '补跑';
  return '计划';
};

export function createScheduler({
  db,
  config,
  logger,
  batches,
  runSite,
  notifyBatch = null,
  intervalMs = 20_000,
  maxConcurrency = 2
}) {
  const running = new Set();
  const rounds = new Map(); // siteId -> { date, count }
  let active = 0;
  let timer = null;
  let ticking = false;
  let lastCatchUpCheck = 0;

  const localDate = (site, now) => {
    const p = localParts(now, site.timezone || config.timezone);
    return `${p.year}-${p.month}-${p.day}`;
  };

  function roundBudget(site, now) {
    const entry = rounds.get(site.id);
    if (!entry || entry.date !== localDate(site, now)) return MAX_ROUNDS_PER_DAY;
    return MAX_ROUNDS_PER_DAY - entry.count;
  }

  function consumeRound(site, now) {
    const date = localDate(site, now);
    const entry = rounds.get(site.id);
    if (!entry || entry.date !== date) rounds.set(site.id, { date, count: 1 });
    else entry.count += 1;
  }

  /** 建批次、占并发位、异步开跑。同步返回批次，前端立刻拿到 batchId。 */
  function begin(site, trigger) {
    const batch = batches.create({ siteId: site.id, siteName: site.name, trigger });
    running.add(site.id);
    active += 1;
    const startedAt = Date.now();
    batches.line(batch.id, `开始巡检 · 触发方式：${triggerLabel(trigger)}`);
    logger.info('site.run.start', { site: site.id, batch: batch.id, trigger });

    void (async () => {
      let summary = null;
      let failure = null;

      try {
        summary = await runSite(site, {
          batchId: batch.id,
          trigger,
          line: (text) => batches.line(batch.id, text),
          progress: (state) => batches.progress(batch.id, state)
        });
      } catch (err) {
        failure = err;
        batches.line(batch.id, `本轮执行失败：${err.message}`);
        logger.error('batch.fail', { site: site.id, batch: batch.id, message: err.message });
      }

      running.delete(site.id);
      active -= 1;

      // 先算下一轮再落库：interval 模式依赖“本次结束时刻”，不是本次开始时刻。
      // 运行期间用户可能改了计划或删了站点，所以重新读一次库，而不是用开始时的快照。
      const finishedAt = Date.now();
      const fresh = getSite(db, site.id);
      let next = null;
      if (fresh) {
        next = nextRunAt({ ...fresh, last_run_at: finishedAt }, finishedAt);
        markSiteRun(db, site.id, { lastRunAt: finishedAt, nextRunAt: next });
        batches.line(batch.id, `下一轮：${new Date(next).toISOString()}`);
      } else {
        batches.line(batch.id, '站点已被删除，本轮结果不再排期');
      }

      if (failure) {
        batches.finish(batch.id, { status: 'error', summary: { error: failure.message } });
        return;
      }

      batches.finish(batch.id, { status: 'done', summary });
      logger.info('batch.finish', {
        site: site.id,
        batch: batch.id,
        ms: Date.now() - startedAt,
        ...summary
      });

      // 邮件在批次结束后发：失败不影响本轮结论，事件保持未通知，留给下一轮。
      if (notifyBatch) {
        try {
          const result = await notifyBatch({
            site: fresh ?? site,
            batchId: batch.id,
            summary,
            nextRunAt: next,
            trigger
          });
          if (result?.sent) batches.line(batch.id, `已发送汇总邮件（${result.included} 条事件）`);
          else if (result?.reason) batches.line(batch.id, `未发送邮件：${result.reason}`);
        } catch (err) {
          batches.line(batch.id, `邮件发送异常：${err.message}`);
          logger.error('mail.batch.error', { site: site.id, batch: batch.id, message: err.message });
        }
      }
    })();

    return batch;
  }

  function schedule(site, trigger, now = Date.now()) {
    if (roundBudget(site, now) <= 0) {
      logger.warn('site.skip.daily-cap', { site: site.id, cap: MAX_ROUNDS_PER_DAY });
      return null;
    }
    consumeRound(site, now);
    return begin(site, trigger);
  }

  function catchUp(now = Date.now()) {
    for (const site of listSites(db)) {
      if (!site.enabled || running.has(site.id)) continue;
      if (!isCatchUp(site, now)) continue;
      if (active >= maxConcurrency) break;
      logger.info('site.run.catchup', { site: site.id, lastRunAt: site.last_run_at });
      schedule(site, 'catchup', now);
    }
  }

  function tick(now = Date.now()) {
    if (ticking) return;
    ticking = true;
    try {
      if (now - lastCatchUpCheck > CATCHUP_CHECK_MS) {
        lastCatchUpCheck = now;
        catchUp(now);
      }

      const due = listSites(db)
        .filter((site) => site.enabled && !running.has(site.id) && isDue(site, now))
        .sort((a, b) => Number(a.next_run_at ?? 0) - Number(b.next_run_at ?? 0));

      for (const site of due) {
        if (active >= maxConcurrency) break;
        schedule(site, 'schedule', now);
      }
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      if (timer) return;
      lastCatchUpCheck = Date.now();
      tick();
      timer = setInterval(() => tick(), intervalMs);
      timer.unref?.();
      logger.info('scheduler.start', { intervalMs, maxConcurrency });
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    tick,

    isRunning: (siteId) => running.has(Number(siteId)),

    /** 手动巡检：守卫同步抛（404/409），任务异步跑。 */
    triggerSite(siteId, trigger = 'manual') {
      const site = getSite(db, siteId);
      if (!site) throw notFound('站点不存在');
      if (running.has(site.id)) throw conflict('该站点正在巡检中');
      if (active >= maxConcurrency) {
        throw conflict(`当前已有 ${maxConcurrency} 个站点在巡检，请稍后再试`);
      }
      return begin(site, trigger);
    }
  };
}
