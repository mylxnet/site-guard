import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDailyTimes,
  parseIntervalHours,
  nextRunAt,
  isDue,
  isCatchUp,
  jitterMs,
  localParts
} from '../src/schedule.js';

const BEIJING = 'Asia/Shanghai';
const at = (iso) => Date.parse(iso);

test('解析每天定时：接受多种分隔并规范化', () => {
  assert.deepEqual(parseDailyTimes('09:00, 21:00'), [
    { hh: 9, mm: 0 },
    { hh: 21, mm: 0 }
  ]);
  assert.equal(parseDailyTimes('09:00，21:00').length, 2);
  assert.throws(() => parseDailyTimes('25:00'), /HH:MM/);
  assert.throws(() => parseDailyTimes(''), /至少需要一个时刻/);
  assert.throws(() => parseDailyTimes('01:00,02:00,03:00,04:00,05:00'), /最多 4 个/);
});

test('解析间隔：只接受约定的小时数', () => {
  assert.equal(parseIntervalHours('6'), 6);
  assert.throws(() => parseIntervalHours('5'), /1\/2\/3\/4\/6\/8\/12\/24/);
  assert.throws(() => parseIntervalHours('0'), /间隔/);
});

test('下次运行：当天还有没到的时刻就取最近的', () => {
  const site = { schedule_mode: 'daily', schedule_value: '09:00, 21:00', timezone: BEIJING };
  // 北京时间 2026-10-25 08:30
  const now = at('2026-10-25T00:30:00Z');
  assert.equal(nextRunAt(site, now), at('2026-10-25T01:00:00Z'));
});

test('下次运行：当天时刻全过完就顺延到明天第一个', () => {
  const site = { schedule_mode: 'daily', schedule_value: '09:00, 21:00', timezone: BEIJING };
  // 北京时间 2026-10-25 22:00
  const now = at('2026-10-25T14:00:00Z');
  assert.equal(nextRunAt(site, now), at('2026-10-26T01:00:00Z'));
});

test('下次运行：不依赖进程时区（UTC 站点也能算对）', () => {
  const site = { schedule_mode: 'daily', schedule_value: '09:00', timezone: 'UTC' };
  const now = at('2026-10-25T08:30:00Z');
  assert.equal(nextRunAt(site, now), at('2026-10-25T09:00:00Z'));
});

test('下次运行：间隔模式从上次结束时刻起算', () => {
  const site = { schedule_mode: 'interval', schedule_value: '6', timezone: BEIJING, last_run_at: at('2026-10-25T00:00:00Z') };
  assert.equal(nextRunAt(site, at('2026-10-25T02:00:00Z')), at('2026-10-25T06:00:00Z'));
});

test('下次运行：间隔模式从未跑过时从现在起算', () => {
  const site = { schedule_mode: 'interval', schedule_value: '12', timezone: BEIJING, last_run_at: null };
  const now = at('2026-10-25T02:00:00Z');
  assert.equal(nextRunAt(site, now), now + 12 * 3600_000);
});

test('抖动是站点级稳定的 ±90 秒', () => {
  const a = jitterMs(7);
  assert.equal(a, jitterMs(7));
  assert.ok(Math.abs(a) <= 90_000);
  assert.notEqual(jitterMs(7), jitterMs(8));
});

test('isDue：到点且叠加抖动后才算该跑', () => {
  const now = at('2026-10-25T01:00:00Z');
  const offset = jitterMs(3);
  assert.equal(isDue({ id: 3, enabled: true, next_run_at: now - offset - 1000 }, now), true);
  assert.equal(isDue({ id: 3, enabled: true, next_run_at: now - offset + 60_000 }, now), false);
  assert.equal(isDue({ id: 3, enabled: false, next_run_at: now - 3600_000 }, now), false);
});

test('isCatchUp：错过超过 1.5 个周期才算补跑', () => {
  const now = at('2026-10-25T12:00:00Z');
  const daily = { schedule_mode: 'daily', schedule_value: '09:00, 21:00' };
  // 每天 2 次 → 周期 12 小时，超过 18 小时没跑才算漏检
  assert.equal(isCatchUp({ ...daily, last_run_at: now - 19 * 3600_000 }, now), true);
  assert.equal(isCatchUp({ ...daily, last_run_at: now - 13 * 3600_000 }, now), false);
  assert.equal(isCatchUp({ ...daily, last_run_at: null }, now), false);
});

test('localParts：按目标时区取墙上时间', () => {
  const p = localParts(at('2026-10-25T01:00:00Z'), BEIJING);
  assert.deepEqual(p, { year: 2026, month: 10, day: 25, hour: 9, minute: 0, second: 0 });
});
