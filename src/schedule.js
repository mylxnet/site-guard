/**
 * 计划计算：不依赖宿主机本地时区。
 * 所有换算通过 Intl 取目标时区的“墙上时间”，再还原成时间戳。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const dtfCache = new Map();

function dtf(timeZone) {
  let formatter = dtfCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    dtfCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone) {
  try {
    dtf(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function localParts(ts, timeZone) {
  const parts = dtf(timeZone).formatToParts(new Date(ts));
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

export function zoneOffsetMs(ts, timeZone) {
  const p = localParts(ts, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - ts;
}

/** 把某时区的“墙上时间”转成时间戳。 */
export function zonedToUtc({ year, month, day, hour, minute }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = zoneOffsetMs(guess, timeZone);
  let ts = guess - firstOffset;
  const secondOffset = zoneOffsetMs(ts, timeZone);
  if (secondOffset !== firstOffset) ts = guess - secondOffset;
  return ts;
}

/** 解析 "09:00, 21:00"，非法时抛错（调用方负责转成字段错误）。 */
export function parseDailyTimes(value) {
  const items = String(value ?? '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!items.length) throw new Error('至少需要一个时刻，例如 09:00');
  if (items.length > 4) throw new Error('最多 4 个时刻');

  return items.map((item) => {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(item);
    if (!m) throw new Error(`时刻「${item}」格式不对，应为 HH:MM（如 09:00）`);
    return { hh: Number(m[1]), mm: Number(m[2]) };
  });
}

export function parseIntervalHours(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || ![1, 2, 3, 4, 6, 8, 12, 24].includes(n)) {
    throw new Error('间隔只能是 1/2/3/4/6/8/12/24 小时之一');
  }
  return n;
}

/**
 * 计算下一次应巡检的时间戳（不含抖动，抖动在比较时叠加）。
 * - daily：取今天剩余的时刻，没有就取明天第一个
 * - interval：上次巡检 + N 小时；从未巡检过则从现在起算
 */
export function nextRunAt(site, from = Date.now()) {
  const timeZone = site.timezone || 'Asia/Shanghai';

  if (site.schedule_mode === 'interval') {
    const hours = parseIntervalHours(site.schedule_value);
    const base = site.last_run_at ? Number(site.last_run_at) : from;
    return base + hours * 60 * 60 * 1000;
  }

  const times = parseDailyTimes(site.schedule_value);
  const p = localParts(from, timeZone);

  const todayCandidates = times
    .map((t) => zonedToUtc({ year: p.year, month: p.month, day: p.day, hour: t.hh, minute: t.mm }, timeZone))
    .filter((ts) => ts > from)
    .sort((a, b) => a - b);

  if (todayCandidates.length) return todayCandidates[0];

  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day) + DAY_MS);
  return zonedToUtc(
    {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      hour: times[0].hh,
      minute: times[0].mm
    },
    timeZone
  );
}

/** 站点级稳定抖动：±90 秒，同一站点每次都一样。 */
export function jitterMs(siteId) {
  let hash = 2166136261;
  for (const ch of String(siteId)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const span = 180_000;
  return (Math.abs(hash) % span) - span / 2;
}

/** 计划周期的近似长度，用于判断“错过多久算补跑”。 */
export function periodMs(site) {
  if (site.schedule_mode === 'interval') {
    return parseIntervalHours(site.schedule_value) * 60 * 60 * 1000;
  }
  const count = parseDailyTimes(site.schedule_value).length;
  return DAY_MS / Math.max(count, 1);
}

export function isDue(site, now = Date.now()) {
  if (!site.enabled) return false;
  const scheduled = Number(site.next_run_at ?? 0);
  return now >= scheduled + jitterMs(site.id);
}

export function isCatchUp(site, now = Date.now()) {
  if (!site.last_run_at) return false;
  return now - Number(site.last_run_at) > periodMs(site) * 1.5;
}

export function describeSchedule(site) {
  if (site.schedule_mode === 'interval') return `每 ${site.schedule_value} 小时`;
  return `每天 ${String(site.schedule_value).replace(/\s+/g, ' ')}`;
}
