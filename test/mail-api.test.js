import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { openDb, addEvent } from '../src/db.js';
import { createChecker } from '../src/checker.js';
import { readMailSettings } from '../src/notify.js';
import { config as baseConfig } from '../src/config.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const LONG = '示例科技官网内容，用于验证批次结束后的邮件汇总。这段正文足够长，超过两百字，避免被判定为空白页。'.repeat(6);

let app;
let db;
let base;
let cookie = '';
let siteId;
let pageId;
let mode = 'normal';
const mails = [];
let mailBehavior = 'ok';

const fakeFetch = async (url) => {
  if (mode === 'bad') {
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
    html: `<html><head><title>示例科技</title></head><body><p>${LONG}</p></body></html>`,
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

const mailSettings = {
  enabled: true,
  host: 'smtp.test.local',
  port: 2525,
  secure: 'none',
  user: 'bot@example.com',
  password: 'pw-123456',
  from: 'bot@example.com',
  to: 'owner@example.com',
  cooldownHours: 6,
  panelUrl: 'http://192.168.1.10:8686'
};

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
    checkPage: createChecker({ db, config, logger: silentLogger, fetchPage: fakeFetch }),
    sendMail: async (payload) => {
      mails.push(payload);
      if (mailBehavior === 'fail') {
        const err = new Error('Invalid login: 535 Authentication failed');
        err.code = 'EAUTH';
        throw err;
      }
      return { messageId: `mock-${mails.length}` };
    }
  });
  const address = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${address.port}`;

  await request('POST', '/api/setup', { password: '12345678' });
  const site = await request('POST', '/api/sites', {
    name: '示例科技',
    baseUrl: 'https://www.example.com/',
    scheduleMode: 'interval',
    scheduleValue: 6
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

test('设置默认值：未启用、密码为空、冷却 6 小时', async () => {
  const res = await request('GET', '/api/settings');
  assert.equal(res.status, 200);
  const data = res.json.data;
  assert.equal(data.enabled, false);
  assert.equal(data.port, 465);
  assert.equal(data.secure, 'ssl');
  assert.equal(data.hasPassword, false);
  assert.equal(data.cooldownHours, 6);
  assert.equal(data.password, undefined);
});

test('保存设置：启用时缺服务器/发件人/收件人一次报全', async () => {
  const res = await request('PUT', '/api/settings', { enabled: true, host: '', from: '', to: '' });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(Object.keys(res.json.error.fields).sort(), ['from', 'host', 'to']);
});

test('保存设置：密码只写不读，二次保存不填密码也不会丢', async () => {
  const saved = await request('PUT', '/api/settings', mailSettings);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.data.enabled, true);
  assert.equal(saved.json.data.hasPassword, true);
  assert.equal(saved.json.data.password, undefined);
  assert.equal(JSON.stringify(saved.json.data).includes('pw-123456'), false);

  const again = await request('PUT', '/api/settings', { cooldownHours: 12 });
  assert.equal(again.status, 200);
  assert.equal(again.json.data.cooldownHours, 12);
  assert.equal(again.json.data.hasPassword, true);
  assert.equal(readMailSettings(db).password, 'pw-123456');

  const shown = await request('GET', '/api/settings');
  assert.equal(shown.json.data.cooldownHours, 12);
  assert.equal(shown.json.data.to, 'owner@example.com');
});

test('测试邮件：使用已保存的收件人，成功后返回 messageId', async () => {
  mails.length = 0;
  const res = await request('POST', '/api/settings/test-mail', {});
  assert.equal(res.status, 200);
  assert.equal(res.json.data.sent, true);
  assert.equal(res.json.data.to, 'owner@example.com');
  assert.equal(mails.length, 1);
  assert.match(mails[0].message.subject, /测试邮件/);
  assert.match(mails[0].message.text, /smtp\.test\.local:2525（none）/);
});

test('测试邮件：可临时指定收件人，格式错误被拦住', async () => {
  mails.length = 0;
  const ok = await request('POST', '/api/settings/test-mail', { to: 'temp@example.org' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.to, 'temp@example.org');

  const bad = await request('POST', '/api/settings/test-mail', { to: 'not-a-mail' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error.fields.to, /邮箱格式不对/);

  const empty = await request('POST', '/api/settings/test-mail', { to: ',' });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error.fields.to, /不能为空/);
});

test('测试邮件：SMTP 报错映射成可读原因，不泄露密码', async () => {
  mailBehavior = 'fail';
  try {
    const res = await request('POST', '/api/settings/test-mail', {});
    assert.equal(res.status, 400);
    assert.match(res.json.error.message, /授权码或密码错误/);
    assert.equal(JSON.stringify(res.json).includes('pw-123456'), false);
  } finally {
    mailBehavior = 'ok';
  }
});

test('事件流：类型筛选、分页与非法参数', async () => {
  addEvent(db, { siteId, pageId, type: 'bad', message: '异常 1' });
  addEvent(db, { siteId, pageId, type: 'changed', message: '变更 1' });
  addEvent(db, { siteId, pageId, type: 'changed', message: '变更 2' });
  addEvent(db, { siteId, pageId, type: 'changed', message: '变更 3' });

  const all = await request('GET', '/api/events?limit=200');
  assert.equal(all.status, 200);
  assert.ok(all.json.data.total >= 4);
  assert.ok(all.json.data.items.length >= 4);

  const defaults = await request('GET', '/api/events');
  assert.equal(defaults.json.data.limit, 50, '不传 limit 应使用默认 50，而不是被当成 0');
  assert.equal(defaults.json.data.offset, 0);

  const changed = await request('GET', '/api/events?type=changed&limit=2');
  assert.equal(changed.json.data.items.length, 2);
  assert.equal(changed.json.data.total >= 3, true);
  assert.ok(changed.json.data.items.every((event) => event.type === 'changed'));

  const page1 = await request('GET', '/api/events?type=changed&limit=1&offset=0');
  const page2 = await request('GET', '/api/events?type=changed&limit=1&offset=1');
  assert.notEqual(page1.json.data.items[0].id, page2.json.data.items[0].id);

  const siteFiltered = await request('GET', `/api/events?siteId=${siteId}&type=bad`);
  assert.ok(siteFiltered.json.data.items.every((event) => event.site_id === siteId));

  const invalid = await request('GET', '/api/events?type=nope');
  assert.equal(invalid.status, 400);
  assert.match(invalid.json.error.fields.type, /事件类型/);

  const badSite = await request('GET', '/api/events?siteId=abc');
  assert.equal(badSite.status, 400);
});

test('批次结束自动发一封汇总信，事件标记已通知，批次日志可见', async () => {
  mails.length = 0;
  mode = 'bad';

  const triggered = await request('POST', `/api/sites/${siteId}/run`);
  assert.equal(triggered.status, 200);
  const { batchId } = triggered.json.data;

  let batch = null;
  let notified = false;
  for (let i = 0; i < 120; i += 1) {
    batch = (await request('GET', `/api/batches/${batchId}`)).json.data;
    const events = (await request('GET', '/api/events?type=bad&limit=5')).json.data.items;
    notified = events.some((event) => event.batch_id === batchId && event.notified);
    if (batch.status !== 'running' && notified) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  assert.equal(batch.status, 'done');
  assert.equal(batch.summary.checked, 1);
  assert.equal(batch.summary.verdicts.bad, 1);
  assert.equal(mails.length, 1, '一轮只发一封');

  const { message } = mails[0];
  assert.match(message.subject, /^\[网站哨兵\] 🔴 1 个页面异常 · 示例科技$/);
  assert.match(message.text, /站点：示例科技/);
  assert.match(message.text, /页面标题变为「502 Bad Gateway」/);
  assert.equal(message.to, 'owner@example.com');

  assert.ok(batch.lines.some((line) => /已发送汇总邮件（1 条事件）/.test(line)));
  assert.ok(notified, '事件必须标记为已通知');
});
