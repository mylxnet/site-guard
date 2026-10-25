import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { config as baseConfig } from '../src/config.js';
import { createSite, createPage } from '../src/db.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('启动补跑：错过周期会立刻跑一轮，期间手动巡检被 409 拦住', async () => {
  let checks = 0;
  // 用闸门卡住补跑：先确认“正在跑”，再断言手动巡检 409，避免靠 sleep 撞时机。
  let releaseGate = () => {};
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });

  const app = createApp({
    config: {
      ...baseConfig,
      dbFile: ':memory:',
      schedulerTickMs: 60_000,
      pageGapMs: 0,
      maxConcurrency: 2
    },
    logger: silentLogger,
    checkPage: async (page) => {
      checks += 1;
      await gate;
      return { verdict: 'normal', changed: false, page: page.id };
    }
  });

  const site = createSite(app.db, {
    name: '示例科技',
    baseUrl: 'https://www.example.com/',
    scheduleMode: 'daily',
    scheduleValue: '09:00, 21:00',
    timezone: 'Asia/Shanghai',
    enabled: true,
    nextRunAt: Date.now() - 19 * 3600_000
  });
  app.db
    .prepare('UPDATE sites SET last_run_at = ? WHERE id = ?')
    .run(Date.now() - 19 * 3600_000, site.id);
  createPage(app.db, site.id, { name: '主页', url: 'https://www.example.com/', mustContain: [], ignorePatterns: [] });

  const address = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;

  let cookie = '';
  const setup = await fetch(`${base}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: '12345678' })
  });
  cookie = setup.headers.getSetCookie()[0].split(';')[0];

  try {
    // 等补跑真的进入运行态，再断言手动巡检被拦；没等到就是调度器没拉起，直接失败。
    let running = false;
    for (let i = 0; i < 80 && !running; i += 1) {
      running = app.scheduler.isRunning(site.id);
      if (!running) await sleep(25);
    }
    assert.ok(running, '启动补跑应当已经开始');

    const blocked = await fetch(`${base}/api/sites/${site.id}/run`, { method: 'POST', headers: { cookie } });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error.code, 'CONFLICT');

    // 放行补跑，再等它收尾。
    releaseGate();
    for (let i = 0; i < 80 && app.scheduler.isRunning(site.id); i += 1) await sleep(25);
    assert.equal(checks, 1, '补跑应只跑一轮');

    const triggered = await fetch(`${base}/api/sites/${site.id}/run`, { method: 'POST', headers: { cookie } });
    assert.equal(triggered.status, 200);
    const { batchId } = (await triggered.json()).data;

    let batch = null;
    for (let i = 0; i < 40; i += 1) {
      const res = await fetch(`${base}/api/batches/${batchId}`, { headers: { cookie } });
      batch = (await res.json()).data;
      if (batch.status !== 'running') break;
      await sleep(25);
    }

    assert.equal(batch.status, 'done');
    assert.equal(batch.summary.checked, 1);
    assert.equal(batch.summary.verdicts.normal, 1);

    const sites = await (await fetch(`${base}/api/sites`, { headers: { cookie } })).json();
    const refreshed = sites.data.find((item) => item.id === site.id);
    assert.ok(refreshed.lastRunAt > Date.now() - 5000);
    assert.ok(refreshed.nextRunAt > Date.now(), '跑完必须排下一轮');
  } finally {
    releaseGate();
    await app.close();
  }
});
