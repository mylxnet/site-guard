import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, hashText } from '../src/diff.js';

test('指纹：同文本稳定，不同文本不同，空文本可用', () => {
  assert.equal(hashText('甲\n乙'), hashText('甲\n乙'));
  assert.equal(hashText('甲\n乙').length, 64);
  assert.notEqual(hashText('甲\n乙'), hashText('甲\n丙'));
  assert.equal(hashText(''), hashText(''));
});

test('差异：新增与删除按原文顺序输出', () => {
  const before = '标题\n第一段\n第二段\n结尾';
  const after = '标题\n第一段\n新增公告\n结尾';
  const diff = diffLines(before, after);
  assert.deepEqual(diff.removed, ['第二段']);
  assert.deepEqual(diff.added, ['新增公告']);
  assert.equal(diff.removedCount, 1);
  assert.equal(diff.addedCount, 1);
  assert.equal(diff.truncated, false);
});

test('差异：重复行按出现次数算，不会被误判为全部变更', () => {
  const diff = diffLines('项目\n项目\n项目', '项目\n项目');
  assert.deepEqual(diff.removed, ['项目']);
  assert.deepEqual(diff.added, []);
  assert.equal(diff.removedCount, 1);
  assert.equal(diff.addedCount, 0);
});

test('差异：仅换序不算变更（多重集合相等）', () => {
  const diff = diffLines('甲\n乙\n丙', '丙\n甲\n乙');
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.equal(diff.truncated, false);
});

test('差异：空行不参与比对，一侧为空时全量增删', () => {
  const added = diffLines('', '甲\n\n乙');
  assert.deepEqual(added.added, ['甲', '乙']);
  assert.equal(added.addedCount, 2);

  const removed = diffLines('甲\n乙', '');
  assert.deepEqual(removed.removed, ['甲', '乙']);
});

test('差异：超过上限截断并标记', () => {
  const before = Array.from({ length: 10 }, (_, i) => `旧行 ${i}`).join('\n');
  const after = Array.from({ length: 10 }, (_, i) => `新行 ${i}`).join('\n');
  const diff = diffLines(before, after, { limit: 3 });
  assert.equal(diff.added.length, 3);
  assert.equal(diff.removed.length, 3);
  assert.equal(diff.addedCount, 10);
  assert.equal(diff.removedCount, 10);
  assert.equal(diff.truncated, true);
});
