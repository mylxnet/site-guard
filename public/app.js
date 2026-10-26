/* 网站哨兵 · 面板前端 · v0.8.3
 * 对接 /api/*：初始化/登录、站点与页面 CRUD、真实巡检进度、判定详情、差异与基线、事件流、邮件设置。
 */

const VERSION = 'v0.8.3';

/* 同源 API 基址：直连（/）与飞牛统一网关（/app/<appname>/）都成立。 */
const API_BASE = (() => {
  const matched = location.pathname.match(/^\/app\/([^/]+)/);
  return matched ? `/app/${matched[1]}/api` : '/api';
})();

const VERDICT = {
  normal: { label: '正常', cls: 'ok', rank: 0 },
  suspect: { label: '可疑', cls: 'warn', rank: 2 },
  bad: { label: '异常', cls: 'bad', rank: 3 },
  unknown: { label: '无法确认', cls: 'unknown', rank: 1 }
};

const EVENT_TYPE = {
  bad: { label: '异常', cls: 'bad' },
  suspect: { label: '可疑', cls: 'warn' },
  unknown: { label: '无法确认', cls: 'unknown' },
  changed: { label: '内容变更', cls: 'warn' },
  recovered: { label: '已恢复', cls: 'ok' },
  system: { label: '系统', cls: 'plain' }
};

const state = {
  tab: 'overview',
  monitorFilter: 'all',
  eventFilter: 'all',
  sites: [],
  events: [],
  overview: null,
  runningSite: null,
  version: VERSION
};

let pollTimer = null;
let seenLines = 0;

/* ============ 基础工具 ============ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const pad2 = (n) => String(n).padStart(2, '0');

function fmtWhen(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hm}`;
}

function fmtFull(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nowHM() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  $('#toastWrap').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
    setTimeout(() => el.remove(), 220);
  }, 2800);
}

/** 统一请求：解开 { ok, data }，把 error.fields 挂到 Error 上。 */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      // 网关会改写 Host，Origin 与 Host 对不上；这个头用来表明“同源页面发出的请求”。
      'x-siteguard-client': '1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin'
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* 非 JSON 响应 */ }

  if (res.status === 401) {
    showAuth('login', '登录状态已过期，请重新登录。');
  }

  if (!res.ok || !payload || payload.ok !== true) {
    const info = payload?.error ?? {};
    const err = new Error(info.message || `请求失败（HTTP ${res.status}）`);
    err.code = info.code || '';
    err.fields = info.fields || {};
    throw err;
  }

  return payload.data;
}

function readErrorMessage(err) {
  return err?.message || '操作失败，请稍后重试';
}

/* ============ 登录 / 初始化 ============ */

function showAuth(mode, message = '') {
  closeModal();
  document.body.classList.add('is-locked');
  $('#authRoot').hidden = false;
  $('#authError').textContent = message;
  $('#setupForm').hidden = mode !== 'setup';
  $('#loginForm').hidden = mode !== 'login';
  $('#authLead').textContent = mode === 'setup'
    ? '首次使用，请先设置管理密码（至少 8 位）。'
    : '请输入管理密码进入面板。';

  setTimeout(() => {
    const form = mode === 'setup' ? $('#setupForm') : $('#loginForm');
    form.querySelector('input')?.focus();
  }, 30);
}

function hideAuth() {
  $('#authRoot').hidden = true;
  document.body.classList.remove('is-locked');
}

function setAuthError(err, form) {
  const fields = err?.fields || {};
  const keys = Object.keys(fields);
  if (keys.length) {
    clearFieldErrors(form);
    for (const key of keys) setFieldError(form, key, fields[key]);
  }
  $('#authError').textContent = keys.length ? '' : readErrorMessage(err);
}

function applyVersion(version) {
  state.version = version ? `v${version}` : VERSION;
  $('#footerVersion').textContent = state.version;
  $('#settingsVersion').textContent = state.version;
  $('#authVersion').textContent = state.version;
}

async function boot() {
  try {
    const info = await api('/state');
    applyVersion(info.version);
    if (info.needSetup) {
      showAuth('setup');
      return;
    }
    if (!info.loggedIn) {
      showAuth('login');
      return;
    }
    hideAuth();
    await enterApp();
  } catch (err) {
    showAuth('login', `无法连接服务：${readErrorMessage(err)}`);
  }
}

async function enterApp() {
  try {
    await loadAll();
  } catch (err) {
    toast(readErrorMessage(err), 'err');
  }
  void loadSettings();
}

async function submitSetup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);

  const password = form.elements.password.value;
  const confirm = form.elements.confirm.value;
  let ok = true;

  if (password.length < 8) { setFieldError(form, 'password', '密码至少 8 位'); ok = false; }
  if (!confirm) { setFieldError(form, 'confirm', '请再输入一次密码'); ok = false; }
  else if (confirm !== password) { setFieldError(form, 'confirm', '两次输入的密码不一致'); ok = false; }
  if (!ok) return;

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '初始化中…';
  try {
    await api('/setup', { method: 'POST', body: { password } });
    form.reset();
    $('#authError').textContent = '';
    hideAuth();
    await enterApp();
    toast('初始化完成，欢迎使用网站哨兵', 'ok');
  } catch (err) {
    setAuthError(err, form);
  } finally {
    btn.disabled = false;
    btn.textContent = '完成初始化';
  }
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  $('#authError').textContent = '';

  const password = form.elements.password.value;
  if (!password) {
    setFieldError(form, 'password', '请输入管理密码');
    return;
  }

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '登录中…';
  try {
    await api('/login', { method: 'POST', body: { password } });
    form.reset();
    hideAuth();
    await enterApp();
  } catch (err) {
    setAuthError(err, form);
  } finally {
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch { /* 已经失效也当做退出 */ }
  state.sites = [];
  state.events = [];
  state.overview = null;
  state.runningSite = null;
  clearTimeout(pollTimer);
  renderAll();
  showAuth('login', '已退出登录。');
}

/* ============ 数据加载 ============ */

async function loadAll() {
  const [sites, overview, events] = await Promise.all([
    api('/sites'),
    api('/overview'),
    api('/events?limit=200')
  ]);
  state.sites = Array.isArray(sites) ? sites : [];
  state.overview = overview ?? null;
  state.events = Array.isArray(events?.items) ? events.items : [];
  renderAll();
}

/* ============ 页面数据换算 ============ */

function allPages() {
  return state.sites.flatMap((site) => site.pages.map((page) => ({ site, page })));
}

function isChecked(page) {
  return Boolean(page.lastCheck || page.lastCheckedAt);
}

function verdictOf(page) {
  if (!isChecked(page)) return { label: '未巡检', cls: 'plain', rank: -1 };
  return VERDICT[page.state] ?? VERDICT.unknown;
}

function reasonText(page) {
  const reasons = page.lastCheck?.reasons ?? [];
  const hit = reasons.find((item) => item.hit) ?? reasons[0];
  return hit?.text || page.lastMessage || '—';
}

function siteVerdict(site) {
  const checked = site.pages.filter(isChecked);
  if (!checked.length) return 'none';
  const rank = Math.max(...checked.map((page) => verdictOf(page).rank));
  return Object.keys(VERDICT).find((key) => VERDICT[key].rank === rank) ?? 'normal';
}

function splitList(value) {
  return String(value ?? '').split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function scheduleText(site) {
  if (site.scheduleLabel) return site.scheduleLabel;
  if (site.scheduleMode === 'interval') return `每 ${site.scheduleValue} 小时`;
  return `每天 ${site.scheduleValue}`;
}

function nextRunOf() {
  if (state.overview?.nextRunAt) return state.overview.nextRunAt;
  const list = state.sites.map((site) => Number(site.nextRunAt ?? 0)).filter((ts) => ts > 0);
  return list.length ? Math.min(...list) : null;
}

/* ============ 概览 ============ */

function renderHealth() {
  const pill = $('#healthPill');
  const text = $('#healthText');
  const pages = allPages().map((item) => item.page);
  const bad = pages.filter((page) => isChecked(page) && page.state === 'bad').length;
  const soft = pages.filter((page) => isChecked(page) && (page.state === 'suspect' || page.state === 'unknown')).length;
  const pending = pages.filter((page) => !isChecked(page)).length;

  pill.className = 'health-pill';
  if (!state.sites.length) {
    pill.classList.add('is-warn');
    text.textContent = '尚未配置站点';
  } else if (bad) {
    pill.classList.add('is-bad');
    text.textContent = `${bad} 个页面异常待处理`;
  } else if (soft) {
    pill.classList.add('is-warn');
    text.textContent = `${soft} 个页面待确认`;
  } else if (pending) {
    pill.classList.add('is-warn');
    text.textContent = `${pending} 个页面待首次巡检`;
  } else {
    text.textContent = '运行正常';
  }

  const next = nextRunOf();
  $('#nextRun').textContent = next ? fmtWhen(next) : '—';
}

function renderStats() {
  const pages = allPages().map((item) => item.page);
  const bad = pages.filter((page) => isChecked(page) && page.state === 'bad').length;
  const soft = pages.filter((page) => isChecked(page) && (page.state === 'suspect' || page.state === 'unknown')).length;
  const changed = pages.filter((page) => page.changed).length;

  const cards = [
    { label: '站点', value: state.sites.length, sub: `共 ${pages.length} 个页面`, cls: '' },
    { label: '异常', value: bad, sub: bad ? '需要尽快处理' : '没有异常页面', cls: bad ? 'is-bad' : 'is-ok' },
    { label: '可疑 / 待确认', value: soft, sub: soft ? '需要人工看一眼' : '无待确认项', cls: soft ? 'is-warn' : '' },
    { label: '内容变更', value: changed, sub: changed ? '与基线不一致' : '与基线一致', cls: changed ? 'is-warn' : '' }
  ];

  $('#statGrid').innerHTML = cards.map((card) => `
    <div class="stat ${card.cls}">
      <span class="label">${card.label}</span>
      <span class="value">${card.value}</span>
      <span class="sub">${escapeHtml(card.sub)}</span>
    </div>`).join('');
}

function renderAttention() {
  const list = $('#attentionList');
  const items = allPages()
    .filter(({ page }) => isChecked(page) && (page.state !== 'normal' || page.changed))
    .sort((a, b) => {
      const diff = verdictOf(b.page).rank - verdictOf(a.page).rank;
      return diff !== 0 ? diff : Number(b.page.changed) - Number(a.page.changed);
    });

  $('#attentionCount').textContent = items.length ? `${items.length} 项` : '';

  if (!items.length) {
    list.innerHTML = `<p class="empty-line">${state.sites.length ? '所有已巡检页面均正常，无需处理。' : '还没有站点，去「监测」页添加第一个。'}</p>`;
    return;
  }

  list.innerHTML = items.map(({ site, page }) => {
    const verdict = verdictOf(page);
    const isChangedOnly = page.state === 'normal' && page.changed;
    return `
      <div class="attention-item ${isChangedOnly ? 'warn' : verdict.cls}">
        <div class="ai-main">
          <div class="ai-title">
            <span>${escapeHtml(page.name)}</span>
            <span class="badge ${verdict.cls}">${verdict.label}</span>
            ${page.changed ? '<span class="badge info">内容变更</span>' : ''}
            <span class="site-tag">${escapeHtml(site.name)}</span>
          </div>
          <div class="ai-msg">${escapeHtml(reasonText(page))}</div>
          <div class="ai-actions">
            <button class="btn sm ghost" data-detail="${page.id}">判定详情</button>
            ${page.changed ? `<button class="btn sm ghost" data-diff="${page.id}">查看差异</button>` : ''}
            <button class="btn sm ghost" data-check="${page.id}">立即巡检</button>
            ${page.changed ? `<button class="btn sm primary" data-accept="${page.id}">设为基线</button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderEventFeed() {
  const feed = $('#eventFeed');
  const events = state.overview?.recentEvents ?? [];
  if (!events.length) {
    feed.innerHTML = '<li><span class="m">暂无事件记录。</span></li>';
    return;
  }
  feed.innerHTML = events.slice(0, 7).map((event) => {
    const subject = event.page_name || event.site_name || '系统';
    return `
      <li>
        <span class="t">${escapeHtml(fmtWhen(event.created_at))}</span>
        <span class="m"><b>${escapeHtml(subject)}</b> · ${escapeHtml(event.message)}</span>
      </li>`;
  }).join('');
}

/* ============ 监测（站点 / 页面） ============ */

function renderSites() {
  const list = $('#siteList');
  const empty = $('#monitorEmpty');
  const pages = allPages().map((item) => item.page);
  const bad = pages.filter((page) => isChecked(page) && page.state === 'bad').length;

  $('#monitorSummary').textContent = state.sites.length
    ? `${state.sites.length} 个站点 · ${pages.length} 个页面 · ${bad} 个异常`
    : '尚未添加站点';

  if (!state.sites.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  let sites = state.sites;
  if (state.monitorFilter === 'issue') {
    sites = sites.filter((site) => site.pages.some((page) => isChecked(page)
      && (page.state === 'bad' || page.state === 'suspect' || page.state === 'unknown')));
  } else if (state.monitorFilter === 'changed') {
    sites = sites.filter((site) => site.pages.some((page) => page.changed));
  } else if (state.monitorFilter === 'normal') {
    sites = sites.filter((site) => {
      const checked = site.pages.filter(isChecked);
      return checked.length > 0 && checked.every((page) => page.state === 'normal') && !site.pages.some((page) => page.changed);
    });
  }

  if (!sites.length) {
    list.innerHTML = '<p class="empty-line">当前筛选下没有站点。</p>';
    return;
  }

  list.innerHTML = sites.map((site) => {
    const verdictKey = siteVerdict(site);
    const checked = site.pages.filter(isChecked);
    const badCount = checked.filter((page) => page.state === 'bad').length;
    const softCount = checked.filter((page) => page.state === 'suspect' || page.state === 'unknown').length;
    const changedCount = site.pages.filter((page) => page.changed).length;
    const running = state.runningSite === site.id;

    const rows = site.pages.length
      ? site.pages.map((page) => {
          const verdict = verdictOf(page);
          const reason = reasonText(page);
          const flagged = isChecked(page) && (page.state !== 'normal' || page.changed);
          return `
            <tr class="${flagged ? 'is-flag' : ''}">
              <td>
                <span class="p-name">${escapeHtml(page.name)}</span>
                <span class="p-url" title="${escapeHtml(page.url)}">${escapeHtml(page.url)}</span>
              </td>
              <td>
                <span class="verdict ${verdict.cls}"><span class="vd"></span>${verdict.label}</span>
                ${page.changed ? '<span class="badge info" style="margin-left:6px">变更</span>' : ''}
              </td>
              <td class="p-time">${escapeHtml(fmtWhen(page.lastCheckedAt))}</td>
              <td class="p-reason" title="${escapeHtml(reason)}">${escapeHtml(reason)}</td>
              <td class="p-actions">
                <button class="btn sm ghost" data-detail="${page.id}">详情</button>
                <button class="btn sm ghost" data-diff="${page.id}" ${page.changed ? '' : 'disabled'}>差异</button>
                <button class="btn sm ghost" data-page-edit="${page.id}">编辑</button>
                <button class="btn sm danger" data-page-delete="${page.id}">删除</button>
              </td>
            </tr>`;
        }).join('')
      : `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:18px">
           还没有页面，<button class="link-btn" data-page-add="${site.id}">添加第一个页面</button>
         </td></tr>`;

    const badges = [];
    if (!site.enabled) badges.push('<span class="badge plain">已停用</span>');
    if (!site.pages.length) badges.push('<span class="badge plain">待添加页面</span>');
    else if (!checked.length) badges.push('<span class="badge plain">待首次巡检</span>');
    if (badCount) badges.push(`<span class="badge bad">${badCount} 异常</span>`);
    if (softCount) badges.push(`<span class="badge warn">${softCount} 待确认</span>`);
    if (changedCount) badges.push(`<span class="badge info">${changedCount} 变更</span>`);
    if (checked.length && !badCount && !softCount && !changedCount) badges.push('<span class="badge ok">全部正常</span>');

    return `
      <article class="site is-${verdictKey} ${running ? 'is-running' : ''}" data-site="${site.id}">
        <div class="site-head">
          <div>
            <div class="site-title">
              <span class="site-name">${escapeHtml(site.name)}</span>
              ${badges.join('')}
            </div>
            <div class="site-meta">
              <span class="site-url">${escapeHtml(site.baseUrl)}</span>
              <span class="schedule-chip">${escapeHtml(scheduleText(site))}</span>
              <span class="schedule-chip">下轮 <span class="sep">·</span> ${escapeHtml(fmtWhen(site.nextRunAt))}</span>
              <span class="schedule-chip">上次 <span class="sep">·</span> ${escapeHtml(fmtWhen(site.lastRunAt))}</span>
            </div>
          </div>
          <div class="site-actions">
            <button class="btn sm primary" data-site-check="${site.id}" ${running ? 'disabled' : ''}>${running ? '巡检中…' : '立即巡检'}</button>
            <button class="btn sm ghost" data-page-add="${site.id}">＋ 页面</button>
            <button class="btn sm ghost" data-site-edit="${site.id}">编辑</button>
            <button class="btn sm danger" data-site-delete="${site.id}">删除</button>
          </div>
        </div>
        <div class="page-table-wrap">
          <table class="page-table">
            <colgroup>
              <col style="width:25%">
              <col style="width:150px">
              <col style="width:88px">
              <col>
              <col style="width:272px">
            </colgroup>
            <thead>
              <tr><th>页面</th><th>判定</th><th>上次巡检</th><th>判定依据</th><th style="text-align:right">操作</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </article>`;
  }).join('');
}

/* ============ 事件 ============ */

function renderEvents() {
  const body = $('#eventBody');
  const empty = $('#eventEmpty');
  const rows = state.events.filter((event) => state.eventFilter === 'all' || event.type === state.eventFilter);

  if (!rows.length) {
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  body.innerHTML = rows.map((event) => {
    const type = EVENT_TYPE[event.type] ?? EVENT_TYPE.system;
    const subject = event.page_name || event.site_name || '系统';
    const site = event.page_name ? event.site_name : '';
    return `
      <tr>
        <td class="time">${escapeHtml(fmtWhen(event.created_at))}</td>
        <td class="subject">${escapeHtml(subject)}${site ? `<span class="site-tag">${escapeHtml(site)}</span>` : ''}</td>
        <td><span class="badge ${type.cls}">${type.label}</span></td>
        <td class="detail" title="${escapeHtml(event.message)}">${escapeHtml(event.message)}</td>
        <td>${event.notified ? '<span class="badge info">已发送</span>' : '<span class="muted">—</span>'}</td>
      </tr>`;
  }).join('');
}

/* ============ 弹窗基础 ============ */

function openModal(html) {
  const root = $('#modalRoot');
  root.innerHTML = html;
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  const first = root.querySelector('input, select, textarea, button');
  if (first) first.focus();
}

function closeModal() {
  const root = $('#modalRoot');
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
  document.body.style.overflow = '';
}

function setFieldError(form, name, message) {
  const field = form.querySelector(`[name="${name}"]`)?.closest('.field');
  if (!field) return;
  field.classList.add('invalid');
  const err = field.querySelector(`.err[data-err="${name}"]`);
  if (err) err.textContent = message;
}

function clearFieldErrors(form) {
  $$('.field.invalid', form).forEach((field) => field.classList.remove('invalid'));
  $$('.err', form).forEach((err) => { err.textContent = ''; });
}

function applyFieldErrors(form, err, fieldMap = {}) {
  clearFieldErrors(form);
  const fields = err?.fields ?? {};
  const keys = Object.keys(fields);
  if (!keys.length) {
    toast(readErrorMessage(err), 'err');
    return;
  }
  let mapped = false;
  for (const key of keys) {
    const target = fieldMap[key] ?? key;
    if (form.elements[target]) {
      setFieldError(form, target, fields[key]);
      mapped = true;
    }
  }
  toast(mapped ? '请先修正标红的字段' : readErrorMessage(err), 'err');
}

function findPage(id) {
  const target = Number(id);
  for (const site of state.sites) {
    const page = site.pages.find((item) => item.id === target);
    if (page) return { site, page };
  }
  return null;
}

/* ---------- 站点表单 ---------- */

function openSiteModal(site) {
  const editing = Boolean(site);
  const model = site || {
    name: '',
    baseUrl: '',
    scheduleMode: 'daily',
    scheduleValue: '09:00, 21:00',
    enabled: true
  };

  openModal(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="${editing ? '编辑站点' : '新增站点'}">
      <div class="modal-head">
        <h3>${editing ? '编辑站点' : '新增站点'}</h3>
        <button class="icon-btn" data-close aria-label="关闭">×</button>
      </div>
      <form class="modal-body" id="siteForm" novalidate>
        <label class="field">
          <span>站点名称</span>
          <input name="name" value="${escapeHtml(model.name)}" placeholder="例如：示例科技官网">
          <em class="err" data-err="name"></em>
        </label>
        <label class="field">
          <span>站点地址</span>
          <input name="baseUrl" value="${escapeHtml(model.baseUrl)}" placeholder="https://www.example.com/" autocomplete="off">
          <em class="err" data-err="baseUrl"></em>
        </label>

        <div class="field">
          <span>巡检计划</span>
          <div class="segmented" id="modeSwitch" style="margin-bottom:8px">
            <button type="button" class="seg ${model.scheduleMode === 'daily' ? 'active' : ''}" data-mode="daily">每天定时</button>
            <button type="button" class="seg ${model.scheduleMode === 'interval' ? 'active' : ''}" data-mode="interval">每 N 小时</button>
          </div>
        </div>

        <div id="dailyBox" ${model.scheduleMode === 'daily' ? '' : 'hidden'}>
          <label class="field">
            <span>每天几点巡检（最多 4 个，24 小时制，逗号分隔）</span>
            <input name="times" value="${escapeHtml(model.scheduleMode === 'daily' ? model.scheduleValue : '09:00, 21:00')}" placeholder="09:00, 21:00">
            <em class="hint">按站点时区（默认 Asia/Shanghai）执行</em>
            <em class="err" data-err="times"></em>
          </label>
        </div>

        <div id="intervalBox" ${model.scheduleMode === 'interval' ? '' : 'hidden'}>
          <label class="field">
            <span>每隔几小时巡检一次</span>
            <select name="interval">
              ${[1, 2, 3, 4, 6, 8, 12, 24].map((n) => `<option value="${n}" ${String(model.scheduleValue) === String(n) ? 'selected' : ''}>每 ${n} 小时</option>`).join('')}
            </select>
            <em class="err" data-err="interval"></em>
          </label>
        </div>

        <label class="switch-row">
          <input type="checkbox" name="enabled" ${model.enabled ? 'checked' : ''}>
          <span>启用该站点的定时巡检</span>
        </label>

        <p class="form-hint">提示：一个站点建议 3~8 个关键页面；同一站点内页面按固定间隔串行抓取。</p>
      </form>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" id="siteSave">${editing ? '保存修改' : '创建站点'}</button>
      </div>
    </div>
  `);

  const form = $('#siteForm');
  let mode = model.scheduleMode;

  $$('#modeSwitch .seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      $$('#modeSwitch .seg').forEach((item) => item.classList.toggle('active', item === btn));
      $('#dailyBox').hidden = mode !== 'daily';
      $('#intervalBox').hidden = mode !== 'interval';
    });
  });

  $('#siteSave').addEventListener('click', async () => {
    if (!validateSiteForm(form, mode)) return;

    const payload = {
      name: form.elements.name.value.trim(),
      baseUrl: form.elements.baseUrl.value.trim(),
      scheduleMode: mode,
      scheduleValue: mode === 'daily'
        ? form.elements.times.value.replace(/\s+/g, ' ')
        : String(form.elements.interval.value),
      enabled: form.elements.enabled.checked
    };

    const btn = $('#siteSave');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      if (editing) await api(`/sites/${site.id}`, { method: 'PATCH', body: payload });
      else await api('/sites', { method: 'POST', body: payload });

      closeModal();
      await loadAll();
      if (!editing) switchTab('monitors');
      toast(editing ? '站点已更新' : '站点已创建，接着添加页面', 'ok');
    } catch (err) {
      applyFieldErrors(form, err, { scheduleValue: mode === 'daily' ? 'times' : 'interval' });
    } finally {
      btn.disabled = false;
      btn.textContent = editing ? '保存修改' : '创建站点';
    }
  });
}

function validateSiteForm(form, mode) {
  clearFieldErrors(form);
  let ok = true;
  const name = form.elements.name.value.trim();
  const baseUrl = form.elements.baseUrl.value.trim();

  if (!name) {
    setFieldError(form, 'name', '请填写站点名称');
    ok = false;
  } else if (name.length > 40) {
    setFieldError(form, 'name', '名称最多 40 个字符');
    ok = false;
  }

  if (!baseUrl) {
    setFieldError(form, 'baseUrl', '请填写站点地址');
    ok = false;
  } else if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) {
    setFieldError(form, 'baseUrl', '必须以 http:// 或 https:// 开头');
    ok = false;
  }

  if (mode === 'daily') {
    const times = form.elements.times.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    if (!times.length) {
      setFieldError(form, 'times', '至少填一个时刻，例如 09:00');
      ok = false;
    } else if (times.length > 4) {
      setFieldError(form, 'times', '最多 4 个时刻');
      ok = false;
    } else {
      const badTime = times.find((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time));
      if (badTime) {
        setFieldError(form, 'times', `时刻「${badTime}」格式不对，应为 HH:MM（如 09:00）`);
        ok = false;
      }
    }
  }

  return ok;
}

/* ---------- 页面表单 ---------- */

function openPageModal(siteId, page) {
  const editing = Boolean(page);
  const site = state.sites.find((item) => item.id === Number(siteId)) || state.sites[0];
  const model = page || { name: '', url: '', mustContain: [], ignorePatterns: [], keywords: '' };

  openModal(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="${editing ? '编辑页面' : '新增页面'}">
      <div class="modal-head">
        <h3>${editing ? '编辑页面' : '新增页面'} · ${escapeHtml(site ? site.name : '')}</h3>
        <button class="icon-btn" data-close aria-label="关闭">×</button>
      </div>
      <form class="modal-body" id="pageForm" novalidate>
        <div class="form-row">
          <label class="field">
            <span>页面名称</span>
            <input name="name" value="${escapeHtml(model.name)}" placeholder="例如：主页 / 产品列表页 / 文章详情页">
            <em class="err" data-err="name"></em>
          </label>
          <label class="field narrow">
            <span>所属站点</span>
            <select name="siteId" ${editing ? 'disabled' : ''}>
              ${state.sites.map((item) => `<option value="${item.id}" ${site && item.id === site.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
            </select>
          </label>
        </div>

        <label class="field">
          <span>页面地址</span>
          <input name="url" value="${escapeHtml(model.url)}" placeholder="https://www.example.com/news/123" autocomplete="off">
          <em class="err" data-err="url"></em>
        </label>

        <label class="field">
          <span>必须包含的文字（可选，逗号分隔）</span>
          <input name="mustContain" value="${escapeHtml((model.mustContain || []).join(', '))}" placeholder="示例科技, 备案号, 产品中心">
          <em class="hint">页面上找不到这些文字就判异常，能显著降低“页面被换掉”的漏判。</em>
          <em class="err" data-err="mustContain"></em>
        </label>

        <label class="field">
          <span>忽略规则（每行一条正则，命中的行不参与比对）</span>
          <textarea name="ignore" placeholder="\\d{4}-\\d{2}-\\d{2}&#10;访问量.*">${escapeHtml((model.ignorePatterns || []).join('\n'))}</textarea>
          <em class="hint">日期、访问量、随机 token 等每次都变的内容，配好可避免“内容变更”误报。</em>
          <em class="err" data-err="ignore"></em>
        </label>

        <label class="field">
          <span>敏感词（可选，逗号分隔）</span>
          <input name="keywords" value="${escapeHtml(model.keywords || '')}" placeholder="赌博, 加微信, 私彩">
          <em class="hint">命中时本轮邮件标题加急，用于识别挂马广告。</em>
          <em class="err" data-err="keywords"></em>
        </label>
      </form>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" id="pageSave">${editing ? '保存修改' : '添加页面'}</button>
      </div>
    </div>
  `);

  const form = $('#pageForm');
  $('#pageSave').addEventListener('click', async () => {
    if (!validatePageForm(form)) return;

    const payload = {
      name: form.elements.name.value.trim(),
      url: form.elements.url.value.trim(),
      mustContain: splitList(form.elements.mustContain.value),
      ignorePatterns: form.elements.ignore.value.split('\n').map((line) => line.trim()).filter(Boolean),
      keywords: splitList(form.elements.keywords.value).join(','),
      enabled: editing ? page.enabled : true
    };

    const btn = $('#pageSave');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      if (editing) await api(`/pages/${page.id}`, { method: 'PATCH', body: payload });
      else await api(`/sites/${Number(form.elements.siteId.value)}/pages`, { method: 'POST', body: payload });

      closeModal();
      await loadAll();
      toast(editing ? '页面已更新' : '页面已添加，下一轮巡检建立基线', 'ok');
    } catch (err) {
      applyFieldErrors(form, err, { ignorePatterns: 'ignore' });
    } finally {
      btn.disabled = false;
      btn.textContent = editing ? '保存修改' : '添加页面';
    }
  });
}

function validatePageForm(form) {
  clearFieldErrors(form);
  let ok = true;
  const name = form.elements.name.value.trim();
  const url = form.elements.url.value.trim();

  if (!name) {
    setFieldError(form, 'name', '请填写页面名称');
    ok = false;
  } else if (name.length > 40) {
    setFieldError(form, 'name', '名称最多 40 个字符');
    ok = false;
  }
  if (!url) {
    setFieldError(form, 'url', '请填写页面地址');
    ok = false;
  } else if (!/^https?:\/\/[^\s/]+/i.test(url)) {
    setFieldError(form, 'url', '必须以 http:// 或 https:// 开头');
    ok = false;
  }

  const badPattern = form.elements.ignore.value.split('\n').map((line) => line.trim()).filter(Boolean)
    .find((line) => {
      try { new RegExp(line); return false; } catch { return true; }
    });
  if (badPattern) {
    setFieldError(form, 'ignore', `正则写法有误：${badPattern}`);
    ok = false;
  }

  return ok;
}

/* ---------- 判定详情 ---------- */

async function openDetailModal(pageId) {
  const found = findPage(pageId);
  if (!found) return;

  let detail;
  try {
    detail = await api(`/pages/${pageId}/detail`);
  } catch (err) {
    toast(readErrorMessage(err), 'err');
    return;
  }

  const page = detail.page;
  const site = detail.site || found.site;
  const verdict = verdictOf(page);
  const reasons = page.lastCheck?.reasons ?? [];
  const baseLen = detail.baseline?.textLen ?? null;
  const title = page.lastCheck?.title || detail.baseline?.title || '—';
  const hasChanged = page.changed || Boolean(detail.diffSummary);

  openModal(`
    <div class="modal wide" role="dialog" aria-modal="true" aria-label="判定详情">
      <div class="modal-head">
        <h3>判定详情 · ${escapeHtml(page.name)}</h3>
        <button class="icon-btn" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="verdict-hero ${verdict.cls}">
          <span class="verdict ${verdict.cls}"><span class="vd"></span>${verdict.label}</span>
          <div class="vh-main">
            <div class="vh-title">${escapeHtml(title)}</div>
            <div class="vh-sub">${escapeHtml(page.url)}</div>
          </div>
        </div>

        <div class="diff-meta">
          <span>站点：<b>${escapeHtml(site.name)}</b></span>
          <span>上次巡检：<b>${escapeHtml(fmtFull(page.lastCheckedAt))}</b></span>
          <span>页面是否变化：<b>${hasChanged ? '是' : '否'}</b></span>
          ${detail.diffSummary ? `<span>差异：<b>+${detail.diffSummary.addedCount} / -${detail.diffSummary.removedCount} 行</b></span>` : ''}
        </div>

        <div class="diff-block">
          <h4>判定依据</h4>
          ${reasons.length
            ? `<ul class="reason-list">
                ${reasons.map((reason) => `
                  <li class="${reason.hit ? 'hit' : ''}">
                    <span class="rk">${reason.hit ? '命中' : '说明'}</span>
                    <span>${escapeHtml(reason.text)}</span>
                  </li>`).join('')}
              </ul>`
            : `<p class="form-hint">${escapeHtml(page.lastMessage || '尚无判定记录，先跑一次巡检。')}</p>`}
        </div>

        <div class="diff-block">
          <h4>本轮抓取事实</h4>
          <div class="fact-grid">
            <div class="fact"><dt>HTTP 状态码</dt><dd>${page.lastCheck?.httpCode == null ? '—' : page.lastCheck.httpCode}</dd></div>
            <div class="fact"><dt>响应耗时</dt><dd>${page.lastCheck?.responseMs == null ? '—' : page.lastCheck.responseMs + 'ms'}</dd></div>
            <div class="fact"><dt>正文规模</dt><dd>${page.lastCheck?.textLen == null ? '—' : Number(page.lastCheck.textLen).toLocaleString() + ' 字'}${baseLen ? '（基线 ' + Number(baseLen).toLocaleString() + '）' : ''}</dd></div>
            <div class="fact"><dt>必须包含</dt><dd>${page.mustContain?.length ? escapeHtml(page.mustContain.join(', ')) : '未设置'}</dd></div>
          </div>
        </div>

        ${detail.baseline ? `<p class="form-hint">当前基线：快照 #${detail.baseline.id} · ${escapeHtml(fmtFull(detail.baseline.createdAt))} · ${Number(detail.baseline.textLen).toLocaleString()} 字</p>` : '<p class="form-hint">该页面还没有基线，跑一轮巡检后自动建立。</p>'}
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>关闭</button>
        <button class="btn ghost" data-check="${page.id}">立即巡检</button>
        ${hasChanged ? `<button class="btn ghost" data-diff="${page.id}">查看差异</button>` : ''}
        ${hasChanged ? `<button class="btn primary" data-accept="${page.id}">设为新基线</button>` : ''}
      </div>
    </div>
  `);
}

/* ---------- 内容差异 ---------- */

async function openDiffModal(pageId) {
  const found = findPage(pageId);
  if (!found) return;

  let diff;
  try {
    diff = await api(`/pages/${pageId}/diff`);
  } catch (err) {
    toast(readErrorMessage(err), 'err');
    return;
  }

  const removed = diff.removed || [];
  const added = diff.added || [];
  const truncated = diff.truncated ? '<p class="form-hint">差异行过多，仅显示前 200 行。</p>' : '';

  openModal(`
    <div class="modal wide" role="dialog" aria-modal="true" aria-label="内容差异">
      <div class="modal-head">
        <h3>内容差异 · ${escapeHtml(found.page.name)}</h3>
        <button class="icon-btn" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="diff-meta">
          <span>基线：<b>${escapeHtml(fmtFull(diff.baseline?.createdAt))}</b></span>
          <span>当前：<b>${escapeHtml(fmtFull(diff.latest?.createdAt))}</b></span>
          <span>共 ${diff.removedCount ?? removed.length} 行删除、${diff.addedCount ?? added.length} 行新增</span>
        </div>
        <div class="diff-block">
          <h4><span class="badge bad">删除</span> 基线中有、当前已消失</h4>
          <div class="diff-lines">
            ${removed.length
              ? removed.map((text, index) => `<div class="diff-line del"><span class="no">${index + 1}</span><span>${escapeHtml(text)}</span></div>`).join('')
              : '<div class="diff-line"><span class="no"></span><span>（无删除行）</span></div>'}
          </div>
        </div>
        <div class="diff-block">
          <h4><span class="badge ok">新增</span> 当前页面出现的新内容</h4>
          <div class="diff-lines">
            ${added.length
              ? added.map((text, index) => `<div class="diff-line add"><span class="no">${index + 1}</span><span>${escapeHtml(text)}</span></div>`).join('')
              : '<div class="diff-line"><span class="no"></span><span>（无新增行）</span></div>'}
          </div>
        </div>
        ${truncated}
        <p class="form-hint">如果这是你自己发布的改版，点「设为新基线」，后续以此为对比基准。</p>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>关闭</button>
        <button class="btn primary" data-accept="${pageId}">设为新基线</button>
      </div>
    </div>
  `);
}

/* ---------- 删除确认 ---------- */

function openDeleteModal(kind, item) {
  const label = kind === 'site' ? `站点「${item.name}」及其所有页面` : `页面「${item.name}」`;
  openModal(`
    <div class="modal" role="dialog" aria-modal="true" aria-label="删除确认">
      <div class="modal-head">
        <h3>删除${kind === 'site' ? '站点' : '页面'}</h3>
        <button class="icon-btn" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <p>确定删除${escapeHtml(label)}？相关的快照与事件记录会一并清除，此操作不可撤销。</p>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn danger" data-confirm-delete="${kind}:${item.id}">确认删除</button>
      </div>
    </div>
  `);
}

/* ============ 巡检 ============ */

function setProgress(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  $('#progressBar').style.width = `${value}%`;
  $('#progressText').textContent = `${value}%`;
}

function appendLog(text, cls = '') {
  const log = $('#activityLog');
  const line = document.createElement('span');
  line.className = 'ln ' + cls;
  line.textContent = `[${nowHM()}] ${text}\n`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function logClass(text) {
  if (/：bad|异常|失败|超时|error/i.test(text)) return 'ln-err';
  if (/：suspect|：unknown|可疑|无法确认|变更|跳过/i.test(text)) return 'ln-warn';
  if (/：normal|正常|完成|基线/i.test(text)) return 'ln-ok';
  return 'ln-dim';
}

function resetActivity(message = '空闲中，等待下一个巡检周期') {
  $('#activityCard').classList.remove('is-running');
  $('#activityHint').textContent = message;
}

async function runSite(siteId) {
  if (state.runningSite) {
    toast('已有巡检在进行中');
    return;
  }
  const site = state.sites.find((item) => item.id === Number(siteId));
  if (!site) return;
  if (!site.pages.length) {
    toast('该站点还没有页面');
    return;
  }

  state.runningSite = site.id;
  seenLines = 0;
  $('#activityCard').classList.add('is-running');
  $('#activityHint').textContent = `正在巡检：${site.name}`;
  $('#activityLog').innerHTML = '';
  setProgress(0);
  renderSites();

  try {
    const { batchId } = await api(`/sites/${site.id}/run`, { method: 'POST' });
    appendLog(`已提交巡检任务：${site.name}`, 'ln-dim');
    pollBatch(batchId, site);
  } catch (err) {
    state.runningSite = null;
    resetActivity();
    renderSites();
    toast(readErrorMessage(err), 'err');
  }
}

function pollBatch(batchId, site) {
  clearTimeout(pollTimer);

  const tick = async () => {
    let batch;
    try {
      batch = await api(`/batches/${batchId}`);
    } catch (err) {
      state.runningSite = null;
      resetActivity();
      renderSites();
      toast(readErrorMessage(err), 'err');
      return;
    }

    const lines = batch.lines || [];
    for (const text of lines.slice(seenLines)) appendLog(text, logClass(text));
    seenLines = lines.length;
    setProgress(batch.progress ?? 0);
    $('#activityHint').textContent = `正在巡检：${site.name}（${batch.done}/${batch.total}）`;

    if (batch.status === 'running') {
      pollTimer = setTimeout(tick, 800);
      return;
    }

    state.runningSite = null;
    resetActivity();
    setProgress(100);

    if (batch.status === 'error') {
      appendLog(`本轮失败：${batch.summary?.error || '未知错误'}`, 'ln-err');
      toast('巡检失败，请查看活动日志', 'err');
    } else {
      const verdicts = batch.summary?.verdicts ?? {};
      const bad = verdicts.bad ?? 0;
      const soft = (verdicts.suspect ?? 0) + (verdicts.unknown ?? 0);
      appendLog(`本轮完成：检查 ${batch.summary?.checked ?? 0} 个页面 · 异常 ${bad} · 待确认 ${soft} · 变更 ${batch.summary?.changed ?? 0}`,
        bad ? 'ln-err' : 'ln-ok');
      toast(bad ? `巡检完成：${bad} 个页面异常` : '巡检完成', bad ? 'err' : 'ok');
    }

    void loadAll().catch((err) => toast(readErrorMessage(err), 'err'));
  };

  tick();
}

async function runPage(pageId) {
  const found = findPage(pageId);
  if (!found) return;
  const { site, page } = found;

  closeModal();
  state.runningSite = site.id;
  $('#activityCard').classList.add('is-running');
  $('#activityHint').textContent = `正在巡检：${page.name}`;
  setProgress(30);
  renderSites();
  toast(`正在巡检「${page.name}」，通常几秒内完成`);

  try {
    const data = await api(`/pages/${pageId}/run`, { method: 'POST' });
    const result = data.result || {};
    appendLog(`${page.name}：${result.verdict ?? 'unknown'}${result.changed ? ' · 内容变更' : ''}（HTTP ${result.httpCode ?? '—'} · ${result.responseMs ?? 0}ms · ${result.textLen ?? 0} 字）`, logClass(`：${result.verdict ?? ''}`));
    setProgress(100);
    toast(result.verdict === 'normal' && !result.changed ? '巡检完成：页面正常' : '巡检完成：有情况，请查看详情',
      result.verdict === 'normal' && !result.changed ? 'ok' : 'err');
    await loadAll();
  } catch (err) {
    toast(readErrorMessage(err), 'err');
  } finally {
    state.runningSite = null;
    resetActivity();
    setProgress(0);
    renderSites();
  }
}

/* ============ 接受基线 / 删除 ============ */

async function acceptBaseline(pageId) {
  try {
    await api(`/pages/${pageId}/accept`, { method: 'POST' });
    closeModal();
    await loadAll();
    toast('已设为新基线', 'ok');
  } catch (err) {
    toast(readErrorMessage(err), 'err');
  }
}

async function deleteItem(spec) {
  const [kind, rawId] = spec.split(':');
  try {
    await api(kind === 'site' ? `/sites/${rawId}` : `/pages/${rawId}`, { method: 'DELETE' });
    closeModal();
    await loadAll();
    toast(kind === 'site' ? '站点已删除' : '页面已删除', 'ok');
  } catch (err) {
    toast(readErrorMessage(err), 'err');
  }
}

/* ============ 设置 ============ */

function updateSmtpBadge(enabled) {
  const badge = $('#smtpBadge');
  badge.className = 'badge ' + (enabled ? 'ok' : 'plain');
  badge.textContent = enabled ? '已启用' : '未启用';
}

function fillSmtpForm(settings) {
  const form = $('#smtpForm');
  if (!form || !settings) return;

  form.elements.enabled.checked = Boolean(settings.enabled);
  form.elements.host.value = settings.host || '';
  form.elements.port.value = settings.port ?? 465;
  form.elements.secure.value = settings.secure || 'ssl';
  form.elements.user.value = settings.user || '';
  form.elements.password.value = '';
  form.elements.password.placeholder = settings.hasPassword ? '已保存，留空表示不修改' : '留空表示不修改';
  form.elements.from.value = settings.from || '';
  form.elements.to.value = settings.to || '';
  form.elements.cooldownHours.value = settings.cooldownHours ?? 6;
  form.elements.panelUrl.value = settings.panelUrl || '';

  updateSmtpBadge(settings.enabled);
}

async function loadSettings() {
  try {
    fillSmtpForm(await api('/settings'));
  } catch (err) {
    toast(readErrorMessage(err), 'err');
  }
}

async function saveSettings({ silent = false } = {}) {
  const form = $('#smtpForm');
  clearFieldErrors(form);

  const body = {
    enabled: form.elements.enabled.checked,
    host: form.elements.host.value.trim(),
    port: Number(form.elements.port.value),
    secure: form.elements.secure.value,
    user: form.elements.user.value.trim(),
    from: form.elements.from.value.trim(),
    to: form.elements.to.value.trim(),
    cooldownHours: Number(form.elements.cooldownHours.value),
    panelUrl: form.elements.panelUrl.value.trim()
  };

  const password = form.elements.password.value;
  if (password) body.password = password;

  const saved = await api('/settings', { method: 'PUT', body });
  fillSmtpForm(saved);
  if (!silent) toast('设置已保存', 'ok');
  return saved;
}

async function submitSettings(event) {
  event.preventDefault();
  const form = $('#smtpForm');
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    await saveSettings();
  } catch (err) {
    applyFieldErrors(form, err);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存设置';
  }
}

async function testMail() {
  const form = $('#smtpForm');
  const btn = $('#testMailBtn');
  btn.disabled = true;
  btn.textContent = '发送中…';
  try {
    await saveSettings({ silent: true });
    const result = await api('/settings/test-mail', { method: 'POST', body: {} });
    toast(`测试邮件已发送到 ${result.to}，请查收（含垃圾箱）`, 'ok');
  } catch (err) {
    applyFieldErrors(form, err);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存并发送测试邮件';
  }
}

/* ============ 页签与交互委托 ============ */

function switchTab(name) {
  state.tab = name;
  syncTabs();
  renderAll();
}

function syncTabs() {
  $$('.tab').forEach((tab) => {
    const active = tab.dataset.tab === state.tab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  ['overview', 'monitors', 'events', 'settings'].forEach((name) => {
    const view = $('#view-' + name);
    if (view) view.hidden = name !== state.tab;
  });
}

function bindDelegates() {
  document.addEventListener('click', (event) => {
    const el = event.target.closest(
      '[data-detail],[data-diff],[data-accept],[data-check],[data-site-check],[data-page-add],[data-page-edit],[data-page-delete],[data-site-edit],[data-site-delete],[data-confirm-delete],[data-close],[data-goto]'
    );
    if (!el) return;

    if (el.hasAttribute('data-close')) { closeModal(); return; }
    if (el.dataset.goto) { switchTab(el.dataset.goto); return; }

    if (el.dataset.detail) { void openDetailModal(el.dataset.detail); return; }
    if (el.dataset.diff) { void openDiffModal(el.dataset.diff); return; }
    if (el.dataset.accept) { void acceptBaseline(el.dataset.accept); return; }

    if (el.dataset.check) { void runPage(el.dataset.check); return; }
    if (el.dataset.siteCheck) { void runSite(el.dataset.siteCheck); return; }

    if (el.dataset.pageAdd) { openPageModal(el.dataset.pageAdd, null); return; }
    if (el.dataset.pageEdit) {
      const found = findPage(el.dataset.pageEdit);
      if (found) openPageModal(found.site.id, found.page);
      return;
    }
    if (el.dataset.pageDelete) {
      const found = findPage(el.dataset.pageDelete);
      if (found) openDeleteModal('page', found.page);
      return;
    }

    if (el.dataset.siteEdit) {
      const site = state.sites.find((item) => item.id === Number(el.dataset.siteEdit));
      if (site) openSiteModal(site);
      return;
    }
    if (el.dataset.siteDelete) {
      const site = state.sites.find((item) => item.id === Number(el.dataset.siteDelete));
      if (site) openDeleteModal('site', site);
      return;
    }
    if (el.dataset.confirmDelete) { void deleteItem(el.dataset.confirmDelete); }
  });

  $('#modalRoot').addEventListener('click', (event) => {
    if (event.target.id === 'modalRoot') closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#modalRoot').hidden) closeModal();
  });
}

function renderAll() {
  renderHealth();
  renderStats();
  renderAttention();
  renderEventFeed();
  renderSites();
  renderEvents();
}

function init() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

  $('#monitorFilter').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    state.monitorFilter = btn.dataset.filter;
    $$('#monitorFilter .seg').forEach((item) => item.classList.toggle('active', item === btn));
    renderSites();
  });

  $('#eventFilter').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    state.eventFilter = btn.dataset.type;
    $$('#eventFilter .seg').forEach((item) => item.classList.toggle('active', item === btn));
    renderEvents();
  });

  $('#addSiteBtn').addEventListener('click', () => openSiteModal(null));
  $('#addSiteBtn2').addEventListener('click', () => openSiteModal(null));
  $('#logoutBtn').addEventListener('click', () => void logout());

  $('#setupForm').addEventListener('submit', submitSetup);
  $('#loginForm').addEventListener('submit', submitLogin);
  $('#smtpForm').addEventListener('submit', submitSettings);
  $('#testMailBtn').addEventListener('click', () => void testMail());

  bindDelegates();
  syncTabs();
  renderAll();

  // 定时巡检在后台跑，面板静默刷新即可；弹窗打开或正在手动巡检时不打扰。
  setInterval(() => {
    if (document.hidden || state.runningSite || $('#modalRoot').hidden === false) return;
    if (!$('#authRoot').hidden) return;
    void loadAll().catch(() => {});
  }, 60_000);

  void boot();
}

document.addEventListener('DOMContentLoaded', init);
