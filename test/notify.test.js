import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openDb,
  createSite,
  createPage,
  insertSnapshot,
  insertCheck,
  addEvent,
  setPageState,
  getPage,
  listEvents,
  latestCheck
} from '../src/db.js';
import { createNotifier, saveMailSettings, readMailSettings, publicMailSettings } from '../src/notify.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const NOW = Date.UTC(2026, 9, 25, 1, 0, 0); // 2026-10-25 09:00 Asia/Shanghai

const settings = {
  enabled: true,
  host: 'smtp.example.com',
  port: 465,
  secure: 'ssl',
  user: 'bot@example.com',
  password: 'super-secret-code',
  from: 'bot@example.com',
  to: 'owner@example.com,ops@example.com',
  cooldownHours: 6,
  panelUrl: 'http://192.168.1.10:8686'
};

function setup({ baselineText = '旧正文\n第二行', baselineLen = 1200 } = {}) {
  const db = openDb(':memory:');
  const site = createSite(db, {
    name: '示例科技',
    baseUrl: 'https://www.example.com/',
    scheduleMode: 'daily',
    scheduleValue: '09:00',
    timezone: 'Asia/Shanghai',
    enabled: true,
    nextRunAt: NOW
  });
  const page = createPage(db, site.id, {
    name: '主页',
    url: 'https://www.example.com/',
    mustContain: ['示例科技']
  });
  const baselineId = insertSnapshot(db, {
    pageId: page.id,
    kind: 'baseline',
    hash: 'hash-baseline',
    text: baselineText,
    meta: { textLen: baselineLen, title: '示例科技', verdict: 'normal' }
  });
  setPageState(db, page.id, { state: 'normal', changed: false, message: '已建立基线', baselineId });
  saveMailSettings(db, settings);
  return { db, site, page, baselineId: Number(baselineId) };
}

function addBadEvent(db, site, page, batchId = 'batch-1') {
  insertCheck(db, {
    batchId,
    pageId: page.id,
    verdict: 'bad',
    httpCode: 200,
    responseMs: 1180,
    finalUrl: page.url,
    title: '502 Bad Gateway',
    textLen: 180,
    reasons: [{ hit: true, level: 'bad', text: '页面标题变为「502 Bad Gateway」' }]
  });
  return addEvent(db, {
    batchId,
    siteId: site.id,
    pageId: page.id,
    type: 'bad',
    message: '页面标题变为「502 Bad Gateway」'
  });
}

function makeNotifier({ db, sendMail, retryDelaysMs = [] }) {
  return createNotifier({ db, logger: silentLogger, retryDelaysMs, now: () => NOW, sendMail });
}

test('异常汇总：主题分级、理由与面板链接齐全，发送成功后标记已通知', async () => {
  const { db, site, page } = setup();
  const calls = [];
  const notifier = makeNotifier({
    db,
    sendMail: async (payload) => {
      calls.push(payload);
      return { messageId: 'msg-1' };
    }
  });

  addBadEvent(db, site, page);
  const result = await notifier.notifyBatch({ site, batchId: 'batch-1', trigger: 'schedule', nextRunAt: NOW + 12 * 3600_000 });

  assert.equal(result.sent, true);
  assert.equal(result.included, 1);
  assert.equal(calls.length, 1);

  const { message, settings: used } = calls[0];
  assert.equal(used.host, 'smtp.example.com');
  assert.equal(message.from, 'bot@example.com');
  assert.equal(message.to, 'owner@example.com,ops@example.com');
  assert.equal(message.subject, '[网站哨兵] 🔴 1 个页面异常 · 示例科技');

  assert.match(message.text, /巡检时间：2026-10-25 09:00（Asia\/Shanghai）/);
  assert.match(message.text, /站点：示例科技（https:\/\/www\.example\.com\/）/);
  assert.match(message.text, /HTTP 200 · 1180ms · 正文 180 字（基线 1,200）/);
  assert.match(message.text, /判定：页面标题变为「502 Bad Gateway」/);
  assert.match(message.text, /查看面板：http:\/\/192\.168\.1\.10:8686/);
  assert.match(message.text, /本轮：计划巡检；下一轮：2026-10-25 21:00/);

  assert.match(message.html, /<h2[^>]*>示例科技 · 巡检汇总<\/h2>/);
  assert.match(message.html, /页面标题变为「502 Bad Gateway」/);

  const events = listEvents(db, { limit: 10 });
  assert.equal(events[0].notified, true);
  assert.equal(getPage(db, page.id).last_alert_at, null, '异常不参与内容变更冷却');
  assert.equal(latestCheck(db, page.id).verdict, 'bad');
});

test('异常 + 内容变更 + 恢复：主题按严重度排序，三类都给到', async () => {
  const { db, site, page } = setup();
  const calls = [];
  const notifier = makeNotifier({ db, sendMail: async (payload) => (calls.push(payload), { messageId: 'm' }) });

  addBadEvent(db, site, page, 'batch-2');
  insertCheck(db, {
    batchId: 'batch-2',
    pageId: page.id,
    verdict: 'normal',
    httpCode: 200,
    responseMs: 90,
    textLen: 900,
    changed: true,
    reasons: []
  });
  insertSnapshot(db, {
    pageId: page.id,
    kind: 'check',
    hash: 'hash-new',
    text: '新正文\n第二行\n新增公告',
    meta: { textLen: 900, title: '示例科技', verdict: 'normal' }
  });
  addEvent(db, { batchId: 'batch-2', siteId: site.id, pageId: page.id, type: 'changed', message: '内容有变化：新增 1 行、删除 0 行' });
  addEvent(db, { batchId: 'batch-2', siteId: site.id, pageId: page.id, type: 'recovered', message: '已恢复正常（bad → 正常）' });

  const result = await notifier.notifyBatch({ site, batchId: 'batch-2', trigger: 'catchup' });
  assert.equal(result.sent, true);
  assert.equal(result.included, 3);

  const { message } = calls[0];
  assert.equal(message.subject, '[网站哨兵] 🔴 1 个页面异常 · 1 个页面内容变更 · 1 个页面已恢复 · 示例科技');
  assert.match(message.text, /── 内容变更（1）/);
  assert.match(message.text, /差异：\+2 \/ -1 行/);
  assert.match(message.text, /\+ 新增公告/);
  assert.match(message.text, /── 已恢复（1）/);
  assert.match(message.text, /本轮：补跑/);
});

test('内容变更受 6 小时冷却：冷却期内不发信、事件保持未通知，过期后补发', async () => {
  const { db, site, page } = setup();
  const calls = [];
  const notifier = makeNotifier({ db, sendMail: async (payload) => (calls.push(payload), { messageId: 'm' }) });

  insertCheck(db, { batchId: 'b-cd', pageId: page.id, verdict: 'normal', httpCode: 200, responseMs: 50, textLen: 1100, changed: true });
  insertSnapshot(db, {
    pageId: page.id,
    kind: 'check',
    hash: 'hash-cd',
    text: '旧正文\n第二行\n新公告',
    meta: { textLen: 1100, verdict: 'normal' }
  });
  const eventId = addEvent(db, {
    batchId: 'b-cd',
    siteId: site.id,
    pageId: page.id,
    type: 'changed',
    message: '内容有变化：新增 1 行、删除 0 行'
  });

  db.prepare('UPDATE pages SET last_alert_at = ? WHERE id = ?').run(NOW - 3600_000, page.id);
  const cooled = await notifier.notifyBatch({ site, batchId: 'b-cd', trigger: 'schedule' });
  assert.equal(cooled.sent, false);
  assert.match(cooled.reason, /没有需要通知的变化/);
  assert.equal(calls.length, 0);
  assert.equal(listEvents(db, { limit: 10 }).find((event) => event.id === eventId).notified, false);

  db.prepare('UPDATE pages SET last_alert_at = ? WHERE id = ?').run(NOW - 7 * 3600_000, page.id);
  const sent = await notifier.notifyBatch({ site, batchId: 'b-cd', trigger: 'schedule' });
  assert.equal(sent.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message.subject, '[网站哨兵] 🟡 1 个页面内容变更 · 示例科技');
  assert.match(calls[0].message.text, /差异：\+1 \/ -0 行/);
  assert.equal(getPage(db, page.id).last_alert_at, NOW, '发信成功才更新冷却起点');
});

test('恢复不受冷却限制，且不会顺手压掉下一次内容变更', async () => {
  const { db, site, page } = setup();
  const calls = [];
  const notifier = makeNotifier({ db, sendMail: async (payload) => (calls.push(payload), { messageId: 'm' }) });

  db.prepare('UPDATE pages SET last_alert_at = ? WHERE id = ?').run(NOW - 60_000, page.id);
  addEvent(db, { batchId: 'b-rec', siteId: site.id, pageId: page.id, type: 'recovered', message: '已恢复正常（bad → 正常）' });

  const result = await notifier.notifyBatch({ site, batchId: 'b-rec', trigger: 'schedule' });
  assert.equal(result.sent, true);
  assert.equal(calls[0].message.subject, '[网站哨兵] ✅ 1 个页面已恢复 · 示例科技');
  assert.equal(getPage(db, page.id).last_alert_at, NOW - 60_000, '恢复不应重置内容变更的冷却起点');
});

test('没有需要通知的事件就不发信', async () => {
  const { db, site, page } = setup();
  let called = false;
  const notifier = makeNotifier({ db, sendMail: async () => { called = true; return { messageId: 'm' }; } });

  addEvent(db, { batchId: 'b-sys', siteId: site.id, pageId: page.id, type: 'system', message: '已建立基线' });
  const result = await notifier.notifyBatch({ site, batchId: 'b-sys', trigger: 'schedule' });
  assert.equal(result.sent, false);
  assert.match(result.reason, /没有需要通知的变化/);
  assert.equal(called, false);
});

test('未启用或未配置完整时直接跳过，不去连 SMTP', async () => {
  const { db, site } = setup();
  let called = false;
  const notifier = makeNotifier({ db, sendMail: async () => { called = true; return {}; } });

  saveMailSettings(db, { ...settings, enabled: false });
  assert.match((await notifier.notifyBatch({ site, batchId: 'x' })).reason, /未启用/);

  saveMailSettings(db, { ...settings, enabled: true, host: '' });
  assert.match((await notifier.notifyBatch({ site, batchId: 'x' })).reason, /SMTP/);

  saveMailSettings(db, { ...settings, enabled: true, to: '' });
  assert.match((await notifier.notifyBatch({ site, batchId: 'x' })).reason, /收件人/);

  assert.equal(called, false);
});

test('发送失败：按配置重试，最终失败写系统事件且不标记已通知', async () => {
  const { db, site, page } = setup();
  let attempts = 0;
  const notifier = createNotifier({
    db,
    logger: silentLogger,
    retryDelaysMs: [0, 0],
    now: () => NOW,
    sendMail: async () => {
      attempts += 1;
      const err = new Error('Invalid login: 535 Authentication failed');
      err.code = 'EAUTH';
      err.password = 'super-secret-code';
      throw err;
    }
  });

  addBadEvent(db, site, page, 'b-fail');
  const result = await notifier.notifyBatch({ site, batchId: 'b-fail', trigger: 'manual' });

  assert.equal(attempts, 3, '首次 + 2 次重试');
  assert.equal(result.sent, false);
  assert.match(result.reason, /授权码或密码错误/);

  const events = listEvents(db, { limit: 20 });
  const bad = events.find((event) => event.type === 'bad');
  assert.equal(bad.notified, false);
  const system = events.find((event) => event.type === 'system' && /发送失败/.test(event.message));
  assert.ok(system);
  assert.match(system.message, /授权码或密码错误/);
});

test('重试后成功：只发一封，且发生在失败两次之后', async () => {
  const { db, site, page } = setup();
  let attempts = 0;
  const notifier = createNotifier({
    db,
    logger: silentLogger,
    retryDelaysMs: [0, 0],
    now: () => NOW,
    sendMail: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('ECONNECTION: connect failed');
      return { messageId: 'm-ok' };
    }
  });

  addBadEvent(db, site, page, 'b-retry');
  const result = await notifier.notifyBatch({ site, batchId: 'b-retry', trigger: 'schedule' });
  assert.equal(attempts, 3);
  assert.equal(result.sent, true);
  assert.equal(listEvents(db, { limit: 10 }).find((event) => event.type === 'bad').notified, true);
});

test('设置输出永远不带密码原文', () => {
  const { db } = setup();
  const stored = readMailSettings(db);
  assert.equal(stored.password, 'super-secret-code');

  const safe = publicMailSettings(stored);
  assert.equal(safe.password, undefined);
  assert.equal(safe.hasPassword, true);
  assert.equal(JSON.stringify(safe).includes('super-secret-code'), false);
});

test('测试邮件：成功返回 messageId；配置不全时直接说明缺什么', async () => {
  const { db } = setup();
  const calls = [];
  const notifier = makeNotifier({ db, sendMail: async (payload) => (calls.push(payload), { messageId: 'test-1' }) });

  const result = await notifier.sendTest({});
  assert.equal(result.sent, true);
  assert.equal(result.to, 'owner@example.com,ops@example.com');
  assert.match(calls[0].message.subject, /测试邮件/);
  assert.match(calls[0].message.text, /smtp\.example\.com:465（ssl）/);

  saveMailSettings(db, { ...settings, host: '' });
  await assert.rejects(() => notifier.sendTest({}), (err) => {
    assert.equal(err.code, 'VALIDATION_FAILED');
    assert.match(err.message, /SMTP 服务器/);
    return true;
  });
});
