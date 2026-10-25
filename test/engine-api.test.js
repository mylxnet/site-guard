import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { openDb } from '../src/db.js';
import { createChecker } from '../src/checker.js';
import { config as baseConfig } from '../src/config.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const BASE_TEXT =
  '示例科技官网首页，提供网站监测、内容防篡改与可用性告警服务。这段正文足够长，用来建立稳定的基线，避免空白页规则误判。'.repeat(6);

let app;
let base;
let cookie = '';
let siteId;
let pageId;
let db;

const content = { text: BASE_TEXT, mode: 'good' };

const fakeFetch = async (url) => {
  if (content.mode === 'bad') {
    return {
      ok: true,
      status: 502,
      finalUrl: url,
      contentType: 'text/html; charset=utf-8',
      html: '<html><head><title>502 Bad Gateway</title></head><body><p>502 Bad Gateway nginx</p></body></html>',
      responseMs: 30,
      truncated: false,
      bytes: 100,
      redirects: 0
    };
  }
  return {
    ok: true,
    status: 200,
    finalUrl: url,
    contentType: 'text/html; charset=utf-8',
    html: `<html><head><title>示例科技</title></head><body><p>${content.text}</p></body></html>`,
    responseMs: 40,
    truncated: false,
    bytes: 900,
    redirects: 0
  };
};

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;

  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(';')[0];
    const index = pair.indexOf('=');
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    const kept = cookie.split('; ').filter(Boolean).filter((item) => !item.startsWith(`${name}=`));
    if (value) kept.push(`${name}=${value}`);
    cookie = kept.join('; ');
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

before(async () => {
  const config = {
    ...baseConfig,
    dbFile: ':memory:',
    schedulerTickMs: 3_600_000,
    pageGapMs: 0,
    fetchRetries: 0
  };
  db = openDb(':memory:');
  app = createApp({
    config,
    logger: silentLogger,
    db,
    checkPage: createChecker({ db, config, logger: silentLogger, fetchPage: fakeFetch })
  });
  const address = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${address.port}`;

  await request('POST', '/api/setup', { password: '12345678' });
  const site = await request('POST', '/api/sites', {
    name: '示例科技',
    baseUrl: 'https://www.example.com/',
    scheduleMode: 'interval',
    scheduleValue: 6,
    timezone: 'Asia/Shanghai'
  });
  siteId = site.json.data.id;

  const page = await request('POST', `/api/sites/${siteId}/pages`, {
    name: '主页',
    url: 'https://www.example.com/',
    mustContain: ['示例科技']
  });
  pageId = page.json.data.id;
});

after(async () => {
  await app.close();
});

test('单页巡检：正常页面建立基线并回写页面状态', async () => {
  const res = await request('POST', `/api/pages/${pageId}/run`);
  assert.equal(res.status, 200);
  const { result, page } = res.json.data;

  assert.equal(result.verdict, 'normal');
  assert.equal(result.changed, false);
  assert.ok(result.baselineId > 0);
  assert.equal(result.httpCode, 200);

  assert.equal(page.state, 'normal');
  assert.equal(page.changed, false);
  assert.ok(page.baselineId > 0);
  assert.equal(page.lastCheck.verdict, 'normal');
  assert.deepEqual(page.lastCheck.reasons, []);
});

test('详情接口：返回判定理由、基线与最近快照', async () => {
  const res = await request('GET', `/api/pages/${pageId}/detail`);
  assert.equal(res.status, 200);
  const detail = res.json.data;

  assert.equal(detail.site.name, '示例科技');
  assert.ok(detail.baseline.id > 0);
  assert.equal(detail.baseline.kind, 'baseline');
  assert.equal(detail.latestSnapshot.id, detail.baseline.id);
  assert.equal(detail.diffSummary, null);
  assert.equal(detail.page.state, 'normal');
});

test('内容变化：changed=true，差异接口给出新增行', async () => {
  content.text = `${BASE_TEXT}\n新增公告：双十一活动开始`;
  const run = await request('POST', `/api/pages/${pageId}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.data.result.verdict, 'normal');
  assert.equal(run.json.data.result.changed, true);
  assert.deepEqual(run.json.data.result.diff, { addedCount: 1, removedCount: 0 });
  assert.equal(run.json.data.page.changed, true);

  const detail = await request('GET', `/api/pages/${pageId}/detail`);
  assert.equal(detail.json.data.diffSummary.addedCount, 1);

  const diff = await request('GET', `/api/pages/${pageId}/diff`);
  assert.equal(diff.status, 200);
  assert.deepEqual(diff.json.data.added, ['新增公告：双十一活动开始']);
  assert.deepEqual(diff.json.data.removed, []);
  assert.notEqual(diff.json.data.baseline.id, diff.json.data.latest.id);
});

test('确认变更：基线迁移到最新快照，changed 清零，差异归零', async () => {
  const before = await request('GET', `/api/pages/${pageId}/detail`);
  const latestId = before.json.data.latestSnapshot.id;

  const accepted = await request('POST', `/api/pages/${pageId}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.data.page.changed, false);
  assert.equal(accepted.json.data.page.baselineId, latestId);

  const detail = await request('GET', `/api/pages/${pageId}/detail`);
  assert.equal(detail.json.data.baseline.id, detail.json.data.latestSnapshot.id);
  assert.equal(detail.json.data.diffSummary, null);

  const diff = await request('GET', `/api/pages/${pageId}/diff`);
  assert.deepEqual(diff.json.data.added, []);
  assert.deepEqual(diff.json.data.removed, []);
});

test('异常页面：bad 状态无法被确认为基线', async () => {
  content.mode = 'bad';
  const run = await request('POST', `/api/pages/${pageId}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.json.data.result.verdict, 'bad');
  assert.equal(run.json.data.result.eventType, 'bad');
  assert.equal(run.json.data.page.state, 'bad');
  assert.ok(run.json.data.result.reasons.some((reason) => reason.level === 'bad'));

  const accepted = await request('POST', `/api/pages/${pageId}/accept`);
  assert.equal(accepted.status, 409);
  assert.equal(accepted.json.error.code, 'CONFLICT');
});

test('恢复正常：产生 recovered 事件，概览统计随之更新', async () => {
  content.mode = 'good';
  const run = await request('POST', `/api/pages/${pageId}/run`);
  assert.equal(run.json.data.result.verdict, 'normal');
  assert.equal(run.json.data.result.eventType, 'recovered');
  assert.equal(run.json.data.page.state, 'normal');

  const overview = await request('GET', '/api/overview');
  assert.equal(overview.status, 200);
  const data = overview.json.data;
  assert.equal(data.sites, 1);
  assert.equal(data.pages, 1);
  assert.equal(data.pagesByState.normal, 1);
  assert.equal(data.changed, 0);
  assert.ok(data.nextRunAt > 0);
  assert.ok(data.recentEvents.some((event) => event.type === 'recovered'));
  assert.ok(data.recentEvents.some((event) => event.type === 'bad'));
});

test('没有基线的页面：差异接口返回 409 并说明原因', async () => {
  const created = await request('POST', `/api/sites/${siteId}/pages`, {
    name: '列表页',
    url: 'https://www.example.com/list'
  });
  const id = created.json.data.id;

  const diff = await request('GET', `/api/pages/${id}/diff`);
  assert.equal(diff.status, 409);
  assert.match(diff.json.error.message, /还没有基线/);

  const detail = await request('GET', `/api/pages/${id}/detail`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.baseline, null);
  assert.equal(detail.json.data.latestSnapshot, null);
});
