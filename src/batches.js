/**
 * 批次进度只存内存（最多保留 20 条）：
 * 前端轮询需要的是“这一轮现在跑到哪了”，进程重启后回落到读 checks 即可，
 * 没有必要为此写库、也没有必要在重启后假装上一轮还在跑。
 */
export function createBatchStore({ limit = 20 } = {}) {
  const batches = new Map();

  const prune = () => {
    while (batches.size > limit) {
      const oldest = [...batches.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
      if (!oldest) break;
      batches.delete(oldest.id);
    }
  };

  return {
    create({ siteId, siteName, trigger }) {
      const now = Date.now();
      let id = `${siteId}-${now}`;
      if (batches.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;

      const batch = {
        id,
        siteId,
        siteName,
        trigger,
        status: 'running',
        startedAt: now,
        finishedAt: null,
        total: 0,
        done: 0,
        lines: [],
        summary: null
      };
      batches.set(id, batch);
      prune();
      return batch;
    },

    get(id) {
      return batches.get(id) ?? null;
    },

    runningForSite(siteId) {
      for (const batch of batches.values()) {
        if (batch.siteId === siteId && batch.status === 'running') return batch;
      }
      return null;
    },

    progress(id, { done, total }) {
      const batch = batches.get(id);
      if (!batch) return;
      if (typeof total === 'number') batch.total = total;
      if (typeof done === 'number') batch.done = done;
    },

    line(id, text) {
      const batch = batches.get(id);
      if (!batch) return;
      batch.lines.push(text);
      if (batch.lines.length > 200) batch.lines.splice(0, batch.lines.length - 200);
    },

    finish(id, { status = 'done', summary = null } = {}) {
      const batch = batches.get(id);
      if (!batch) return null;
      batch.status = status;
      batch.finishedAt = Date.now();
      batch.summary = summary;
      return batch;
    }
  };
}
