import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHtml, extractTitle, decodeEntities, compileIgnorePatterns } from '../src/extract.js';

test('实体解码：命名实体、十进制与十六进制', () => {
  assert.equal(decodeEntities('a&amp;b&nbsp;c'), 'a&b c');
  assert.equal(decodeEntities('&#20013;&#x6587;'), '中文');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
  assert.equal(decodeEntities('&#999999999;'), '&#999999999;');
});

test('标题：去标签、压缩空白、超长截断', () => {
  assert.equal(extractTitle('<html><head><title>  示例\n 科技 </title></head></html>'), '示例 科技');
  assert.equal(extractTitle('<html><head></head></html>'), '');
  assert.equal(extractTitle(`<title>${'字'.repeat(300)}</title>`).length, 200);
});

test('脚本、样式、注释、内嵌框架都不进正文', () => {
  const html = `
    <html><head>
      <title>示例</title>
      <style>.a{color:red}</style>
      <script>var leak = '这段不该出现';</script>
    </head><body>
      <!-- 注释也不该出现 -->
      <noscript>请开启 JavaScript</noscript>
      <svg><text>图标文字</text></svg>
      <iframe src="https://ads.example">广告框</iframe>
      <p>正文第一段</p>
      <div>正文第二段</div>
    </body></html>`;
  const out = extractHtml(html);
  assert.equal(out.title, '示例');
  assert.equal(out.text, '正文第一段\n正文第二段');
  assert.equal(out.charCount, 10);
  for (const word of ['这段不该出现', '注释', '请开启', '图标文字', '广告框', 'color:red']) {
    assert.ok(!out.text.includes(word), `不应包含「${word}」`);
  }
});

test('块级标签换行，行内标签空格分隔，空行被丢弃', () => {
  const out = extractHtml('<div>第一行</div><div>第二行</div><span>甲</span><span>乙</span><br><br>末尾');
  assert.deepEqual(out.lines, ['第一行', '第二行', '甲 乙', '末尾']);
});

test('忽略规则逐行丢弃且不影响指纹', () => {
  const html = '<p>正文</p><p>更新时间：2026-10-25 12:00</p><p>访问量 12345</p>';
  const plain = extractHtml(html, { ignorePatterns: ['^更新时间：', '^访问量\\s+\\d+$'] });
  assert.equal(plain.text, '正文');
  assert.equal(plain.ignoredLines, 2);

  const next = extractHtml('<p>正文</p><p>更新时间：2027-01-01 09:00</p><p>访问量 999</p>', {
    ignorePatterns: ['^更新时间：', '^访问量\\s+\\d+$']
  });
  assert.equal(next.text, plain.text, '忽略的内容变化不应影响正文');
});

test('坏忽略规则不会让整页失败', () => {
  const out = extractHtml('<p>正文</p>', { ignorePatterns: ['([a-z', '正文'] });
  assert.equal(compileIgnorePatterns(['([a-z']).length, 0);
  assert.equal(out.text, '');
});

test('畸形输入退化为空正文而不抛错', () => {
  for (const input of [null, undefined, 42, { a: 1 }]) {
    const out = extractHtml(input);
    assert.equal(out.text, '');
    assert.equal(out.charCount, 0);
    assert.equal(out.title, '');
  }
  const unclosed = extractHtml('<title>标题</title><p>可见</p><script>var x = 1;');
  assert.equal(unclosed.text, '可见');
});

test('零宽字符与全角空格被清掉', () => {
  const out = extractHtml('<p>甲\u200b乙\u3000丙</p>');
  assert.equal(out.text, '甲乙 丙');
});
