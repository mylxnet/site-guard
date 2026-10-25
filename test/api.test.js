import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { config as baseConfig } from '../src/config.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
let app;
let base;
let cookie = '';

async function request(method, path, { body, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;

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
    const kept = cookie
      .split('; ')
      .filter(Boolean)
      .filter((item) => !item.startsWith(`${name}=`));
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
  app = createApp({
    config: {
      ...baseConfig,
      dbFile: ':memory:',
      schedulerTickMs: 3_600_000,
      pageGapMs: 0,
      loginMaxFailures: 8
    },
    logger: silentLogger,
    // 这里只验证 HTTP 契约；真实抓取/判定的集成测试在 checker.test.js 与 engine-api.test.js。
    checkPage: async () => ({ verdict: 'normal', changed: false, httpCode: 200, responseMs: 20, textLen: 300 })
  });
  const address = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
});

test('公开接口可用，受保护接口未登录时 401', async () => {
  const health = await request('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.data.ok, true);
  assert.equal(health.json.data.version, baseConfig.version);

  const state = await request('GET', '/api/state');
  assert.equal(state.json.data.needSetup, true);
  assert.equal(state.json.data.loggedIn, false);

  const guarded = await request('GET', '/api/sites');
  assert.equal(guarded.status, 401);
  assert.equal(guarded.json.error.code, 'UNAUTHORIZED');
});

test('静态页可访问，越权路径与未知接口都不泄露文件', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /网站哨兵/);

  const traversal = await fetch(`${base}/..%2fpackage.json`);
  assert.equal(traversal.status, 404);

  const unknown = await request('GET', '/api/nope');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error.code, 'NOT_FOUND');
});

test('初始化：密码太短被拦，成功后自动登录，重复初始化 409', async () => {
  const weak = await request('POST', '/api/setup', { body: { password: '123' } });
  assert.equal(weak.status, 400);
  assert.match(weak.json.error.fields.password, /至少 8 位/);

  const done = await request('POST', '/api/setup', { body: { password: '12345678' } });
  assert.equal(done.status, 200);
  assert.ok(cookie.startsWith('sg_sid='));

  const state = await request('GET', '/api/state');
  assert.equal(state.json.data.needSetup, false);
  assert.equal(state.json.data.loggedIn, true);

  const again = await request('POST', '/api/setup', { body: { password: '12345678' } });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'CONFLICT');
});

test('退出后受保护接口 401，密码错误 401，密码正确恢复会话', async () => {
  const logout = await request('POST', '/api/logout');
  assert.equal(logout.status, 200);

  const afterLogout = await request('GET', '/api/sites');
  assert.equal(afterLogout.status, 401);

  const wrong = await request('POST', '/api/login', { body: { password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  assert.match(wrong.json.error.message, /密码不正确/);

  const login = await request('POST', '/api/login', { body: { password: '12345678' } });
  assert.equal(login.status, 200);
  assert.equal(login.json.data.loggedIn, true);

  const sites = await request('GET', '/api/sites');
  assert.equal(sites.status, 200);
});

test('站点：校验失败给出字段错误，成功后可在列表看到', async () => {
  const bad = await request('POST', '/api/sites', {
    body: { name: '', baseUrl: 'example.com', scheduleMode: 'daily', scheduleValue: '25:00' }
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(Object.keys(bad.json.error.fields).sort(), ['baseUrl', 'name', 'scheduleValue']);

  const created = await request('POST', '/api/sites', {
    body: {
      name: '示例科技',
      baseUrl: 'https://www.example.com',
      scheduleMode: 'daily',
      scheduleValue: '09:00, 21:00',
      timezone: 'Asia/Shanghai'
    }
  });
  assert.equal(created.status, 200);
  const site = created.json.data;
  assert.equal(site.name, '示例科技');
  assert.equal(site.scheduleLabel, '每天 09:00, 21:00');
  assert.deepEqual(site.pages, []);
  assert.ok(site.nextRunAt > 0);
  assert.ok(site.nextRunAt <= Date.now() + 1000);

  const list = await request('GET', '/api/sites');
  assert.equal(list.json.data.length, 1);

  const patched = await request('PATCH', `/api/sites/${site.id}`, {
    body: { enabled: false, scheduleMode: 'interval', scheduleValue: 6 }
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.enabled, false);
  assert.equal(patched.json.data.scheduleLabel, '每 6 小时');

  const missing = await request('PATCH', '/api/sites/9999', { body: { name: 'x' } });
  assert.equal(missing.status, 404);
});

test('页面：新增/修改/校验/删除', async () => {
  const sites = await request('GET', '/api/sites');
  const siteId = sites.json.data[0].id;

  const bad = await request('POST', `/api/sites/${siteId}/pages`, {
    body: { name: '主页', url: 'https://www.example.com/', ignorePatterns: ['([a-z'] }
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error.fields.ignorePatterns, /写法有误/);

  const created = await request('POST', `/api/sites/${siteId}/pages`, {
    body: {
      name: '主页',
      url: 'https://www.example.com/',
      mustContain: ['示例科技'],
      keywords: '备案号'
    }
  });
  assert.equal(created.status, 200);
  const page = created.json.data;
  assert.equal(page.name, '主页');
  assert.deepEqual(page.mustContain, ['示例科技']);
  assert.equal(page.state, 'unknown');
  assert.equal(page.lastCheck, null);

  const patched = await request('PATCH', `/api/pages/${page.id}`, { body: { name: '首页' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.name, '首页');
  assert.deepEqual(patched.json.data.mustContain, ['示例科技']);

  const list = await request('GET', '/api/sites');
  assert.equal(list.json.data[0].pages.length, 1);
  assert.equal(list.json.data[0].pages[0].name, '首页');

  const removed = await request('DELETE', `/api/pages/${page.id}`);
  assert.equal(removed.status, 200);
  const afterDelete = await request('GET', '/api/sites');
  assert.equal(afterDelete.json.data[0].pages.length, 0);
});

test('手动巡检：返回批次并跑完，结果按页面汇总', async () => {
  const sites = await request('GET', '/api/sites');
  const siteId = sites.json.data[0].id;

  await request('POST', `/api/sites/${siteId}/pages`, {
    body: { name: '主页', url: 'https://www.example.com/' }
  });

  const triggered = await request('POST', `/api/sites/${siteId}/run`);
  assert.equal(triggered.status, 200);
  const { batchId } = triggered.json.data;
  assert.ok(batchId.startsWith(`${siteId}-`));

  let batch = null;
  for (let i = 0; i < 40; i += 1) {
    const res = await request('GET', `/api/batches/${batchId}`);
    assert.equal(res.status, 200);
    batch = res.json.data;
    if (batch.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(batch.status, 'done');
  assert.equal(batch.trigger, 'manual');
  assert.equal(batch.summary.checked, 1);
  assert.equal(batch.summary.skipped, 0);
  assert.equal(batch.summary.verdicts.normal, 1);
  assert.ok(batch.lines.some((line) => line.includes('主页：normal')));

  // 调度器在批次结束时必须落库「上次/下次」，否则重启就丢节奏。
  const refreshed = await request('GET', '/api/sites');
  const site = refreshed.json.data[0];
  assert.ok(site.lastRunAt > 0);
  assert.ok(site.nextRunAt > Date.now());

  const unknown = await request('GET', '/api/batches/nope-1');
  assert.equal(unknown.status, 404);
});

test('跨站请求被拒绝，同源请求放行', async () => {
  const evil = await request('POST', '/api/sites', {
    body: { name: 'x', baseUrl: 'https://example.com' },
    origin: 'http://evil.example'
  });
  assert.equal(evil.status, 403);
  assert.equal(evil.json.error.code, 'FORBIDDEN');

  const sameOrigin = await request('POST', '/api/sites', {
    body: { name: '同源站点', baseUrl: 'https://example.org', scheduleMode: 'daily', scheduleValue: '09:00' },
    origin: base
  });
  assert.equal(sameOrigin.status, 200);
});

test('登录限速：同 IP 连续失败后 429', async () => {
  const limited = createApp({
    config: { ...baseConfig, dbFile: ':memory:', schedulerTickMs: 3_600_000, loginMaxFailures: 3 },
    logger: silentLogger
  });
  const address = await limited.listen(0, '127.0.0.1');
  const endpoint = `http://127.0.0.1:${address.port}`;

  const post = (path, body) =>
    fetch(endpoint + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

  try {
    await post('/api/setup', { password: '12345678' });
    for (let i = 0; i < 3; i += 1) {
      const res = await post('/api/login', { password: 'wrong-pass' });
      assert.equal(res.status, 401);
    }
    const blocked = await post('/api/login', { password: '12345678' });
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error.code, 'RATE_LIMITED');
  } finally {
    await limited.close();
  }
});
