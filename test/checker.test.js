import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, createSite, createPage, updatePage, getPage, latestCheck, getSnapshot, listEvents } from '../src/db.js';
import { createChecker } from '../src/checker.js';
import { config as baseConfig } from '../src/config.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const LONG = '示例科技提供网站监测与防篡改服务，这段正文足够长，避免触发空白页规则。'.repeat(6);

const html = (text, title = '示例科技') =>
  `<!doctype html><html><head><title>${title}</title></head><body><p>${text}</p></body></html>`;

const ok = (text, title, extra = {}) => ({
  ok: true,
  status: 200,
  finalUrl: 'https://www.example.com/',
  contentType: 'text/html; charset=utf-8',
  html: html(text, title),
  responseMs: 120,
  truncated: false,
  bytes: 1000,
  redirects: 0,
  ...extra
});

let db;
let site;
let checkPage;
let reply;

const run = (page) => checkPage(page, { site, trigger: 'manual' });
const eventsOf = (pageId) => listEvents(db, { limit: 100 }).filter((event) => event.page_id === pageId);

before(() => {
  db = openDb(':memory:');
  site = createSite(db, {
    name: '示例科技',
    baseUrl: 'https://www.example.com/',
    scheduleMode: 'daily',
    scheduleValue: '09:00',
    timezone: 'Asia/Shanghai',
    enabled: true,
    nextRunAt: Date.now()
  });
  reply = () => ok(LONG);
  checkPage = createChecker({
    db,
    logger: silentLogger,
    config: { ...baseConfig, fetchRetries: 0 },
    // 假抓取也要返回“请求的地址”，否则同域跳转规则会把每个子路径页判成被重定向。
    fetchPage: async (url) => {
      const result = reply();
      return result.ok ? { ...result, finalUrl: url } : result;
    }
  });
});

after(() => db.close());

test('首次成功抓取建立基线，并写检测记录与系统事件', async () => {
  const page = createPage(db, site.id, { name: '主页', url: 'https://www.example.com/', mustContain: ['示例科技'] });
  reply = () => ok(LONG);

  const result = await run(page);
  assert.equal(result.verdict, 'normal');
  assert.equal(result.changed, false);
  assert.equal(result.eventType, 'system');
  assert.ok(result.baselineId > 0);
  assert.ok(result.snapshotId > 0);
  assert.equal(result.textLen, LONG.length);

  const fresh = getPage(db, page.id);
  assert.equal(fresh.state, 'normal');
  assert.equal(fresh.changed, false);
  assert.equal(fresh.baseline_id, result.snapshotId);
  assert.ok(fresh.last_checked_at > 0);
  assert.match(fresh.last_message, /已建立基线/);

  const snapshot = getSnapshot(db, fresh.baseline_id);
  assert.equal(snapshot.kind, 'baseline', '基线快照必须标记为 baseline，否则会被保留策略清掉');
  assert.equal(snapshot.hash.length, 64);

  const check = latestCheck(db, page.id);
  assert.equal(check.verdict, 'normal');
  assert.equal(check.changed, false);
  assert.deepEqual(check.reasons, []);

  const events = eventsOf(page.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'system');
  assert.equal(events[0].notified, false);
});

test('内容未变不产生新事件，changed 保持 false', async () => {
  const page = db.prepare("SELECT * FROM pages WHERE name = '主页'").get();
  const row = getPage(db, page.id);
  const before = eventsOf(page.id).length;

  const result = await run(row);
  assert.equal(result.verdict, 'normal');
  assert.equal(result.changed, false);
  assert.equal(result.contentChanged, false);
  assert.equal(result.eventType, null);
  assert.match(result.message, /与基线一致/);
  assert.equal(eventsOf(page.id).length, before);
});

test('内容变化：标记 changed、算差异、产生 changed 事件，基线不动', async () => {
  const page = db.prepare("SELECT * FROM pages WHERE name = '主页'").get();
  const row = getPage(db, page.id);
  const baselineId = row.baseline_id;
  const before = eventsOf(page.id).length;

  reply = () => ok(`${LONG}\n新增公告：11 月 8 日发布会`);
  const result = await run(row);

  assert.equal(result.verdict, 'normal');
  assert.equal(result.contentChanged, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.diff, { addedCount: 1, removedCount: 0 });
  assert.deepEqual(result.reasons, []);

  const fresh = getPage(db, page.id);
  assert.equal(fresh.changed, true);
  assert.equal(fresh.baseline_id, baselineId, '未确认前基线不能自动更新');
  assert.match(fresh.last_message, /新增 1 行/);

  assert.equal(latestCheck(db, page.id).changed, true);

  const events = eventsOf(page.id);
  assert.equal(events.length, before + 1);
  assert.equal(events[0].type, 'changed');
});

test('内容持续变化不重复发事件（等用户确认）', async () => {
  const row = db.prepare("SELECT * FROM pages WHERE name = '主页'").get();
  const page = getPage(db, row.id);
  const before = eventsOf(page.id).length;

  reply = () => ok(`${LONG}\n新增公告：11 月 8 日发布会\n再加一条`);
  const result = await run(page);
  assert.equal(result.changed, true);
  assert.equal(result.eventType, null, 'changed 持续时不应重复产生事件');
  assert.equal(eventsOf(page.id).length, before);
});

test('页面异常：状态转 bad、产生 bad 事件、不覆盖基线', async () => {
  const row = db.prepare("SELECT * FROM pages WHERE name = '主页'").get();
  const page = getPage(db, row.id);
  const baselineId = page.baseline_id;

  reply = () => ok('502 Bad Gateway nginx', '502 Bad Gateway', { status: 502 });
  const result = await run(page);

  assert.equal(result.verdict, 'bad');
  assert.equal(result.changed, false);
  assert.equal(result.eventType, 'bad');
  assert.ok(result.reasons.some((reason) => reason.level === 'bad'));

  const fresh = getPage(db, page.id);
  assert.equal(fresh.state, 'bad');
  assert.equal(fresh.changed, false);
  assert.equal(fresh.baseline_id, baselineId, '异常页不能顶掉基线');
});

test('异常持续不重复发事件，恢复时发 recovered', async () => {
  const row = db.prepare("SELECT * FROM pages WHERE name = '主页'").get();
  const page = getPage(db, row.id);
  const before = eventsOf(page.id).length;

  const stillBad = await run(page);
  assert.equal(stillBad.eventType, null);
  assert.equal(eventsOf(page.id).length, before);

  reply = () => ok(`${LONG}\n新增公告：11 月 8 日发布会\n再加一条`);
  const recovered = await run(getPage(db, page.id));
  assert.equal(recovered.verdict, 'normal');
  assert.equal(recovered.eventType, 'recovered');

  const latest = eventsOf(page.id)[0];
  assert.equal(latest.type, 'recovered');
  assert.match(latest.message, /已恢复正常/);

  const fresh = getPage(db, page.id);
  assert.equal(fresh.state, 'normal');
  assert.equal(fresh.changed, true, '恢复后仍需用户确认内容变更');
});

test('抓取失败归类为 bad，且不写入快照', async () => {
  const page = createPage(db, site.id, { name: '列表页', url: 'https://www.example.com/list' });
  reply = () => ({ ok: false, error: 'TIMEOUT', message: '请求超时（20s）', responseMs: 20_000 });

  const result = await run(page);
  assert.equal(result.verdict, 'bad');
  assert.equal(result.snapshotId, null);
  assert.match(result.reasons[0].text, /TIMEOUT/);

  const fresh = getPage(db, page.id);
  assert.equal(fresh.state, 'bad');
  assert.equal(fresh.baseline_id, null);
});

test('反爬挑战判 unknown，不建基线', async () => {
  const page = createPage(db, site.id, { name: '详情页', url: 'https://www.example.com/post/1' });
  reply = () => ok('Just a moment...', 'Just a moment...', {
    status: 503,
    html: '<html><head><title>Just a moment...</title></head><body><div id="challenge">Checking your browser</div></body></html>'
  });

  const result = await run(page);
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.eventType, 'unknown');
  assert.equal(getPage(db, page.id).baseline_id, null);
});

test('慢响应判 suspect，但内容可信仍可建基线', async () => {
  const page = createPage(db, site.id, { name: '帮助中心', url: 'https://www.example.com/help' });
  reply = () => ({ ...ok(LONG), responseMs: 12_500 });

  const result = await run(page);
  assert.equal(result.verdict, 'suspect');
  assert.equal(result.eventType, 'system');
  assert.ok(result.baselineId > 0, 'suspect 的内容是真实的，应当作为基线');
  assert.match(result.message, /已建立基线/);
  assert.match(result.message, /12500ms/);

  const fresh = getPage(db, page.id);
  assert.equal(fresh.state, 'suspect');
  assert.equal(fresh.baseline_id, result.baselineId);
});

test('忽略规则让时间戳变化不触发内容变更', async () => {
  const page = createPage(db, site.id, {
    name: '带时间戳的页面',
    url: 'https://www.example.com/notice',
    ignorePatterns: ['^更新时间：']
  });

  reply = () => ok(`${LONG}\n更新时间：2026-10-25 12:00`);
  await run(page);
  const baselineId = getPage(db, page.id).baseline_id;
  assert.ok(baselineId > 0);

  reply = () => ok(`${LONG}\n更新时间：2027-01-01 09:00`);
  const result = await run(getPage(db, page.id));
  assert.equal(result.verdict, 'normal');
  assert.equal(result.changed, false, '被忽略的行变化不应算内容变更');
  assert.equal(getPage(db, page.id).baseline_id, baselineId);
});

test('基线建立后才加忽略规则：不必重建基线即不再报变更', async () => {
  const page = createPage(db, site.id, { name: '点击计数页', url: 'https://www.example.com/views' });

  // 先在没有规则时建基线：那一行会被存进基线快照
  reply = () => ok(`${LONG}\n点击：1019次 时间：2025-07-08 22:54`);
  await run(page);
  const baselineId = getPage(db, page.id).baseline_id;
  assert.ok(baselineId > 0);

  // 事后再补规则——这正是原来必须手动“设为新基线”的场景
  updatePage(db, page.id, {
    ...getPage(db, page.id),
    ignorePatterns: ['点击\\s*[：:]\\s*[\\d, ]+\\s*次']
  });

  reply = () => ok(`${LONG}\n点击：1025次 时间：2025-07-08 22:54`);
  const result = await run(getPage(db, page.id));

  assert.equal(result.verdict, 'normal');
  assert.equal(result.contentChanged, false, '旧基线应套用当前规则后再比对');
  assert.equal(result.changed, false);
  assert.equal(getPage(db, page.id).baseline_id, baselineId, '基线不能被自动改写');
});

test('旧基线套用规则后，真实内容变化仍能检出', async () => {
  const row = db.prepare("SELECT * FROM pages WHERE name = '点击计数页'").get();

  reply = () => ok(`${LONG}\n点击：1030次 时间：2025-07-08 22:54\n新增公告：11 月 8 日发布会`);
  const result = await run(getPage(db, row.id));

  assert.equal(result.verdict, 'normal');
  assert.equal(result.changed, true);
  assert.deepEqual(result.diff, { addedCount: 1, removedCount: 0 });
});

test('基线字数也按过滤后计算，新增规则不会误判正文骤降', async () => {
  const dynamicBlock = '动态区块'.repeat(200); // 单行 800 字，占基线正文的绝大部分
  const page = createPage(db, site.id, { name: '动态区块页', url: 'https://www.example.com/big' });

  reply = () => ok(`${LONG}\n${dynamicBlock}`);
  await run(page);

  updatePage(db, page.id, { ...getPage(db, page.id), ignorePatterns: ['^动态区块'] });

  const result = await run(getPage(db, page.id));
  assert.equal(result.verdict, 'normal', '基线字数未按过滤后计算时会误报“正文骤降”');
  assert.equal(result.contentChanged, false);
});
