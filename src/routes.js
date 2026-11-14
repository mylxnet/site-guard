// SPDX-License-Identifier: MIT
// Copyright (c) 2026 by Mr lin

import { readJson, ok, fail, HttpError, assertSameOrigin, setCookie, clientIp, unauthorized, conflict, notFound } from './http.js';
import {
  getSetting,
  setSetting,
  listSites,
  getSite,
  createSite,
  updateSite,
  deleteSite,
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  latestCheck,
  latestChecksForPages,
  latestSnapshot,
  getSnapshot,
  promoteBaseline,
  setPageState,
  addEvent,
  listEvents,
  countEvents,
  pageStats,
  countPages,
  lastRunAt,
  createResetToken,
  getResetToken,
  countResetTokensSince,
  consumeResetToken,
  deleteResetTokensForEmail,
  purgeResetTokens
} from './db.js';
import { diffLines } from './diff.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  sessionValid,
  destroySession,
  createLoginLimiter,
  purgeSessions,
  parseCookies,
  createResetCode,
  normalizeResetCode,
  hashResetCode,
  RESET_CODE_TTL_MS
} from './auth.js';
import { validateSite, validatePage, validatePassword, validateResetPassword, validateMailSettings, requireId, isEmailAddress, ValidationError } from './validate.js';
import { readMailSettings, saveMailSettings, publicMailSettings } from './notify.js';
import { nextRunAt, describeSchedule } from './schedule.js';

const COOKIE_NAME = 'sg_sid';
const PASSWORD_KEY = 'admin_password';

const siteJson = (site, pages, checks) => {
  const sitePages = pages.filter((page) => page.site_id === site.id);
  return {
    id: site.id,
    name: site.name,
    baseUrl: site.base_url,
    scheduleMode: site.schedule_mode,
    scheduleValue: site.schedule_value,
    scheduleLabel: describeSchedule(site),
    timezone: site.timezone,
    enabled: site.enabled,
    lastRunAt: site.last_run_at,
    nextRunAt: site.next_run_at,
    createdAt: site.created_at,
    pagesCount: sitePages.length,
    pages: sitePages.map((page) => pageJson(page, checks.get(page.id)))
  };
};

const pageJson = (page, check) => ({
  id: page.id,
  siteId: page.site_id,
  name: page.name,
  url: page.url,
  mustContain: page.mustContain,
  ignorePatterns: page.ignorePatterns,
  keywords: page.keywords,
  enabled: page.enabled,
  state: page.state,
  changed: page.changed,
  baselineId: page.baseline_id,
  lastCheckedAt: page.last_checked_at,
  lastMessage: page.last_message,
  lastAlertAt: page.last_alert_at,
  createdAt: page.created_at,
  lastCheck: check
    ? {
        verdict: check.verdict,
        changed: check.changed,
        httpCode: check.http_code,
        responseMs: check.response_ms,
        textLen: check.text_len,
        title: check.title,
        ranAt: check.ran_at,
        reasons: check.reasons
      }
    : null
});

const batchJson = (batch) => ({
  id: batch.id,
  siteId: batch.siteId,
  siteName: batch.siteName,
  trigger: batch.trigger,
  status: batch.status,
  startedAt: batch.startedAt,
  finishedAt: batch.finishedAt,
  total: batch.total,
  done: batch.done,
  progress: batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : batch.status === 'running' ? 0 : 100,
  lines: batch.lines,
  summary: batch.summary
});

const snapshotJson = (snapshot) => ({
  id: snapshot.id,
  kind: snapshot.kind,
  createdAt: snapshot.created_at,
  hash: snapshot.hash,
  textLen: Number(snapshot.meta?.textLen ?? snapshot.text.length),
  title: snapshot.meta?.title ?? '',
  httpCode: snapshot.meta?.httpCode ?? null,
  verdict: snapshot.meta?.verdict ?? null
});

const EVENT_TYPES = ['bad', 'suspect', 'unknown', 'changed', 'recovered', 'system'];

const intParam = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  // 查询参数缺失时 value 是 null，Number(null) === 0，会被误当成“用户要 0 条”。
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
};

const splitRecipients = (value) =>
  String(value ?? '')
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function createApi({ db, config, logger, scheduler, batches, checkPage = null, notifier = null }) {
  const limiter = createLoginLimiter({ windowMs: config.loginWindowMs, max: config.loginMaxFailures });
  const resetSendLimiter = createLoginLimiter({ windowMs: 5 * 60_000, max: 3 });
  const resetConfirmLimiter = createLoginLimiter({ windowMs: 10 * 60_000, max: 5 });
  purgeSessions(db);
  purgeResetTokens(db, Date.now());

  const sessionToken = (req) => parseCookies(req.headers.cookie ?? '')[COOKIE_NAME];

  const requireSession = (req) => {
    const token = sessionToken(req);
    if (!sessionValid(db, token)) throw unauthorized();
    return token;
  };

  const changeRunPlan = (site, data) => {
    // nextRunAt 吃的是库里的 snake_case 行，这里显式转换，避免字段名错位后算错时间。
    const next = nextRunAt(
      {
        schedule_mode: data.scheduleMode,
        schedule_value: data.scheduleValue,
        timezone: data.timezone,
        last_run_at: site.last_run_at
      },
      Date.now()
    );
    return { ...data, nextRunAt: Math.max(next, Date.now()) };
  };

  /* ---------------- 公开接口 ---------------- */

  const health = () => {
    const row = db.prepare('SELECT 1 AS ok').get();
    return { ok: row?.ok === 1, version: config.version, db: 'ok', lastRunAt: lastRunAt(db) };
  };

  const state = ({ req }) => ({
    needSetup: !getSetting(db, PASSWORD_KEY),
    loggedIn: sessionValid(db, sessionToken(req)),
    version: config.version
  });

  const setup = async ({ req, res }) => {
    if (getSetting(db, PASSWORD_KEY)) throw conflict('已经初始化过了');
    const body = await readJson(req, 8 * 1024);
    const password = validatePassword(body.password);
    setSetting(db, PASSWORD_KEY, hashPassword(password));
    const session = createSession(db);
    setCookie(res, COOKIE_NAME, session.token, { maxAge: config.sessionTtlMs / 1000, expires: session.expiresAt });
    logger.info('auth.setup', { ip: clientIp(req) });
    return { loggedIn: true };
  };

  const login = async ({ req, res }) => {
    const ip = clientIp(req);
    if (limiter.blocked(ip)) throw new HttpError(429, 'RATE_LIMITED', '登录失败次数过多，请 5 分钟后再试');

    const body = await readJson(req, 8 * 1024);
    const stored = getSetting(db, PASSWORD_KEY);
    if (!stored) throw conflict('尚未设置密码，请先完成初始化');

    const password = String(body.password ?? '');
    if (!password || !verifyPassword(password, stored)) {
      limiter.fail(ip);
      logger.warn('auth.login.fail', { ip });
      throw unauthorized('密码不正确');
    }

    limiter.reset(ip);
    const session = createSession(db);
    setCookie(res, COOKIE_NAME, session.token, { maxAge: config.sessionTtlMs / 1000, expires: session.expiresAt });
    logger.info('auth.login', { ip });
    return { loggedIn: true };
  };

  const logout = ({ req, res }) => {
    destroySession(db, sessionToken(req));
    setCookie(res, COOKIE_NAME, '', { maxAge: 0 });
    return { loggedIn: false };
  };

  /**
   * 申请重置码：先确认邮箱等于「邮件收件人」的第一个地址，再复用告警 SMTP 发信。
   * 邮件里只有 20 位重置码，不含链接，内网地址与飞牛应用前缀都不影响使用。
   */
  const resetRequest = async ({ req }) => {
    const ip = clientIp(req);
    if (resetSendLimiter.blocked(ip)) {
      throw new HttpError(429, 'RATE_LIMITED', '申请过于频繁，请 5 分钟后再试');
    }

    const body = await readJson(req, 8 * 1024);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!isEmailAddress(email)) throw new ValidationError({ email: '请填写正确的邮箱地址' });
    if (!getSetting(db, PASSWORD_KEY)) throw conflict('尚未设置密码，请先完成初始化');

    const settings = readMailSettings(db);
    const recipients = splitRecipients(settings.to).map((item) => item.toLowerCase());
    if (!notifier || !settings.enabled || !settings.host || !settings.from || recipients.length === 0) {
      throw new HttpError(409, 'MAIL_UNAVAILABLE', '未启用邮件通知，或收件人为空');
    }
    if (email !== recipients[0]) {
      resetSendLimiter.fail(ip);
      logger.warn('auth.reset.email_mismatch', { ip });
      throw new HttpError(403, 'EMAIL_NOT_ALLOWED', '该邮箱与配置的邮件收件人不一致', {
        email: '该邮箱与配置的邮件收件人不一致'
      });
    }

    // 全局兜底：每小时最多 10 封，避免被反复触发刷爆邮箱。
    if (countResetTokensSince(db, Date.now() - 60 * 60_000) >= 10) {
      throw new HttpError(429, 'RATE_LIMITED', '申请过于频繁，请稍后再试');
    }

    resetSendLimiter.fail(ip);
    const code = createResetCode();
    const now = Date.now();
    const expiresAt = now + RESET_CODE_TTL_MS;
    createResetToken(db, { tokenHash: hashResetCode(code), email, createdAt: now, expiresAt });

    await notifier.sendPasswordReset({ email, code, expiresMinutes: RESET_CODE_TTL_MS / 60_000 });
    logger.info('auth.reset.sent', { ip });
    return { sent: true, email, expiresAt };
  };

  const resetConfirm = async ({ req }) => {
    const ip = clientIp(req);
    if (resetConfirmLimiter.blocked(ip)) {
      throw new HttpError(429, 'RATE_LIMITED', '尝试次数过多，请 10 分钟后再试');
    }

    const body = await readJson(req, 8 * 1024);
    // 密码与重置码一起校验：码对了但密码不合格时，用户只需改密码，不必重新收信。
    const password = validateResetPassword(body.password);
    if (!getSetting(db, PASSWORD_KEY)) throw conflict('尚未设置密码，请先完成初始化');

    const fail = () => {
      resetConfirmLimiter.fail(ip);
      const left = resetConfirmLimiter.remaining(ip);
      logger.warn('auth.reset.fail', { ip });
      return new HttpError(400, 'INVALID_RESET_CODE', '重置码不正确或已过期', {
        code: `重置码不正确，还可尝试 ${left} 次`
      });
    };

    const code = normalizeResetCode(body.code);
    if (code.length !== 20) throw fail();

    const row = getResetToken(db, hashResetCode(code));
    const now = Date.now();
    if (!row || row.used_at || row.expires_at < now) throw fail();
    if (!consumeResetToken(db, row.token_hash, now)) throw fail();

    setSetting(db, PASSWORD_KEY, hashPassword(password));
    deleteResetTokensForEmail(db, row.email);
    db.prepare('DELETE FROM sessions').run();
    resetConfirmLimiter.reset(ip);
    logger.info('auth.reset.confirmed', { ip });
    return { reset: true };
  };

  /* ---------------- 站点 ---------------- */

  const sitesIndex = () => {
    const pages = listPages(db);
    const checks = latestChecksForPages(db, pages.map((page) => page.id));
    return listSites(db).map((site) => siteJson(site, pages, checks));
  };

  const sitesCreate = async ({ req }) => {
    const body = await readJson(req);
    const data = validateSite(body, { defaultTimezone: config.timezone });
    // 新站点立刻纳入下一轮：用户刚添加就想看到基线，等一个周期不合理。
    const site = createSite(db, { ...data, nextRunAt: Date.now() });
    logger.info('site.create', { site: site.id });
    return siteJson(site, [], new Map());
  };

  const sitesUpdate = async ({ req, params }) => {
    const id = requireId(params.id);
    const site = getSite(db, id);
    if (!site) throw notFound('站点不存在');

    const body = await readJson(req);
    const merged = {
      name: body.name ?? site.name,
      baseUrl: body.baseUrl ?? site.base_url,
      scheduleMode: body.scheduleMode ?? site.schedule_mode,
      scheduleValue: body.scheduleValue ?? site.schedule_value,
      timezone: body.timezone ?? site.timezone,
      enabled: body.enabled ?? site.enabled
    };
    const data = validateSite(merged, { defaultTimezone: config.timezone });
    const updated = updateSite(db, id, changeRunPlan(site, data));
    logger.info('site.update', { site: id });
    const pages = listPages(db);
    return siteJson(updated, pages, latestChecksForPages(db, pages.map((page) => page.id)));
  };

  const sitesDestroy = ({ params }) => {
    const id = requireId(params.id);
    if (!getSite(db, id)) throw notFound('站点不存在');
    deleteSite(db, id);
    logger.info('site.delete', { site: id });
    return { removed: true };
  };

  const sitesRun = ({ params }) => {
    const batch = scheduler.triggerSite(requireId(params.id), 'manual');
    return { batchId: batch.id };
  };

  /* ---------------- 页面 ---------------- */

  const pagesCreate = async ({ req, params }) => {
    const siteId = requireId(params.id);
    const site = getSite(db, siteId);
    if (!site) throw notFound('站点不存在');
    if (countPages(db, siteId) >= config.maxPagesPerSite) {
      throw conflict(`单个站点最多 ${config.maxPagesPerSite} 个页面`);
    }

    const data = validatePage(await readJson(req));
    const page = createPage(db, siteId, data);
    logger.info('page.create', { site: siteId, page: page.id });
    return pageJson(page, null);
  };

  const pagesUpdate = async ({ req, params }) => {
    const id = requireId(params.id);
    const page = getPage(db, id);
    if (!page) throw notFound('页面不存在');

    const body = await readJson(req);
    const merged = {
      name: body.name ?? page.name,
      url: body.url ?? page.url,
      mustContain: body.mustContain ?? page.mustContain,
      ignorePatterns: body.ignorePatterns ?? page.ignorePatterns,
      keywords: body.keywords ?? page.keywords,
      enabled: body.enabled ?? page.enabled
    };
    const data = validatePage(merged);
    const updated = updatePage(db, id, data);
    logger.info('page.update', { page: id });
    return pageJson(updated, null);
  };

  const pagesDestroy = ({ params }) => {
    const id = requireId(params.id);
    if (!getPage(db, id)) throw notFound('页面不存在');
    deletePage(db, id);
    logger.info('page.delete', { page: id });
    return { removed: true };
  };

  const pagesRun = async ({ params }) => {
    const id = requireId(params.id);
    const page = getPage(db, id);
    if (!page) throw notFound('页面不存在');
    if (!page.enabled) throw conflict('该页面已停用，请先在设置里启用');
    if (!checkPage) throw new HttpError(503, 'ENGINE_MISSING', '检测引擎未启用');
    if (scheduler.isRunning(page.site_id)) throw conflict('该站点正在巡检中，请等这一轮结束');

    const result = await checkPage(page, { site: getSite(db, page.site_id), trigger: 'manual' });
    return { result, page: pageJson(getPage(db, id), latestCheck(db, id)) };
  };

  /* ---------------- 判定详情 / 差异 / 基线 ---------------- */

  const pagesDetail = ({ params }) => {
    const id = requireId(params.id);
    const page = getPage(db, id);
    if (!page) throw notFound('页面不存在');

    const site = getSite(db, page.site_id);
    const baseline = page.baseline_id ? getSnapshot(db, page.baseline_id) : null;
    const latest = latestSnapshot(db, id);
    const diffSummary = baseline && latest && baseline.id !== latest.id
      ? (() => {
          const diff = diffLines(baseline.text, latest.text);
          return { addedCount: diff.addedCount, removedCount: diff.removedCount };
        })()
      : null;

    return {
      page: pageJson(page, latestCheck(db, id)),
      site: site ? { id: site.id, name: site.name, baseUrl: site.base_url, timezone: site.timezone } : null,
      baseline: baseline ? snapshotJson(baseline) : null,
      latestSnapshot: latest ? snapshotJson(latest) : null,
      diffSummary
    };
  };

  const pagesDiff = ({ params }) => {
    const id = requireId(params.id);
    const page = getPage(db, id);
    if (!page) throw notFound('页面不存在');

    const baseline = page.baseline_id ? getSnapshot(db, page.baseline_id) : null;
    if (!baseline) throw conflict('该页面还没有基线，请先巡检一次');

    const latest = latestSnapshot(db, id);
    if (!latest) throw conflict('该页面还没有快照');

    const diff = diffLines(baseline.text, latest.text);
    return {
      baseline: snapshotJson(baseline),
      latest: snapshotJson(latest),
      ...diff
    };
  };

  const pagesAccept = ({ params }) => {
    const id = requireId(params.id);
    const page = getPage(db, id);
    if (!page) throw notFound('页面不存在');

    const latest = latestSnapshot(db, id);
    if (!latest) throw conflict('还没有可用的快照，请先巡检一次');
    // 用错误页/反爬页当基线，会把“异常”变成“正常”，这里必须拒绝；
    // suspect（慢响应、正文偏少）的内容本身可信，允许用户确认。
    const latestVerdict = latest.meta?.verdict;
    if (latestVerdict && latestVerdict !== 'normal' && latestVerdict !== 'suspect') {
      throw conflict('最近一次抓取判定为异常或无法确认，不能设为基线');
    }

    promoteBaseline(db, id, latest.id);
    setPageState(db, id, {
      state: 'normal',
      changed: false,
      message: '已确认变更，作为新基线',
      baselineId: latest.id
    });
    addEvent(db, {
      siteId: page.site_id,
      pageId: id,
      type: 'system',
      message: `手动确认变更，基线更新为快照 #${latest.id}`
    });
    logger.info('page.accept', { page: id, snapshot: latest.id });

    return { page: pageJson(getPage(db, id), latestCheck(db, id)) };
  };

  /* ---------------- 概览 ---------------- */

  const overview = () => {
    const sites = listSites(db);
    const pages = listPages(db);
    const checks = latestChecksForPages(db, pages.map((page) => page.id));
    const stats = pageStats(db);
    const siteNames = new Map(sites.map((site) => [site.id, site.name]));

    const needsAttention = pages
      .filter((page) => page.state !== 'normal' || page.changed)
      .sort((a, b) => Number(b.last_checked_at ?? 0) - Number(a.last_checked_at ?? 0))
      .slice(0, 10)
      .map((page) => ({ ...pageJson(page, checks.get(page.id)), siteName: siteNames.get(page.site_id) ?? '' }));

    const upcoming = sites
      .filter((site) => site.enabled && site.next_run_at)
      .map((site) => Number(site.next_run_at));

    return {
      sites: sites.length,
      enabledSites: sites.filter((site) => site.enabled).length,
      pages: stats.pages,
      pagesByState: stats.pagesByState,
      changed: stats.changed,
      lastRunAt: lastRunAt(db),
      nextRunAt: upcoming.length ? Math.min(...upcoming) : null,
      needsAttention,
      recentEvents: listEvents(db, { limit: 10 })
    };
  };

  /* ---------------- 事件流 ---------------- */

  const eventsIndex = ({ url }) => {
    const type = url.searchParams.get('type');
    if (type && !EVENT_TYPES.includes(type)) {
      throw new ValidationError({ type: `事件类型只能是 ${EVENT_TYPES.join(' / ')}` });
    }
    const siteId = url.searchParams.get('siteId');
    if (siteId && !/^\d+$/.test(siteId)) throw new ValidationError({ siteId: '站点 ID 不合法' });

    const limit = intParam(url.searchParams.get('limit'), 50, { min: 1, max: 200 });
    const offset = intParam(url.searchParams.get('offset'), 0, { min: 0, max: 1_000_000 });
    const filter = { type: type || null, siteId: siteId ? Number(siteId) : null };

    return {
      items: listEvents(db, { ...filter, limit, offset }),
      total: countEvents(db, filter),
      limit,
      offset
    };
  };

  /* ---------------- 设置 ---------------- */

  const settingsShow = () => publicMailSettings(readMailSettings(db));

  const settingsUpdate = async ({ req }) => {
    const body = await readJson(req);
    const data = validateMailSettings(body, { existing: readMailSettings(db) });
    const saved = saveMailSettings(db, data);
    logger.info('settings.mail.save', { enabled: saved.enabled, host: saved.host, secure: saved.secure });
    return publicMailSettings(saved);
  };

  const settingsTestMail = async ({ req }) => {
    if (!notifier) throw new HttpError(503, 'MAIL_DISABLED', '邮件模块未启用');
    const body = await readJson(req, 8 * 1024);

    let to = null;
    if (body.to !== undefined && body.to !== null && String(body.to).trim() !== '') {
      const list = splitRecipients(body.to);
      if (!list.length) throw new ValidationError({ to: '收件人不能为空' });
      const bad = list.find((item) => !isEmailAddress(item));
      if (bad) throw new ValidationError({ to: `邮箱格式不对：「${bad}」` });
      to = list.join(',');
    }

    return notifier.sendTest({ to });
  };

  /* ---------------- 批次 ---------------- */

  const batchesShow = ({ params }) => {
    const batch = batches.get(params.id);
    if (!batch) throw notFound('批次不存在或已过期');
    return batchJson(batch);
  };

  const routes = [
    { method: 'GET', pattern: /^\/api\/health$/, public: true, handler: health },
    { method: 'GET', pattern: /^\/api\/state$/, public: true, handler: state },
    { method: 'POST', pattern: /^\/api\/setup$/, public: true, handler: setup },
    { method: 'POST', pattern: /^\/api\/login$/, public: true, handler: login },
    { method: 'POST', pattern: /^\/api\/auth\/reset\/request$/, public: true, handler: resetRequest },
    { method: 'POST', pattern: /^\/api\/auth\/reset\/confirm$/, public: true, handler: resetConfirm },
    { method: 'POST', pattern: /^\/api\/logout$/, handler: logout },
    { method: 'GET', pattern: /^\/api\/sites$/, handler: sitesIndex },
    { method: 'POST', pattern: /^\/api\/sites$/, handler: sitesCreate },
    { method: 'PATCH', pattern: /^\/api\/sites\/(?<id>\d+)$/, handler: sitesUpdate },
    { method: 'DELETE', pattern: /^\/api\/sites\/(?<id>\d+)$/, handler: sitesDestroy },
    { method: 'POST', pattern: /^\/api\/sites\/(?<id>\d+)\/run$/, handler: sitesRun },
    { method: 'POST', pattern: /^\/api\/sites\/(?<id>\d+)\/pages$/, handler: pagesCreate },
    { method: 'PATCH', pattern: /^\/api\/pages\/(?<id>\d+)$/, handler: pagesUpdate },
    { method: 'DELETE', pattern: /^\/api\/pages\/(?<id>\d+)$/, handler: pagesDestroy },
    { method: 'POST', pattern: /^\/api\/pages\/(?<id>\d+)\/run$/, handler: pagesRun },
    { method: 'GET', pattern: /^\/api\/pages\/(?<id>\d+)\/detail$/, handler: pagesDetail },
    { method: 'GET', pattern: /^\/api\/pages\/(?<id>\d+)\/diff$/, handler: pagesDiff },
    { method: 'POST', pattern: /^\/api\/pages\/(?<id>\d+)\/accept$/, handler: pagesAccept },
    { method: 'GET', pattern: /^\/api\/overview$/, handler: overview },
    { method: 'GET', pattern: /^\/api\/events$/, handler: eventsIndex },
    { method: 'GET', pattern: /^\/api\/settings$/, handler: settingsShow },
    { method: 'PUT', pattern: /^\/api\/settings$/, handler: settingsUpdate },
    { method: 'POST', pattern: /^\/api\/settings\/test-mail$/, handler: settingsTestMail },
    { method: 'GET', pattern: /^\/api\/batches\/(?<id>[\w-]+)$/, handler: batchesShow }
  ];

  const match = (method, pathname) => {
    for (const route of routes) {
      if (route.method !== method) continue;
      const found = route.pattern.exec(pathname);
      if (found) return { route, params: found.groups ?? {} };
    }
    return null;
  };

  return {
    /** 返回 true 表示这个请求由 API 层处理完毕。 */
    async handle(req, res, url) {
      const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
      if (!pathname.startsWith('/api/')) return false;

      const found = match(req.method, pathname);
      if (!found) {
        fail(res, notFound('接口不存在'));
        return true;
      }

      try {
        // ALLOWED_ORIGINS 用于反代/网关改写 Host 的场景（飞牛统一网关），默认只认 Host 本身。
        if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req, { allowHosts: config.allowedOrigins });
        if (!found.route.public) requireSession(req);

        const data = await found.route.handler({
          req,
          res,
          params: found.params,
          url,
          db,
          config,
          logger,
          scheduler,
          batches,
          checkPage,
          notifier
        });
        ok(res, data ?? null);
      } catch (err) {
        if (err instanceof HttpError || err.code === 'VALIDATION_FAILED') {
          fail(res, err);
        } else {
          logger.error('api.error', {
            method: req.method,
            path: pathname,
            message: err.message,
            stack: err.stack
          });
          fail(res, new HttpError(500, 'INTERNAL', '服务器内部错误'));
        }
      }

      return true;
    }
  };
}
