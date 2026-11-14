// SPDX-License-Identifier: MIT
// Copyright (c) 2026 by Mr lin

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { config as baseConfig } from '../src/config.js';
import { createResetCode, normalizeResetCode, formatResetCode } from '../src/auth.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const mails = [];

let app;
let base;
let cookie = '';
let resetCode = '';

async function request(method, path, { body } = {}) {
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
    const kept = cookie
      .split('; ')
      .filter(Boolean)
      .filter((item) => !item.startsWith(`${name}=`));
    if (value) kept.push(`${name}=${value}`);
    cookie = kept.join('; ');
  }

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json };
}

const mailSettings = {
  enabled: true,
  host: 'smtp.example.com',
  port: 465,
  secure: 'ssl',
  user: 'robot@example.com',
  password: 'secret',
  from: 'robot@example.com',
  to: 'ops@example.com, backup@example.com',
  cooldownHours: 6
};

before(async () => {
  app = createApp({
    config: { ...baseConfig, dbFile: ':memory:', schedulerTickMs: 3_600_000, pageGapMs: 0 },
    logger: silentLogger,
    checkPage: async () => ({ verdict: 'normal', changed: false, httpCode: 200, responseMs: 20, textLen: 300 }),
    sendMail: async ({ message }) => {
      mails.push(message);
      return { messageId: `test-${mails.length}` };
    }
  });
  const address = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${address.port}`;

  const setup = await request('POST', '/api/setup', { body: { password: 'oldpass123' } });
  assert.equal(setup.status, 200);
  const saved = await request('PUT', '/api/settings', { body: mailSettings });
  assert.equal(saved.status, 200);
});

after(async () => {
  await app.close();
});

test('重置码：20 位、无易混字符、可按 4 位分组', () => {
  const code = createResetCode();
  assert.equal(code.length, 20);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{20}$/);

  const shown = formatResetCode(code);
  assert.equal(shown.length, 24);
  assert.equal(shown.split('-').length, 5);
  assert.equal(normalizeResetCode(shown), code);

  // 手抄常见的形近字符纠正：O→0，I/L→1，分隔符与空格全部忽略
  assert.equal(normalizeResetCode('o il'), '011');
  assert.equal(normalizeResetCode('k7qm 2xpb-9rta-5hwd-3nce'), 'K7QM2XPB9RTA5HWD3NCE');
});

test('申请重置码：非告警收件人被拒绝且不发信', async () => {
  const sent = mails.length;
  const res = await request('POST', '/api/auth/reset/request', {
    body: { email: 'stranger@example.com' }
  });

  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, 'EMAIL_NOT_ALLOWED');
  assert.match(res.json.error.fields.email, /不一致/);
  assert.equal(mails.length, sent);
});

test('申请重置码：未启用邮件时返回 409', async () => {
  const saved = await request('PUT', '/api/settings', { body: { ...mailSettings, enabled: false } });
  assert.equal(saved.status, 200);

  const res = await request('POST', '/api/auth/reset/request', {
    body: { email: 'ops@example.com' }
  });
  assert.equal(res.status, 409);
  assert.equal(res.json.error.code, 'MAIL_UNAVAILABLE');

  const back = await request('PUT', '/api/settings', { body: mailSettings });
  assert.equal(back.status, 200);
});

test('申请重置码：第一个告警收件人可用，邮件只有 20 位码、没有链接', async () => {
  const res = await request('POST', '/api/auth/reset/request', {
    body: { email: ' OPS@Example.com ' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.data.sent, true);
  assert.ok(res.json.data.expiresAt > Date.now());

  const mail = mails.at(-1);
  assert.equal(mail.to, 'ops@example.com');
  assert.equal(mail.subject, '[网站哨兵] 管理密码重置码');
  assert.doesNotMatch(mail.text, /https?:\/\//);
  assert.doesNotMatch(mail.html, /https?:\/\//);

  const found = mail.text.match(/\b[0-9A-Z]{4}(?:-[0-9A-Z]{4}){4}\b/);
  assert.ok(found, '邮件正文应包含分组重置码');
  resetCode = found[0].replace(/-/g, '');
  assert.equal(resetCode.length, 20);
});

test('提交重置：错误重置码返回剩余次数，且不改密码', async () => {
  const res = await request('POST', '/api/auth/reset/confirm', {
    body: { code: 'AAAA-BBBB-CCCC-DDDD-EEEE', password: 'newpass123' }
  });

  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'INVALID_RESET_CODE');
  assert.match(res.json.error.fields.code, /还可尝试 4 次/);
});

test('提交重置：密码不合格时先报密码，重置码不作废', async () => {
  const weak = await request('POST', '/api/auth/reset/confirm', {
    body: { code: resetCode, password: '123' }
  });
  assert.equal(weak.status, 400);
  assert.match(weak.json.error.fields.password, /至少 4 位/);

  const login = await request('POST', '/api/login', { body: { password: 'oldpass123' } });
  assert.equal(login.status, 200);
});

test('提交重置：正确重置码可改密（4 位密码即可），旧会话全部失效', async () => {
  const res = await request('POST', '/api/auth/reset/confirm', {
    body: { code: formatResetCode(resetCode), password: 'abcd' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.reset, true);

  const guarded = await request('GET', '/api/sites');
  assert.equal(guarded.status, 401);
});

test('改密后：旧密码失效，新密码可登录，重置码不能复用', async () => {
  const oldLogin = await request('POST', '/api/login', { body: { password: 'oldpass123' } });
  assert.equal(oldLogin.status, 401);

  const newLogin = await request('POST', '/api/login', { body: { password: 'abcd' } });
  assert.equal(newLogin.status, 200);

  const reuse = await request('POST', '/api/auth/reset/confirm', {
    body: { code: resetCode, password: 'another123' }
  });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.json.error.code, 'INVALID_RESET_CODE');
});

test('申请限速：同一 IP 5 分钟内第 4 次申请被拒', async () => {
  // 前面已有 2 次申请尝试（错误邮箱 1 次 + 成功 1 次），这里再发 1 次到上限，下一次被拒。
  const third = await request('POST', '/api/auth/reset/request', {
    body: { email: 'ops@example.com' }
  });
  assert.equal(third.status, 200);

  const blocked = await request('POST', '/api/auth/reset/request', {
    body: { email: 'ops@example.com' }
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, 'RATE_LIMITED');
});
