import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/verdict.js';

const ARTICLE = '示例科技官网：这是网站的正常正文内容，用于测试判定规则。'.repeat(10);

const base = {
  fetch: {
    ok: true,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    finalUrl: 'https://www.example.com/',
    responseMs: 120
  },
  url: 'https://www.example.com/',
  baseUrl: 'https://www.example.com/',
  html: '<html><body><p>正文</p></body></html>',
  title: '示例科技官网',
  text: ARTICLE,
  charCount: ARTICLE.length,
  mustContain: [],
  baseline: null
};

const ctx = (patch = {}) => ({
  ...base,
  ...patch,
  fetch: { ...base.fetch, ...(patch.fetch ?? {}) }
});

test('正常页面：无命中，结论 normal', () => {
  const { verdict, reasons } = evaluate(ctx());
  assert.equal(verdict, 'normal');
  assert.deepEqual(reasons, []);
});

test('5xx、非 HTML、空标题、错误页特征都是 bad', () => {
  assert.equal(evaluate(ctx({ fetch: { status: 502 } })).verdict, 'bad');

  const pdf = evaluate(ctx({ fetch: { contentType: 'application/pdf' } }));
  assert.equal(pdf.verdict, 'bad');
  assert.match(pdf.reasons[0].text, /application\/pdf/);

  const noTitle = evaluate(ctx({ title: '' }));
  assert.equal(noTitle.verdict, 'bad');
  assert.match(noTitle.reasons.map((r) => r.text).join('；'), /没有标题/);

  const errorPage = evaluate(ctx({ title: '502 Bad Gateway', text: '502 Bad Gateway nginx', charCount: 20 }));
  assert.equal(errorPage.verdict, 'bad');
  assert.match(errorPage.reasons.map((r) => r.text).join('；'), /标题变为/);
});

test('跨域跳转 bad，同域跳转 suspect，www 视为同域', () => {
  const cross = evaluate(ctx({ fetch: { finalUrl: 'https://parking.example/landing' } }));
  assert.equal(cross.verdict, 'bad');
  assert.match(cross.reasons[0].text, /被跳转到 parking\.example/);

  const sameHost = evaluate(ctx({ fetch: { finalUrl: 'https://www.example.com/landing' } }));
  assert.equal(sameHost.verdict, 'suspect');
  assert.match(sameHost.reasons[0].text, /被重定向到 \/landing/);

  const wwwSwap = evaluate(ctx({ fetch: { finalUrl: 'https://example.com/' } }));
  assert.equal(wwwSwap.verdict, 'normal', 'www 与裸域不应算跨域');
});

test('多页面站点：子路径与子域页面不应被当成跳转', () => {
  const list = evaluate(ctx({ url: 'https://www.example.com/list', fetch: { finalUrl: 'https://www.example.com/list' } }));
  assert.equal(list.verdict, 'normal', '列表页路径与首页不同是正常的');

  const blog = evaluate(ctx({ url: 'https://blog.example.com/', fetch: { finalUrl: 'https://blog.example.com/' } }));
  assert.equal(blog.verdict, 'normal', '同站点不同子域不应判跨域');

  const detailRedirect = evaluate(
    ctx({ url: 'https://www.example.com/post/1', fetch: { finalUrl: 'https://www.example.com/post/2' } })
  );
  assert.equal(detailRedirect.verdict, 'suspect');
  assert.match(detailRedirect.reasons[0].text, /\/post\/2/);
});

test('关键断言缺失是 bad，存在时不报', () => {
  const missing = evaluate(ctx({ mustContain: ['示例科技', '备案号 京ICP'] }));
  assert.equal(missing.verdict, 'bad');
  assert.match(missing.reasons.map((r) => r.text).join('；'), /备案号 京ICP/);

  assert.equal(evaluate(ctx({ mustContain: ['示例科技'] })).verdict, 'normal');
});

test('反爬挑战是 unknown，且优先于“正文接近空白”', () => {
  const { verdict, reasons } = evaluate(
    ctx({
      fetch: { status: 503 },
      html: '<html><body><div id="challenge"><p>Just a moment...</p></div></body></html>',
      title: 'Just a moment...',
      text: 'Just a moment...',
      charCount: 18
    })
  );
  assert.equal(verdict, 'unknown');
  assert.ok(reasons.some((r) => r.level === 'unknown' && /反爬/.test(r.text)));
  assert.ok(reasons.some((r) => r.level === 'bad'), '其它 bad 理由仍要保留给界面');
});

test('需要登录是 unknown', () => {
  const text = evaluate(ctx({ text: '请登录后查看完整内容', charCount: 11 }));
  assert.equal(text.verdict, 'unknown');
  assert.ok(text.reasons.some((reason) => /要求登录/.test(reason.text)));

  const path = evaluate(ctx({ fetch: { finalUrl: 'https://www.example.com/login?next=/' } }));
  assert.equal(path.verdict, 'unknown');
});

test('SPA 空壳是 unknown，而不是“空白页”', () => {
  const shell = evaluate(
    ctx({
      html: '<html><body><div id="app"></div><script src="/app.js"></script></body></html>',
      text: '',
      title: '示例科技',
      charCount: 0
    })
  );
  assert.equal(shell.verdict, 'unknown');
  assert.match(shell.reasons.map((r) => r.text).join('；'), /JS 渲染/);
});

test('响应缓慢是 suspect', () => {
  const slow = evaluate(ctx({ fetch: { responseMs: 12_000 } }));
  assert.equal(slow.verdict, 'suspect');
  assert.match(slow.reasons[0].text, /12000ms/);
});

test('正文下降：低于 30% 是 bad，30%~60% 是 suspect', () => {
  const baseline = { textLen: 1000, hash: 'x' };
  const steep = evaluate(ctx({ charCount: 200, baseline }));
  assert.equal(steep.verdict, 'bad');
  assert.match(steep.reasons.map((r) => r.text).join('；'), /由 1000 字降至 200 字/);

  const mild = evaluate(ctx({ charCount: 500, baseline }));
  assert.equal(mild.verdict, 'suspect');
  assert.match(mild.reasons[0].text, /下降 50%/);
});

test('正文偏少是 suspect，真正空白才是 bad', () => {
  const thin = evaluate(ctx({ text: 'x'.repeat(156), charCount: 156 }));
  assert.equal(thin.verdict, 'suspect');
  assert.match(thin.reasons[0].text, /内容偏少/);

  const blank = evaluate(ctx({ text: '暂无内容', charCount: 4 }));
  assert.equal(blank.verdict, 'bad');
  assert.match(blank.reasons[0].text, /接近空白页/);
});

test('短页面不被 200 字阈值永久判死', () => {
  const shortPage = evaluate(ctx({ text: '短公告', charCount: 120, baseline: { textLen: 130, hash: 'x' } }));
  assert.equal(shortPage.verdict, 'normal', '基线本来就短时不应套用空白页规则');
});

test('抓取失败只报传输错误，不再叠加内容规则', () => {
  const failed = evaluate(
    ctx({ fetch: { ok: false, error: 'TIMEOUT', message: '请求超时（20s）', responseMs: 20_000 }, text: '', charCount: 0 })
  );
  assert.equal(failed.verdict, 'bad');
  assert.equal(failed.reasons.length, 1);
  assert.equal(failed.reasons[0].text, 'TIMEOUT：请求超时（20s）');
});

test('规则异常不会改变结论（单条规则兜底）', () => {
  const broken = ctx({ text: undefined, mustContain: ['不该崩'] });
  assert.doesNotThrow(() => evaluate(broken));
});
