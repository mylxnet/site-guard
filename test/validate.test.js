import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSite, validatePage, validatePassword, ValidationError, requireId } from '../src/validate.js';

const siteInput = (overrides = {}) => ({
  name: '示例科技',
  baseUrl: 'https://www.example.com',
  scheduleMode: 'daily',
  scheduleValue: '09:00, 21:00',
  timezone: 'Asia/Shanghai',
  enabled: true,
  ...overrides
});

const fieldsOf = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ValidationError, `应抛 ValidationError，实际 ${err}`);
    return err.fields;
  }
  assert.fail('应当校验失败');
};

test('站点：合法输入被规范化', () => {
  const data = validateSite(siteInput({ baseUrl: '  https://example.com/path  ' }));
  assert.equal(data.baseUrl, 'https://example.com/path');
  assert.equal(data.scheduleValue, '09:00, 21:00');
  assert.equal(data.enabled, true);
});

test('站点：地址必须是 http(s)，且错误字段精确', () => {
  const fields = fieldsOf(() => validateSite(siteInput({ baseUrl: 'example.com' })));
  assert.match(fields.baseUrl, /http:\/\//);
  assert.deepEqual(Object.keys(fields), ['baseUrl']);
});

test('站点：时刻格式错误要指出来', () => {
  const fields = fieldsOf(() => validateSite(siteInput({ scheduleValue: '09:00, 25:00' })));
  assert.match(fields.scheduleValue, /25:00/);
  assert.match(fields.scheduleValue, /HH:MM/);
});

test('站点：间隔只能是约定值', () => {
  const fields = fieldsOf(() => validateSite(siteInput({ scheduleMode: 'interval', scheduleValue: 5 })));
  assert.match(fields.scheduleValue, /1\/2\/3\/4\/6\/8\/12\/24/);
  assert.equal(validateSite(siteInput({ scheduleMode: 'interval', scheduleValue: 6 })).scheduleValue, '6');
});

test('站点：多个字段错误一次返回', () => {
  const fields = fieldsOf(() => validateSite({ name: '', baseUrl: 'ftp://x', scheduleMode: 'daily', scheduleValue: '' }));
  assert.deepEqual(Object.keys(fields).sort(), ['baseUrl', 'name', 'scheduleValue']);
});

test('页面：忽略规则必须是合法正则', () => {
  const fields = fieldsOf(() =>
    validatePage({ name: '主页', url: 'https://example.com/', ignorePatterns: ['([a-z'] })
  );
  assert.match(fields.ignorePatterns, /写法有误/);
});

test('页面：必须包含文字有上限', () => {
  const fields = fieldsOf(() =>
    validatePage({ name: '主页', url: 'https://example.com/', mustContain: Array.from({ length: 11 }, (_, i) => `x${i}`) })
  );
  assert.match(fields.mustContain, /最多 10 项/);
});

test('页面：关键词可用逗号字符串，空白被清理', () => {
  const data = validatePage({ name: '主页', url: 'https://example.com/', keywords: ' 加微信 , 内部资料 ,, ' });
  assert.equal(data.keywords, '加微信,内部资料');
  assert.deepEqual(data.mustContain, []);
});

test('页面：URL 与名称都必填', () => {
  const fields = fieldsOf(() => validatePage({ name: ' ', url: '' }));
  assert.ok(fields.name);
  assert.ok(fields.url);
});

test('密码：长度区间', () => {
  assert.throws(() => validatePassword('1234567'), /至少 8 位/);
  assert.throws(() => validatePassword('x'.repeat(129)), /最多 128 位/);
  assert.equal(validatePassword('12345678'), '12345678');
});

test('ID：必须是正整数', () => {
  assert.equal(requireId('12'), 12);
  assert.throws(() => requireId('0'), /ID 不合法/);
  assert.throws(() => requireId('abc'), /ID 不合法/);
});
