import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 表结构按 user_version 递增迁移。
 * v1：MVP 首版（站点/页面/快照/检测/事件/设置/会话）。
 * 注意：不启用外键约束，级联删除由 store 层函数显式完成（SQLite 的 FK 需要每次连接开启，
 * 且删除顺序易错；显式清理更可控，也便于写测试）。
 */
const MIGRATIONS = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  base_url       TEXT    NOT NULL,
  schedule_mode  TEXT    NOT NULL,
  schedule_value TEXT    NOT NULL,
  timezone       TEXT    NOT NULL DEFAULT 'Asia/Shanghai',
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_run_at    INTEGER,
  next_run_at    INTEGER,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  hash       TEXT    NOT NULL,
  text       TEXT    NOT NULL,
  meta       TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_snapshots_page ON snapshots(page_id, id DESC);

CREATE TABLE IF NOT EXISTS pages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER NOT NULL,
  name            TEXT    NOT NULL,
  url             TEXT    NOT NULL,
  must_contain    TEXT    NOT NULL DEFAULT '[]',
  ignore_patterns TEXT    NOT NULL DEFAULT '[]',
  keywords        TEXT    NOT NULL DEFAULT '',
  enabled         INTEGER NOT NULL DEFAULT 1,
  state           TEXT    NOT NULL DEFAULT 'unknown',
  changed         INTEGER NOT NULL DEFAULT 0,
  baseline_id     INTEGER,
  last_checked_at INTEGER,
  last_message    TEXT    NOT NULL DEFAULT '',
  last_alert_at   INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pages_site ON pages(site_id);

CREATE TABLE IF NOT EXISTS checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    TEXT    NOT NULL,
  page_id     INTEGER NOT NULL,
  ran_at      INTEGER NOT NULL,
  verdict     TEXT    NOT NULL,
  http_code   INTEGER,
  response_ms INTEGER,
  final_url   TEXT,
  title       TEXT,
  text_len    INTEGER,
  changed     INTEGER NOT NULL DEFAULT 0,
  reasons     TEXT    NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_checks_page ON checks(page_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_checks_batch ON checks(batch_id);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id   TEXT,
  site_id    INTEGER,
  page_id    INTEGER,
  type       TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  notified   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events(id DESC);
`
  }
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version ?? 0);
  for (const step of MIGRATIONS) {
    if (step.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(step.sql);
      db.exec(`PRAGMA user_version = ${step.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`数据库迁移失败（v${step.version}）：${err.message}`);
    }
  }
}

/* ---------- 设置 ---------- */

export function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value ?? ''));
}

export function getSettings(db) {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

/* ---------- 站点 ---------- */

const siteRow = (row) => row && {
  ...row,
  enabled: Boolean(row.enabled),
  pages: []
};

export function listSites(db) {
  return db.prepare('SELECT * FROM sites ORDER BY id').all().map(siteRow);
}

export function getSite(db, id) {
  return siteRow(db.prepare('SELECT * FROM sites WHERE id = ?').get(Number(id)));
}

export function createSite(db, data) {
  const info = db
    .prepare(
      `INSERT INTO sites (name, base_url, schedule_mode, schedule_value, timezone, enabled, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.name,
      data.baseUrl,
      data.scheduleMode,
      data.scheduleValue,
      data.timezone,
      data.enabled ? 1 : 0,
      data.nextRunAt,
      Date.now()
    );
  return getSite(db, Number(info.lastInsertRowid));
}

export function updateSite(db, id, data) {
  db.prepare(
    `UPDATE sites SET name = ?, base_url = ?, schedule_mode = ?, schedule_value = ?,
       timezone = ?, enabled = ?, next_run_at = ? WHERE id = ?`
  ).run(
    data.name,
    data.baseUrl,
    data.scheduleMode,
    data.scheduleValue,
    data.timezone,
    data.enabled ? 1 : 0,
    data.nextRunAt,
    Number(id)
  );
  return getSite(db, id);
}

export function deleteSite(db, id) {
  const siteId = Number(id);
  const pageIds = db.prepare('SELECT id FROM pages WHERE site_id = ?').all(siteId).map((r) => r.id);
  for (const pageId of pageIds) {
    db.prepare('DELETE FROM snapshots WHERE page_id = ?').run(pageId);
    db.prepare('DELETE FROM checks WHERE page_id = ?').run(pageId);
  }
  db.prepare('DELETE FROM pages WHERE site_id = ?').run(siteId);
  db.prepare('DELETE FROM events WHERE site_id = ?').run(siteId);
  db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);
}

export function markSiteRun(db, id, { lastRunAt, nextRunAt }) {
  db.prepare('UPDATE sites SET last_run_at = ?, next_run_at = ? WHERE id = ?')
    .run(lastRunAt, nextRunAt, Number(id));
}

/* ---------- 页面 ---------- */

const pageRow = (row) => row && {
  ...row,
  enabled: Boolean(row.enabled),
  changed: Boolean(row.changed),
  mustContain: JSON.parse(row.must_contain || '[]'),
  ignorePatterns: JSON.parse(row.ignore_patterns || '[]')
};

export function listPages(db, siteId = null) {
  const rows = siteId == null
    ? db.prepare('SELECT * FROM pages ORDER BY id').all()
    : db.prepare('SELECT * FROM pages WHERE site_id = ? ORDER BY id').all(Number(siteId));
  return rows.map(pageRow);
}

export function getPage(db, id) {
  return pageRow(db.prepare('SELECT * FROM pages WHERE id = ?').get(Number(id)));
}

export function createPage(db, siteId, data) {
  const info = db
    .prepare(
      `INSERT INTO pages (site_id, name, url, must_contain, ignore_patterns, keywords, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(siteId),
      data.name,
      data.url,
      JSON.stringify(data.mustContain ?? []),
      JSON.stringify(data.ignorePatterns ?? []),
      data.keywords ?? '',
      data.enabled === false ? 0 : 1,
      Date.now()
    );
  return getPage(db, Number(info.lastInsertRowid));
}

export function updatePage(db, id, data) {
  db.prepare(
    `UPDATE pages SET name = ?, url = ?, must_contain = ?, ignore_patterns = ?, keywords = ?, enabled = ?
     WHERE id = ?`
  ).run(
    data.name,
    data.url,
    JSON.stringify(data.mustContain ?? []),
    JSON.stringify(data.ignorePatterns ?? []),
    data.keywords ?? '',
    data.enabled === false ? 0 : 1,
    Number(id)
  );
  return getPage(db, id);
}

export function deletePage(db, id) {
  const pageId = Number(id);
  db.prepare('DELETE FROM snapshots WHERE page_id = ?').run(pageId);
  db.prepare('DELETE FROM checks WHERE page_id = ?').run(pageId);
  db.prepare('DELETE FROM events WHERE page_id = ?').run(pageId);
  db.prepare('DELETE FROM pages WHERE id = ?').run(pageId);
}

/* ---------- 事件 ---------- */

export function addEvent(db, { batchId = null, siteId = null, pageId = null, type, message, notified = 0 }) {
  const info = db
    .prepare(
      'INSERT INTO events (batch_id, site_id, page_id, type, message, notified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(batchId, siteId, pageId, type, message, notified ? 1 : 0, Date.now());
  return Number(info.lastInsertRowid);
}

const eventConditions = ({ type = null, siteId = null } = {}) => {
  const cond = [];
  const args = [];
  if (type) { cond.push('e.type = ?'); args.push(type); }
  if (siteId) { cond.push('e.site_id = ?'); args.push(Number(siteId)); }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', args };
};

export function listEvents(db, { limit = 100, offset = 0, type = null, siteId = null } = {}) {
  const { where, args } = eventConditions({ type, siteId });
  const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const skip = Math.max(Number(offset) || 0, 0);

  return db.prepare(
    `SELECT e.*, p.name AS page_name, s.name AS site_name
     FROM events e
     LEFT JOIN pages p ON p.id = e.page_id
     LEFT JOIN sites s ON s.id = e.site_id
     ${where}
     ORDER BY e.id DESC LIMIT ? OFFSET ?`
  ).all(...args, take, skip).map((row) => ({
    ...row,
    notified: Boolean(row.notified)
  }));
}

export function countEvents(db, { type = null, siteId = null } = {}) {
  const { where, args } = eventConditions({ type, siteId });
  const row = db.prepare(`SELECT COUNT(*) AS n FROM events e ${where}`).get(...args);
  return Number(row?.n ?? 0);
}

/** 一轮巡检产生的事件，邮件汇总按批次取，不跨轮次。 */
export function listEventsByBatch(db, batchId) {
  return db
    .prepare(
      `SELECT e.*, p.name AS page_name, p.url AS page_url, p.baseline_id, s.name AS site_name
       FROM events e
       LEFT JOIN pages p ON p.id = e.page_id
       LEFT JOIN sites s ON s.id = e.site_id
       WHERE e.batch_id = ? ORDER BY e.id`
    )
    .all(String(batchId))
    .map((row) => ({ ...row, notified: Boolean(row.notified) }));
}

export function checkInBatch(db, batchId, pageId) {
  const row = db
    .prepare('SELECT * FROM checks WHERE batch_id = ? AND page_id = ? ORDER BY id DESC LIMIT 1')
    .get(String(batchId), Number(pageId));
  return row ? { ...row, changed: Boolean(row.changed), reasons: JSON.parse(row.reasons || '[]') } : null;
}

export function markEventsNotified(db, ids) {
  const list = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!list.length) return 0;
  const marks = list.map(() => '?').join(',');
  return Number(db.prepare(`UPDATE events SET notified = 1 WHERE id IN (${marks})`).run(...list).changes ?? 0);
}

/** 冷却只看“上一次真的发出去”的时刻，没发信就不该压制后续告警。 */
export function markPagesAlerted(db, pageIds, at = Date.now()) {
  const list = [...new Set(pageIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!list.length) return 0;
  const marks = list.map(() => '?').join(',');
  return Number(db.prepare(`UPDATE pages SET last_alert_at = ? WHERE id IN (${marks})`).run(at, ...list).changes ?? 0);
}

/* ---------- 检测结果 ---------- */

export function insertCheck(db, data) {
  const info = db
    .prepare(
      `INSERT INTO checks (batch_id, page_id, ran_at, verdict, http_code, response_ms, final_url, title, text_len, changed, reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.batchId,
      Number(data.pageId),
      data.ranAt ?? Date.now(),
      data.verdict,
      data.httpCode ?? null,
      data.responseMs ?? null,
      data.finalUrl ?? null,
      data.title ?? null,
      data.textLen ?? null,
      data.changed ? 1 : 0,
      JSON.stringify(data.reasons ?? [])
    );
  return Number(info.lastInsertRowid);
}

export function latestCheck(db, pageId) {
  const row = db.prepare('SELECT * FROM checks WHERE page_id = ? ORDER BY id DESC LIMIT 1').get(Number(pageId));
  if (!row) return null;
  return {
    ...row,
    changed: Boolean(row.changed),
    reasons: JSON.parse(row.reasons || '[]')
  };
}

/** 一次取回多页的“最近一次检测”，避免列表接口 N+1 查询。 */
export function latestChecksForPages(db, pageIds) {
  const ids = pageIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return new Map();

  const marks = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT c.* FROM checks c
       JOIN (SELECT page_id, MAX(id) AS max_id FROM checks WHERE page_id IN (${marks}) GROUP BY page_id) m
         ON c.id = m.max_id`
    )
    .all(...ids);

  return new Map(
    rows.map((row) => [
      row.page_id,
      { ...row, changed: Boolean(row.changed), reasons: JSON.parse(row.reasons || '[]') }
    ])
  );
}

export function countPages(db, siteId) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM pages WHERE site_id = ?').get(Number(siteId));
  return Number(row?.n ?? 0);
}

export function lastRunAt(db) {
  const row = db.prepare('SELECT MAX(last_run_at) AS ts FROM sites').get();
  return row?.ts ?? null;
}

export function insertSnapshot(db, data) {
  const info = db
    .prepare('INSERT INTO snapshots (page_id, kind, created_at, hash, text, meta) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Number(data.pageId), data.kind, Date.now(), data.hash, data.text, JSON.stringify(data.meta ?? {}));
  return Number(info.lastInsertRowid);
}

export function getSnapshot(db, id) {
  const row = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(Number(id));
  return row ? { ...row, meta: JSON.parse(row.meta || '{}') } : null;
}

export function latestSnapshot(db, pageId, kind = null) {
  const row = kind
    ? db.prepare('SELECT * FROM snapshots WHERE page_id = ? AND kind = ? ORDER BY id DESC LIMIT 1')
        .get(Number(pageId), kind)
    : db.prepare('SELECT * FROM snapshots WHERE page_id = ? ORDER BY id DESC LIMIT 1').get(Number(pageId));
  return row ? { ...row, meta: JSON.parse(row.meta || '{}') } : null;
}

/**
 * 把某份快照设为新基线，旧基线降级为 check（由保留策略回收）。
 * 不删除旧基线：用户刚确认完变更，旧内容仍值得在差异里回看。
 */
export function promoteBaseline(db, pageId, snapshotId) {
  db.prepare("UPDATE snapshots SET kind = 'check' WHERE page_id = ? AND kind = 'baseline' AND id != ?")
    .run(Number(pageId), Number(snapshotId));
  db.prepare("UPDATE snapshots SET kind = 'baseline' WHERE id = ? AND page_id = ?")
    .run(Number(snapshotId), Number(pageId));
}

/** 概览用：按状态统计页面，避免前端自己遍历所有站点。 */
export function pageStats(db) {
  const rows = db.prepare('SELECT state, changed FROM pages').all();
  const pagesByState = { normal: 0, suspect: 0, bad: 0, unknown: 0 };
  let changed = 0;
  for (const row of rows) {
    if (pagesByState[row.state] !== undefined) pagesByState[row.state] += 1;
    if (row.changed) changed += 1;
  }
  return { pages: rows.length, pagesByState, changed };
}

export function pruneSnapshots(db, pageId, keep = 60) {
  const rows = db
    .prepare("SELECT id FROM snapshots WHERE page_id = ? AND kind = 'check' ORDER BY id DESC")
    .all(Number(pageId));
  for (const row of rows.slice(keep)) db.prepare('DELETE FROM snapshots WHERE id = ?').run(row.id);
}

export function setPageState(db, pageId, { state, changed, message = '', baselineId = undefined }) {
  if (baselineId === undefined) {
    db.prepare('UPDATE pages SET state = ?, changed = ?, last_message = ?, last_checked_at = ? WHERE id = ?')
      .run(state, changed ? 1 : 0, message, Date.now(), Number(pageId));
  } else {
    db.prepare(
      'UPDATE pages SET state = ?, changed = ?, last_message = ?, last_checked_at = ?, baseline_id = ? WHERE id = ?'
    ).run(state, changed ? 1 : 0, message, Date.now(), baselineId, Number(pageId));
  }
}
