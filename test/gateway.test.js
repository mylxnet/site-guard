import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp, socketTargetFor } from '../src/server.js';
import { config as baseConfig } from '../src/config.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

async function startApp(config = {}) {
  const app = createApp({
    config: { ...baseConfig, dbFile: ':memory:', gatewayPrefix: '', allowedOrigins: [], ...config },
    logger: silentLogger
  });
  const address = await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${address.port}` };
}

test('网关前缀：/app/siteguard/api/* 与 /app/siteguard/ 都能走通', async () => {
  const { app, base } = await startApp({ gatewayPrefix: '/app/siteguard' });
  try {
    const health = await fetch(`${base}/app/siteguard/api/health`);
    assert.equal(health.status, 200);
    const payload = await health.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.db, 'ok');

    const page = await fetch(`${base}/app/siteguard/`, { headers: { accept: 'text/html' } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /网站哨兵/);

    // 前缀本身也要能打开，网关偶尔会用不带斜杠的地址探活。
    const bare = await fetch(`${base}/app/siteguard`, { headers: { accept: 'text/html' } });
    assert.equal(bare.status, 200);
  } finally {
    await app.close();
  }
});

test('网关前缀：直连路径依然可用（本地端口调试不用带前缀）', async () => {
  const { app, base } = await startApp({ gatewayPrefix: '/app/siteguard' });
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const page = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
    assert.equal(page.status, 200);
  } finally {
    await app.close();
  }
});

/** 走 Unix Socket 发一次请求：fnOS 统一网关就是这么转过来的。 */
function socketRequest(socketPath, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: urlPath, headers: { accept: 'text/html' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
      );
    });
    req.on('error', reject);
    req.end();
  });
}

test('Unix Socket：不监听端口也能通过 app.sock 提供网关前缀下的接口与页面', async () => {
  // 配置里给原始文件路径：Linux 上是真实 socket 文件，Windows 上由 socketTargetFor 映射成命名管道。
  const rawSocketPath = path.join(os.tmpdir(), `siteguard-test-${process.pid}.sock`);
  const socketPath = socketTargetFor(rawSocketPath);
  const app = createApp({
    config: { ...baseConfig, dbFile: ':memory:', gatewayPrefix: '/app/siteguard', allowedOrigins: [], socketPath: rawSocketPath },
    logger: silentLogger
  });
  await app.listen();
  try {
    const health = await socketRequest(socketPath, '/app/siteguard/api/health');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).data.db, 'ok');

    const page = await socketRequest(socketPath, '/app/siteguard/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.body, /网站哨兵/);

    // 不带前缀的健康检查在网关模式下照样能用（cmd/main 的探活走的就是它）。
    const bare = await socketRequest(socketPath, '/api/health');
    assert.equal(bare.status, 200);
  } finally {
    await app.close();
  }
});

test('单页兑底：无扩展名路径返回 index.html，缺静态文件仍然 404', async () => {
  const { app, base } = await startApp({ gatewayPrefix: '/app/siteguard' });
  try {
    const spa = await fetch(`${base}/app/siteguard/sites/3`, { headers: { accept: 'text/html' } });
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /网站哨兵/);

    const asset = await fetch(`${base}/app/siteguard/app.js`, { headers: { accept: '*/*' } });
    assert.equal(asset.status, 200);

    const missingAsset = await fetch(`${base}/app/siteguard/missing-asset.js`, { headers: { accept: '*/*' } });
    assert.equal(missingAsset.status, 404);

    const traversal = await fetch(`${base}/app/siteguard/..%2F..%2Fpackage.json`, { headers: { accept: '*/*' } });
    assert.equal(traversal.status, 404);
  } finally {
    await app.close();
  }
});

test('iframe 头：网关模式放行同源嵌套，直连模式仍然禁止', async () => {
  const framed = await startApp({ gatewayPrefix: '/app/siteguard' });
  try {
    const res = await fetch(`${framed.base}/app/siteguard/`, { headers: { accept: 'text/html' } });
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  } finally {
    await framed.app.close();
  }

  const direct = await startApp({});
  try {
    const res = await fetch(`${direct.base}/`, { headers: { accept: 'text/html' } });
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally {
    await direct.app.close();
  }
});

test('ALLOWED_ORIGINS：网关改写 Host 时，列出的来源不再被判跨站', async () => {
  const { app, base } = await startApp({
    gatewayPrefix: '/app/siteguard',
    allowedOrigins: ['nas.example.com']
  });
  try {
    const blocked = await fetch(`${base}/app/siteguard/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
      body: JSON.stringify({ password: '12345678' })
    });
    assert.equal(blocked.status, 403);

    // 来源放行后不再是 403（未初始化，返回 409），说明同源校验确实用到了白名单。
    const allowed = await fetch(`${base}/app/siteguard/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://nas.example.com' },
      body: JSON.stringify({ password: '12345678' })
    });
    assert.equal(allowed.status, 409);
  } finally {
    await app.close();
  }
});
