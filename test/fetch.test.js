import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchPage, detectCharset, decodeBody } from '../src/fetch-page.js';

let server;
let base;

const page = (text, title = '测试页') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><p>${text}</p></body></html>`;

before(async () => {
  server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://local');
    switch (pathname) {
      case '/html':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page('正常内容'));
        break;
      case '/gbk': {
        // “中文”的 GBK 编码：D6 D0 CE C4。Node 自带 ICU，TextDecoder('gbk') 可直接解。
        const body = Buffer.concat([
          Buffer.from('<html><head><meta charset="gbk"><title>'),
          Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
          Buffer.from('</title></head><body><p>'),
          Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
          Buffer.from('</p></body></html>')
        ]);
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(body);
        break;
      }
      case '/redirect':
        res.writeHead(302, { location: '/html' });
        res.end();
        break;
      case '/loop':
        res.writeHead(302, { location: '/loop' });
        res.end();
        break;
      case '/slow':
        setTimeout(() => {
          if (res.writableEnded) return;
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(page('迟到的内容'));
        }, 2000).unref?.();
        break;
      case '/500':
        res.writeHead(500, { 'content-type': 'text/html' });
        res.end(page('oops', '500'));
        break;
      case '/json':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"a":1}');
        break;
      case '/big':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page('x'.repeat(20_000)));
        break;
      default:
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end(page('not found', '404'));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const options = { retries: 0, timeoutMs: 3000 };

test('正常抓取：状态码、最终地址、正文与耗时', async () => {
  const res = await fetchPage(`${base}/html`, options);
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.finalUrl, `${base}/html`);
  assert.match(res.contentType, /text\/html/);
  assert.match(res.html, /正常内容/);
  assert.equal(res.redirects, 0);
  assert.equal(res.truncated, false);
  assert.ok(res.responseMs >= 0);
  assert.ok(res.bytes > 0);
});

test('跟随重定向并记录最终地址', async () => {
  const res = await fetchPage(`${base}/redirect`, options);
  assert.equal(res.ok, true);
  assert.equal(res.finalUrl, `${base}/html`);
  assert.equal(res.redirects, 1);
  assert.match(res.html, /正常内容/);
});

test('重定向超过上限时失败，不无限跟随', async () => {
  const res = await fetchPage(`${base}/loop`, { ...options, maxRedirects: 3 });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'REDIRECT');
  assert.match(res.message, /超过 3 跳/);
});

test('超时归类为 TIMEOUT', async () => {
  const res = await fetchPage(`${base}/slow`, { retries: 0, timeoutMs: 120 });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'TIMEOUT');
  assert.match(res.message, /请求超时/);
  assert.ok(res.responseMs >= 100);
});

test('5xx 仍算抓取成功，由判定层判 bad', async () => {
  const res = await fetchPage(`${base}/500`, options);
  assert.equal(res.ok, true);
  assert.equal(res.status, 500);
});

test('非 HTML 响应保留 content-type，交给判定层', async () => {
  const res = await fetchPage(`${base}/json`, options);
  assert.equal(res.ok, true);
  assert.match(res.contentType, /application\/json/);
});

test('响应体超过上限时截断并标记', async () => {
  const res = await fetchPage(`${base}/big`, { ...options, maxBytes: 500 });
  assert.equal(res.ok, true);
  assert.equal(res.truncated, true);
  assert.ok(res.bytes <= 500);
});

test('GBK 页面按 meta charset 正确解码', async () => {
  const res = await fetchPage(`${base}/gbk`, options);
  assert.equal(res.ok, true);
  assert.match(res.html, /中文/);
});

test('404 页面照样返回内容（是否异常由判定层决定）', async () => {
  const res = await fetchPage(`${base}/nope`, options);
  assert.equal(res.ok, true);
  assert.equal(res.status, 404);
  assert.match(res.html, /not found/);
});

test('字符集探测与解码的边界', () => {
  assert.equal(detectCharset(Buffer.from('<meta charset="gb2312">'), ''), 'gbk');
  assert.equal(detectCharset(Buffer.from('<html></html>'), 'text/html; charset=UTF8'), 'utf-8');
  assert.equal(detectCharset(Buffer.from('<html></html>'), ''), 'utf-8');
  assert.equal(decodeBody(Buffer.from('中文', 'utf8'), 'text/html; charset=utf-8'), '中文');
  // 未知字符集不能抛错，退化为 UTF-8。
  assert.equal(decodeBody(Buffer.from('abc'), 'text/html; charset=not-a-charset'), 'abc');
});
