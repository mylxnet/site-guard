/* 网站哨兵 · 界面原型交互（纯前端，假数据，不发任何请求） · v0.3.0 */

const VERSION = 'v0.7.3';

/* ============ 演示数据 ============ */

const SCENARIOS = {
  empty: {
    nextRun: '—',
    sites: [],
    events: []
  },

  normal: {
    nextRun: '今天 21:00',
    sites: [
      {
        id: 1, name: '示例科技官网', baseUrl: 'https://www.example.com/',
        mode: 'daily', value: '09:00, 21:00', enabled: true,
        lastRun: '今天 09:00', nextRun: '今天 21:00',
        pages: [
          {
            id: 11, name: '主页', url: 'https://www.example.com/',
            verdict: 'normal', changed: false,
            reasons: [{ hit: false, text: '标题正常、正文规模与基线相当、未命中错误特征' }],
            lastAt: '09:00', httpCode: 200, ms: 238, title: '示例科技 - 让业务更简单',
            textLen: 12480, baseLen: 12480, mustContain: '示例科技', keywords: ''
          },
          {
            id: 12, name: '产品列表页', url: 'https://www.example.com/product',
            verdict: 'normal', changed: false,
            reasons: [{ hit: false, text: '卡片列表 12 项，与基线一致' }],
            lastAt: '09:00', httpCode: 200, ms: 312, title: '产品中心 - 示例科技',
            textLen: 8620, baseLen: 8620, mustContain: '产品中心', keywords: ''
          },
          {
            id: 13, name: '文章详情页', url: 'https://www.example.com/news/123',
            verdict: 'normal', changed: false,
            reasons: [{ hit: false, text: '标题、正文、面包屑均与基线一致' }],
            lastAt: '09:00', httpCode: 200, ms: 286, title: '示例科技发布新一代平台',
            textLen: 5240, baseLen: 5240, mustContain: '', keywords: ''
          }
        ]
      }
    ],
    events: [
      { time: '今天 09:00', site: '示例科技官网', page: '主页', type: 'system', detail: '巡检完成：3 个页面均正常，未发送邮件', notified: false },
      { time: '今天 09:00', site: '示例科技官网', page: '—', type: 'system', detail: '本轮建立基线 3 个页面', notified: false },
      { time: '昨天 21:00', site: '示例科技官网', page: '主页', type: 'recovered', detail: '站点恢复访问，耗时 214ms（已发送恢复通知）', notified: true }
    ]
  },

  abnormal: {
    nextRun: '今天 21:00',
    sites: [
      {
        id: 1, name: '示例科技官网', baseUrl: 'https://www.example.com/',
        mode: 'daily', value: '09:00, 21:00', enabled: true,
        lastRun: '今天 09:00', nextRun: '今天 21:00',
        pages: [
          {
            id: 11, name: '主页', url: 'https://www.example.com/',
            verdict: 'bad', changed: false,
            reasons: [
              { hit: true, text: '正文命中错误页特征：Bad Gateway（出现在正文前 2000 字内）' },
              { hit: true, text: '页面标题由「示例科技 - 让业务更简单」变为「502 Bad Gateway」' },
              { hit: true, text: '正文由 12,480 字降至 180 字（基线 30% 以下）' },
              { hit: false, text: 'HTTP 状态码 200 —— 注意：状态码正常不代表页面正常' }
            ],
            lastAt: '09:00', httpCode: 200, ms: 1180, title: '502 Bad Gateway',
            textLen: 180, baseLen: 12480, mustContain: '示例科技', keywords: ''
          },
          {
            id: 12, name: '产品列表页', url: 'https://www.example.com/product',
            verdict: 'suspect', changed: false,
            reasons: [
              { hit: true, text: '正文 4,100 字，较基线 8,620 字下降 52%（30%~60% 区间）' },
              { hit: false, text: '标题、关键断言「产品中心」仍命中' }
            ],
            lastAt: '09:00', httpCode: 200, ms: 640, title: '产品中心 - 示例科技',
            textLen: 4100, baseLen: 8620, mustContain: '产品中心', keywords: ''
          },
          {
            id: 13, name: '文章详情页', url: 'https://www.example.com/news/123',
            verdict: 'normal', changed: true,
            reasons: [
              { hit: true, text: '正文指纹变化：新增 2 行、删除 1 行' },
              { hit: true, text: '命中敏感词「加微信」' }
            ],
            lastAt: '09:00', httpCode: 200, ms: 298, title: '示例科技发布新一代平台',
            textLen: 5380, baseLen: 5240, mustContain: '', keywords: '加微信'
          },
          {
            id: 14, name: '帮助中心', url: 'https://www.example.com/help',
            verdict: 'unknown', changed: false,
            reasons: [
              { hit: true, text: '命中反爬挑战特征：Just a moment / Checking your browser' },
              { hit: false, text: '按规则判为「无法确认」，不计入异常，也不会触发加急' }
            ],
            lastAt: '09:00', httpCode: 403, ms: 820, title: 'Just a moment...',
            textLen: 620, baseLen: 4300, mustContain: '', keywords: ''
          }
        ]
      },
      {
        id: 2, name: '博客子站', baseUrl: 'https://blog.example.com/',
        mode: 'interval', value: '6', enabled: true,
        lastRun: '今天 08:00', nextRun: '今天 14:00',
        pages: [
          {
            id: 21, name: '博客首页', url: 'https://blog.example.com/',
            verdict: 'bad', changed: false,
            reasons: [
              { hit: true, text: '连接超时（20s），已重试 1 次仍失败' },
              { hit: true, text: '传输层无响应，判定为不可用' }
            ],
            lastAt: '08:00', httpCode: null, ms: 20000, title: '—',
            textLen: 0, baseLen: 9600, mustContain: '', keywords: ''
          }
        ]
      }
    ],
    events: [
      { time: '今天 09:00', site: '示例科技官网', page: '主页', type: 'bad', detail: '标题「502 Bad Gateway」；正文 12,480 → 180 字；命中错误特征', notified: true },
      { time: '今天 09:00', site: '示例科技官网', page: '产品列表页', type: 'suspect', detail: '正文较基线下降 52%，关键断言仍命中', notified: true },
      { time: '今天 09:00', site: '示例科技官网', page: '文章详情页', type: 'changed', detail: '新增 2 行、删除 1 行；命中敏感词「加微信」', notified: true },
      { time: '今天 09:00', site: '示例科技官网', page: '帮助中心', type: 'unknown', detail: '疑似 Cloudflare 反爬挑战，未计入异常', notified: true },
      { time: '今天 08:00', site: '博客子站', page: '博客首页', type: 'bad', detail: '连接超时 20s，重试 1 次仍失败', notified: true },
      { time: '昨天 21:00', site: '示例科技官网', page: '主页', type: 'recovered', detail: '站点恢复访问，耗时 214ms', notified: true }
    ]
  }
};

const DIFF_MOCK = {
  baseline: '2026-10-24 21:00',
  current: '2026-10-25 09:00',
  removed: [
    { no: 36, text: '本次发布会将于 11 月 8 日举行，欢迎报名参加。' }
  ],
  added: [
    { no: 36, text: '本次发布会将于 11 月 8 日举行，欢迎报名参加。' },
    { no: 37, text: '加微信 abc8866 领取内部资料，名额有限。' },
    { no: 38, text: '【澳门赌场上线】首存即送 8888 元' }
  ]
};

/* ============ 运行时状态 ============ */

const state = {
  scenario: 'normal',
  tab: 'overview',
  monitorFilter: 'all',
  eventFilter: 'all',
  sites: [],
  events: [],
  nextRun: '—',
  running: null
};

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

/* ============ 工具 ============ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function allPages() {
  return state.sites.flatMap((site) => site.pages.map((page) => ({ site, page })));
}

function nowHM() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function scheduleText(site) {
  if (site.mode === 'daily') return '每天 ' + site.value.replace(/\s+/g, ' ');
  return '每 ' + site.value + ' 小时';
}

function siteVerdict(site) {
  const ranks = site.pages.map((p) => VERDICT[p.verdict].rank);
  if (!ranks.length) return 'normal';
  const max = Math.max(...ranks);
  return Object.keys(VERDICT).find((k) => VERDICT[k].rank === max) || 'normal';
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

/* ============ 概览 ============ */

function renderHealth() {
  const pill = $('#healthPill');
  const text = $('#healthText');
  const pages = allPages().map((x) => x.page);
  const bad = pages.filter((p) => p.verdict === 'bad').length;
  const soft = pages.filter((p) => p.verdict === 'suspect' || p.verdict === 'unknown').length;

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
  } else {
    text.textContent = '运行正常';
  }
  $('#nextRun').textContent = state.nextRun;
}

function renderStats() {
  const pages = allPages().map((x) => x.page);
  const bad = pages.filter((p) => p.verdict === 'bad').length;
  const soft = pages.filter((p) => p.verdict === 'suspect' || p.verdict === 'unknown').length;
  const changed = pages.filter((p) => p.changed).length;

  const cards = [
    { label: '站点', value: state.sites.length, sub: `共 ${pages.length} 个页面`, cls: '' },
    { label: '异常', value: bad, sub: bad ? '已发送加急告警' : '没有异常页面', cls: bad ? 'is-bad' : 'is-ok' },
    { label: '可疑 / 待确认', value: soft, sub: soft ? '需要人工看一眼' : '无待确认项', cls: soft ? 'is-warn' : '' },
    { label: '内容变更', value: changed, sub: changed ? '与本轮基线不一致' : '与基线一致', cls: changed ? 'is-warn' : '' }
  ];

  $('#statGrid').innerHTML = cards.map((c) => `
    <div class="stat ${c.cls}">
      <span class="label">${c.label}</span>
      <span class="value">${c.value}</span>
      <span class="sub">${escapeHtml(c.sub)}</span>
    </div>`).join('');
}

function renderAttention() {
  const list = $('#attentionList');
  const items = allPages()
    .filter(({ page }) => page.verdict !== 'normal' || page.changed)
    .sort((a, b) => {
      const diff = VERDICT[b.page.verdict].rank - VERDICT[a.page.verdict].rank;
      return diff !== 0 ? diff : Number(b.page.changed) - Number(a.page.changed);
    });

  $('#attentionCount').textContent = items.length ? `${items.length} 项` : '';

  if (!items.length) {
    list.innerHTML = `<p class="empty-line">${state.sites.length ? '所有页面均正常，无需处理。' : '还没有站点，去「监测」页添加第一个。'}</p>`;
    return;
  }

  list.innerHTML = items.map(({ site, page }) => {
    const v = VERDICT[page.verdict];
    const reason = page.reasons.find((r) => r.hit)?.text || page.reasons[0]?.text || '';
    const isChangedOnly = page.verdict === 'normal' && page.changed;
    return `
      <div class="attention-item ${isChangedOnly ? 'warn' : v.cls}">
        <div class="ai-main">
          <div class="ai-title">
            <span>${escapeHtml(page.name)}</span>
            <span class="badge ${v.cls}">${v.label}</span>
            ${page.changed ? '<span class="badge info">内容变更</span>' : ''}
            <span class="site-tag">${escapeHtml(site.name)}</span>
          </div>
          <div class="ai-msg">${escapeHtml(reason)}</div>
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
  if (!state.events.length) {
    feed.innerHTML = '<li><span class="m">暂无事件记录。</span></li>';
    return;
  }
  feed.innerHTML = state.events.slice(0, 7).map((e) => `
    <li>
      <span class="t">${escapeHtml(e.time)}</span>
      <span class="m"><b>${escapeHtml(e.page)}</b> · ${escapeHtml(e.detail)}</span>
    </li>`).join('');
}

/* ============ 监测（站点 / 页面） ============ */

function renderSites() {
  const list = $('#siteList');
  const empty = $('#monitorEmpty');
  const pages = allPages().map((x) => x.page);
  const bad = pages.filter((p) => p.verdict === 'bad').length;

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
    sites = sites.filter((s) => s.pages.some((p) => p.verdict === 'bad' || p.verdict === 'suspect' || p.verdict === 'unknown'));
  } else if (state.monitorFilter === 'changed') {
    sites = sites.filter((s) => s.pages.some((p) => p.changed));
  } else if (state.monitorFilter === 'normal') {
    sites = sites.filter((s) => s.pages.every((p) => p.verdict === 'normal'));
  }

  if (!sites.length) {
    list.innerHTML = '<p class="empty-line">当前筛选下没有站点。</p>';
    return;
  }

  list.innerHTML = sites.map((site) => {
    const v = siteVerdict(site);
    const badCount = site.pages.filter((p) => p.verdict === 'bad').length;
    const softCount = site.pages.filter((p) => p.verdict === 'suspect' || p.verdict === 'unknown').length;
    const changedCount = site.pages.filter((p) => p.changed).length;
    const running = state.running === site.id;

    const rows = site.pages.length
      ? site.pages.map((page) => {
          const pv = VERDICT[page.verdict];
          const reason = page.reasons.find((r) => r.hit)?.text || page.reasons[0]?.text || '—';
          return `
            <tr class="${page.verdict !== 'normal' || page.changed ? 'is-flag' : ''}">
              <td>
                <span class="p-name">${escapeHtml(page.name)}</span>
                <span class="p-url">${escapeHtml(page.url)}</span>
              </td>
              <td>
                <span class="verdict ${pv.cls}"><span class="vd"></span>${pv.label}</span>
                ${page.changed ? '<span class="badge info" style="margin-left:6px">变更</span>' : ''}
              </td>
              <td class="p-time">${escapeHtml(page.lastAt || '—')}</td>
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

    return `
      <article class="site is-${v} ${running ? 'is-running' : ''}" data-site="${site.id}">
        <div class="site-head">
          <div>
            <div class="site-title">
              <span class="site-name">${escapeHtml(site.name)}</span>
              ${badCount ? `<span class="badge bad">${badCount} 异常</span>` : ''}
              ${softCount ? `<span class="badge warn">${softCount} 待确认</span>` : ''}
              ${changedCount ? `<span class="badge info">${changedCount} 变更</span>` : ''}
              ${!badCount && !softCount && !changedCount ? '<span class="badge ok">全部正常</span>' : ''}
            </div>
            <div class="site-meta">
              <span class="site-url">${escapeHtml(site.baseUrl)}</span>
              <span class="schedule-chip">${escapeHtml(scheduleText(site))}</span>
              <span class="schedule-chip">下轮 <span class="sep">·</span> ${escapeHtml(site.nextRun || '—')}</span>
              <span class="schedule-chip">上次 <span class="sep">·</span> ${escapeHtml(site.lastRun || '—')}</span>
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
  const rows = state.events.filter((e) => state.eventFilter === 'all' || e.type === state.eventFilter);

  if (!rows.length) {
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  body.innerHTML = rows.map((e) => {
    const t = EVENT_TYPE[e.type] || EVENT_TYPE.system;
    return `
      <tr>
        <td class="time">${escapeHtml(e.time)}</td>
        <td class="subject">${escapeHtml(e.page)}<span class="site-tag">${escapeHtml(e.site)}</span></td>
        <td><span class="badge ${t.cls}">${t.label}</span></td>
        <td class="detail" title="${escapeHtml(e.detail)}">${escapeHtml(e.detail)}</td>
        <td>${e.notified ? '<span class="badge info">已发送</span>' : '<span class="muted">—</span>'}</td>
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
  $$('.field.invalid', form).forEach((f) => f.classList.remove('invalid'));
}

function findPage(id) {
  for (const site of state.sites) {
    const page = site.pages.find((p) => p.id === Number(id));
    if (page) return { site, page };
  }
  return null;
}

/* ---------- 站点表单 ---------- */

function openSiteModal(site) {
  const editing = Boolean(site);
  const model = site || { name: '', baseUrl: '', mode: 'daily', value: '09:00, 21:00', enabled: true };

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
            <button type="button" class="seg ${model.mode === 'daily' ? 'active' : ''}" data-mode="daily">每天定时</button>
            <button type="button" class="seg ${model.mode === 'interval' ? 'active' : ''}" data-mode="interval">每 N 小时</button>
          </div>
        </div>

        <div id="dailyBox" ${model.mode === 'daily' ? '' : 'hidden'}>
          <label class="field">
            <span>每天几点巡检（最多 4 个，24 小时制，逗号分隔）</span>
            <input name="times" value="${model.mode === 'daily' ? escapeHtml(model.value) : '09:00, 21:00'}" placeholder="09:00, 21:00">
            <em class="hint">按 Asia/Shanghai 时区执行，实际触发会随机浮动 ±90 秒</em>
            <em class="err" data-err="times"></em>
          </label>
        </div>

        <div id="intervalBox" ${model.mode === 'interval' ? '' : 'hidden'}>
          <label class="field">
            <span>每隔几小时巡检一次</span>
            <select name="interval">
              ${[1, 2, 3, 4, 6, 8, 12, 24].map((n) => `<option value="${n}" ${String(model.value) === String(n) ? 'selected' : ''}>每 ${n} 小时</option>`).join('')}
            </select>
          </label>
        </div>

        <label class="switch-row">
          <input type="checkbox" name="enabled" ${model.enabled ? 'checked' : ''}>
          <span>启用该站点的定时巡检</span>
        </label>

        <p class="form-hint">提示：一个站点下建议 3~8 个关键页面；同一站点内页面按 3 秒间隔串行抓取。</p>
      </form>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" id="siteSave">${editing ? '保存修改' : '创建站点'}</button>
      </div>
    </div>
  `);

  const form = $('#siteForm');
  let mode = model.mode;

  $$('#modeSwitch .seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      $$('#modeSwitch .seg').forEach((b) => b.classList.toggle('active', b === btn));
      $('#dailyBox').hidden = mode !== 'daily';
      $('#intervalBox').hidden = mode !== 'interval';
    });
  });

  $('#siteSave').addEventListener('click', () => {
    if (!validateSiteForm(form, mode)) return;
    const name = form.elements.name.value.trim();
    const baseUrl = form.elements.baseUrl.value.trim();
    const value = mode === 'daily'
      ? form.elements.times.value.replace(/\s+/g, ' ')
      : String(form.elements.interval.value);
    const enabled = form.elements.enabled.checked;

    if (editing) {
      Object.assign(site, { name, baseUrl, mode, value, enabled });
      toast('站点已更新');
    } else {
      const id = Math.max(0, ...state.sites.map((s) => s.id)) + 1;
      state.sites.push({
        id, name, baseUrl, mode, value, enabled,
        lastRun: '—', nextRun: mode === 'daily' ? `今天 ${value.split(',')[0].trim()}` : `${value} 小时后`,
        pages: []
      });
      toast('站点已创建，接着添加页面');
      state.tab = 'monitors';
      syncTabs();
    }
    closeModal();
    renderAll();
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
    const times = form.elements.times.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (!times.length) {
      setFieldError(form, 'times', '至少填一个时刻，例如 09:00');
      ok = false;
    } else if (times.length > 4) {
      setFieldError(form, 'times', '最多 4 个时刻');
      ok = false;
    } else {
      const badTime = times.find((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t));
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
  const site = state.sites.find((s) => s.id === Number(siteId)) || state.sites[0];
  const model = page || { name: '', url: '', mustContain: '', keywords: '', ignore: '' };

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
              ${state.sites.map((s) => `<option value="${s.id}" ${site && s.id === site.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
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
          <input name="mustContain" value="${escapeHtml(model.mustContain || '')}" placeholder="示例科技, 备案号, 产品中心">
          <em class="hint">页面上找不到这些文字就判异常，能显著降低“页面被换掉”的漏判。</em>
        </label>

        <label class="field">
          <span>忽略规则（每行一条正则，命中的行不参与比对）</span>
          <textarea name="ignore" placeholder="\\d{4}-\\d{2}-\\d{2}&#10;访问量.*">${escapeHtml(model.ignore || '')}</textarea>
          <em class="hint">日期、访问量、随机 token 等每次都变的内容，配好可避免“内容变更”误报。</em>
          <em class="err" data-err="ignore"></em>
        </label>

        <label class="field">
          <span>敏感词（可选，逗号分隔）</span>
          <input name="keywords" value="${escapeHtml(model.keywords || '')}" placeholder="赌博, 加微信, 私彩">
          <em class="hint">命中时本轮邮件标题加急，用于识别挂马广告。</em>
        </label>
      </form>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" id="pageSave">${editing ? '保存修改' : '添加页面'}</button>
      </div>
    </div>
  `);

  const form = $('#pageForm');
  $('#pageSave').addEventListener('click', () => {
    if (!validatePageForm(form)) return;
    const name = form.elements.name.value.trim();
    const url = form.elements.url.value.trim();
    const mustContain = form.elements.mustContain.value.trim();
    const ignore = form.elements.ignore.value.trim();
    const keywords = form.elements.keywords.value.trim();

    if (editing) {
      Object.assign(page, { name, url, mustContain, keywords, ignore });
      toast('页面已更新');
    } else {
      const targetSite = state.sites.find((s) => s.id === Number(form.elements.siteId.value));
      const id = Math.max(0, ...allPages().map((x) => x.page.id)) + 1;
      targetSite.pages.push({
        id, name, url, mustContain, keywords, ignore,
        verdict: 'normal', changed: false, lastAt: '—',
        reasons: [{ hit: false, text: '尚未巡检，下一轮巡检时建立基线' }],
        httpCode: null, ms: 0, title: '—', textLen: 0, baseLen: 0
      });
      toast('页面已添加，下一轮巡检建立基线');
    }
    closeModal();
    renderAll();
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
  }
  if (!url) {
    setFieldError(form, 'url', '请填写页面地址');
    ok = false;
  } else if (!/^https?:\/\/[^\s/]+/i.test(url)) {
    setFieldError(form, 'url', '必须以 http:// 或 https:// 开头');
    ok = false;
  }

  const badPattern = form.elements.ignore.value.split('\n').map((s) => s.trim()).filter(Boolean)
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

function openDetailModal(pageId) {
  const found = findPage(pageId);
  if (!found) return;
  const { site, page } = found;
  const v = VERDICT[page.verdict];

  openModal(`
    <div class="modal wide" role="dialog" aria-modal="true" aria-label="判定详情">
      <div class="modal-head">
        <h3>判定详情 · ${escapeHtml(page.name)}</h3>
        <button class="icon-btn" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="verdict-hero ${v.cls}">
          <span class="verdict ${v.cls}"><span class="vd"></span>${v.label}</span>
          <div class="vh-main">
            <div class="vh-title">${escapeHtml(page.title || '—')}</div>
            <div class="vh-sub">${escapeHtml(page.url)}</div>
          </div>
        </div>

        <div class="diff-meta">
          <span>站点：<b>${escapeHtml(site.name)}</b></span>
          <span>上次巡检：<b>${escapeHtml(page.lastAt || '—')}</b></span>
          <span>页面是否变化：<b>${page.changed ? '是' : '否'}</b></span>
        </div>

        <div class="diff-block">
          <h4>判定依据</h4>
          <ul class="reason-list">
            ${page.reasons.map((r) => `
              <li class="${r.hit ? 'hit' : ''}">
                <span class="rk">${r.hit ? '命中' : '说明'}</span>
                <span>${escapeHtml(r.text)}</span>
              </li>`).join('')}
          </ul>
        </div>

        <div class="diff-block">
          <h4>本轮抓取事实</h4>
          <div class="fact-grid">
            <div class="fact"><dt>HTTP 状态码</dt><dd>${page.httpCode == null ? '—' : page.httpCode}</dd></div>
            <div class="fact"><dt>响应耗时</dt><dd>${page.ms ? page.ms + 'ms' : '—'}</dd></div>
            <div class="fact"><dt>正文规模</dt><dd>${page.textLen.toLocaleString()} 字${page.baseLen ? '（基线 ' + page.baseLen.toLocaleString() + '）' : ''}</dd></div>
            <div class="fact"><dt>必须包含</dt><dd>${page.mustContain ? escapeHtml(page.mustContain) : '未设置'}</dd></div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>关闭</button>
        <button class="btn ghost" data-check="${page.id}">立即巡检</button>
        ${page.changed ? `<button class="btn ghost" data-diff="${page.id}">查看差异</button>` : ''}
        ${page.changed ? `<button class="btn primary" data-accept="${page.id}">设为新基线</button>` : ''}
      </div>
    </div>
  `);
}

/* ---------- 差异 ---------- */

function openDiffModal(pageId) {
  const found = findPage(pageId);
  if (!found) return;
  const { page } = found;

  openModal(`
    <div class="modal wide" role="dialog" aria-modal="true" aria-label="内容差异">
      <div class="modal-head">
        <h3>内容差异 · ${escapeHtml(page.name)}</h3>
        <button class="icon-btn" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="diff-meta">
          <span>基线：<b>${DIFF_MOCK.baseline}</b></span>
          <span>当前：<b>${DIFF_MOCK.current}</b></span>
          <span>共 1 行删除、3 行新增</span>
        </div>
        <div class="diff-block">
          <h4><span class="badge bad">删除</span> 基线中有、当前已消失</h4>
          <div class="diff-lines">
            ${DIFF_MOCK.removed.map((l) => `<div class="diff-line del"><span class="no">${l.no}</span><span>${escapeHtml(l.text)}</span></div>`).join('')}
          </div>
        </div>
        <div class="diff-block">
          <h4><span class="badge ok">新增</span> 当前页面出现的新内容</h4>
          <div class="diff-lines">
            ${DIFF_MOCK.added.map((l) => `<div class="diff-line add"><span class="no">${l.no}</span><span>${escapeHtml(l.text)}</span></div>`).join('')}
          </div>
        </div>
        <p class="form-hint">如果这是你自己发布的改版，点「设为新基线」，后续以此为对比基准。</p>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>关闭</button>
        <button class="btn primary" data-accept="${page.id}">设为新基线</button>
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

/* ============ 巡检模拟 ============ */

let runTimer = null;

function appendLog(text, cls = '') {
  const log = $('#activityLog');
  const line = document.createElement('span');
  line.className = 'ln ' + cls;
  line.textContent = `[${nowHM()}] ${text}\n`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function runSiteCheck(siteId, pageId) {
  if (state.running) {
    toast('已有巡检在进行中');
    return;
  }
  const site = state.sites.find((s) => s.id === Number(siteId));
  if (!site) return;
  const pages = pageId ? site.pages.filter((p) => p.id === Number(pageId)) : site.pages;
  if (!pages.length) {
    toast('该站点还没有页面');
    return;
  }

  state.running = site.id;
  $('#activityCard').classList.add('is-running');
  $('#activityHint').textContent = `正在巡检：${site.name}`;
  $('#activityLog').innerHTML = '';
  $('#progressBar').style.width = '0';
  $('#progressText').textContent = '0%';
  renderSites();
  renderAttention();

  appendLog(`开始巡检：${site.name}（${pages.length} 个页面）`, 'ln-dim');

  let index = 0;

  const step = () => {
    if (index >= pages.length) {
      const bad = pages.filter((p) => p.verdict === 'bad').length;
      const soft = pages.filter((p) => p.verdict === 'suspect' || p.verdict === 'unknown').length;
      const changed = pages.filter((p) => p.changed).length;
      const summary = `本轮完成：${pages.length} 个页面，异常 ${bad} · 待确认 ${soft} · 变更 ${changed}`;
      appendLog(summary, bad ? 'ln-err' : 'ln-ok');
      appendLog(bad || soft || changed ? '已发送汇总邮件（1 封）' : '无状态变化，未发送邮件', 'ln-dim');

      state.running = null;
      state.events.unshift({
        time: '今天 ' + nowHM(),
        site: site.name,
        page: pageId ? pages[0].name : '—',
        type: bad ? 'bad' : soft ? 'suspect' : changed ? 'changed' : 'system',
        detail: summary,
        notified: Boolean(bad || soft || changed)
      });
      site.lastRun = '今天 ' + nowHM();
      $('#activityHint').textContent = '空闲中，等待下一个巡检周期';
      $('#progressBar').style.width = '100%';
      $('#progressText').textContent = '100%';
      renderAll();
      toast(bad ? `巡检完成：${bad} 个页面异常` : '巡检完成', bad ? 'err' : 'ok');
      return;
    }

    const page = pages[index];
    index += 1;
    const v = VERDICT[page.verdict];
    appendLog(`${index}. ${page.name}  ${page.url}`);
    appendLog(`   HTTP ${page.httpCode == null ? '—' : page.httpCode} · ${page.ms}ms · 正文 ${page.textLen.toLocaleString()} 字`);
    appendLog(`   判定：${v.label}${page.changed ? '（内容变更）' : ''}`, page.verdict === 'bad' ? 'ln-err' : page.verdict === 'normal' && !page.changed ? 'ln-ok' : 'ln-warn');

    page.lastAt = nowHM();

    const pct = Math.round((index / pages.length) * 100);
    $('#progressBar').style.width = pct + '%';
    $('#progressText').textContent = pct + '%';
    renderSites();

    runTimer = setTimeout(step, 620);
  };

  step();
}

/* ============ 交互委托 ============ */

function acceptBaseline(pageId) {
  const found = findPage(pageId);
  if (!found) return;
  found.page.changed = false;
  if (found.page.verdict === 'normal') {
    found.page.reasons = [{ hit: false, text: '已接受当前版本为新基线' }];
  }
  state.events.unshift({
    time: '今天 ' + nowHM(),
    site: found.site.name,
    page: found.page.name,
    type: 'system',
    detail: '已接受当前版本为新基线',
    notified: false
  });
  closeModal();
  renderAll();
  toast('已设为新基线');
}

function deleteItem(spec) {
  const [kind, rawId] = spec.split(':');
  const id = Number(rawId);
  if (kind === 'site') {
    state.sites = state.sites.filter((s) => s.id !== id);
  } else {
    state.sites.forEach((s) => { s.pages = s.pages.filter((p) => p.id !== id); });
  }
  closeModal();
  renderAll();
  toast(kind === 'site' ? '站点已删除' : '页面已删除');
}

function bindDelegates() {
  document.addEventListener('click', (event) => {
    const el = event.target.closest(
      '[data-detail],[data-diff],[data-accept],[data-check],[data-site-check],[data-page-add],[data-page-edit],[data-page-delete],[data-site-edit],[data-site-delete],[data-confirm-delete],[data-close],[data-goto]'
    );
    if (!el) return;

    if (el.dataset.close !== undefined) { closeModal(); return; }
    if (el.dataset.goto) { switchTab(el.dataset.goto); return; }

    if (el.dataset.detail) { openDetailModal(el.dataset.detail); return; }
    if (el.dataset.diff) { openDiffModal(el.dataset.diff); return; }
    if (el.dataset.accept) { acceptBaseline(el.dataset.accept); return; }

    if (el.dataset.check) {
      const found = findPage(el.dataset.check);
      if (found) { closeModal(); runSiteCheck(found.site.id, found.page.id); }
      return;
    }
    if (el.dataset.siteCheck) { runSiteCheck(el.dataset.siteCheck); return; }

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
      const site = state.sites.find((s) => s.id === Number(el.dataset.siteEdit));
      if (site) openSiteModal(site);
      return;
    }
    if (el.dataset.siteDelete) {
      const site = state.sites.find((s) => s.id === Number(el.dataset.siteDelete));
      if (site) openDeleteModal('site', site);
      return;
    }
    if (el.dataset.confirmDelete) { deleteItem(el.dataset.confirmDelete); }
  });

  $('#modalRoot').addEventListener('click', (event) => {
    if (event.target.id === 'modalRoot') closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#modalRoot').hidden) closeModal();
  });
}

/* ============ 页签与场景 ============ */

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

function loadScenario(name) {
  state.scenario = name;
  const data = SCENARIOS[name];
  state.sites = JSON.parse(JSON.stringify(data.sites));
  state.events = JSON.parse(JSON.stringify(data.events));
  state.nextRun = data.nextRun;
  state.monitorFilter = 'all';
  state.eventFilter = 'all';
  state.running = null;
  if (runTimer) clearTimeout(runTimer);

  $$('#monitorFilter .seg').forEach((b) => b.classList.toggle('active', b.dataset.filter === 'all'));
  $$('#eventFilter .seg').forEach((b) => b.classList.toggle('active', b.dataset.type === 'all'));
  $$('#demoPanel .seg').forEach((b) => b.classList.toggle('active', b.dataset.scene === name));

  $('#activityLog').innerHTML = '<span class="ln ln-dim">等待巡检任务…</span>\n';
  $('#progressBar').style.width = '0';
  $('#progressText').textContent = '0%';
  $('#activityHint').textContent = '空闲中，等待下一个巡检周期';
  $('#activityCard').classList.remove('is-running');

  renderAll();
}

/* ============ 设置 ============ */

const SMTP_DEFAULTS = {
  host: 'smtp.qq.com', port: '465', secure: 'ssl',
  user: 'you@qq.com', from: '网站哨兵 <you@qq.com>',
  to: 'you@qq.com', pass: '', insecureTls: false
};

function fillSmtpForm() {
  const form = $('#smtpForm');
  if (!form) return;
  Object.entries(SMTP_DEFAULTS).forEach(([key, value]) => {
    const el = form.elements[key];
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  });
}

function validateSmtp(form) {
  clearFieldErrors(form);
  let ok = true;
  const host = form.elements.host.value.trim();
  const port = Number(form.elements.port.value);
  const user = form.elements.user.value.trim();
  const to = form.elements.to.value.trim();
  const from = form.elements.from.value.trim();

  if (!host) { setFieldError(form, 'host', '请填写 SMTP 服务器地址'); ok = false; }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setFieldError(form, 'port', '端口需在 1~65535 之间'); ok = false;
  }
  if (!user) { setFieldError(form, 'user', '请填写邮箱账号'); ok = false; }

  const emails = to.split(/[,，;；\s]+/).filter(Boolean);
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emails.length) {
    setFieldError(form, 'to', '至少填一个收件人邮箱'); ok = false;
  } else if (emails.some((e) => !emailRe.test(e))) {
    setFieldError(form, 'to', '有邮箱格式不正确：' + emails.find((e) => !emailRe.test(e))); ok = false;
  }
  if (from && !emailRe.test(from.replace(/^.*<|>$/g, '').trim())) {
    setFieldError(form, 'from', '发件人格式应为「名称 <邮箱>」或直接邮箱'); ok = false;
  }
  return ok;
}

function bindSettings() {
  const form = $('#smtpForm');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validateSmtp(form)) return;
    const badge = $('#smtpBadge');
    badge.className = 'badge ok';
    badge.textContent = '已配置';
    toast('设置已保存（演示，不会写入）');
  });

  $('#testMailBtn').addEventListener('click', () => {
    if (!validateSmtp(form)) {
      toast('请先修正标红的字段', 'err');
      return;
    }
    const btn = $('#testMailBtn');
    btn.disabled = true;
    btn.textContent = '发送中…';
    toast('正在连接 ' + form.elements.host.value.trim() + ':' + form.elements.port.value.trim() + ' …');
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '发送测试邮件';
      toast('测试邮件已发送，请查收（含垃圾箱）', 'ok');
    }, 1400);
  });

  const alertForm = $('#alertForm');
  alertForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(alertForm);
    const cooldown = Number(alertForm.elements.cooldown.value);
    if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 24) {
      setFieldError(alertForm, 'cooldown', '冷却时间需在 1~24 小时之间');
      toast('请先修正标红的字段', 'err');
      return;
    }
    toast('告警策略已保存（演示）');
  });

  const crawlForm = $('#crawlForm');
  crawlForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(crawlForm);
    const timeout = Number(crawlForm.elements.timeout.value);
    const gap = Number(crawlForm.elements.gap.value);
    let ok = true;
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 60) {
      setFieldError(crawlForm, 'timeout', '超时需在 5~60 秒之间');
      ok = false;
    }
    if (!Number.isInteger(gap) || gap < 1 || gap > 60) {
      setFieldError(crawlForm, 'gap', '间隔需在 1~60 秒之间');
      ok = false;
    }
    if (!ok) {
      toast('请先修正标红的字段', 'err');
      return;
    }
    toast('巡检参数已保存（演示）');
  });

  $('#backupBtn').addEventListener('click', () => toast('演示模式：不会真的导出备份'));
  $('#changePwdBtn').addEventListener('click', () => toast('演示模式：不会真的修改密码'));
}

/* ============ 渲染入口 ============ */

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
    $$('#monitorFilter .seg').forEach((b) => b.classList.toggle('active', b === btn));
    renderSites();
  });

  $('#eventFilter').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    state.eventFilter = btn.dataset.type;
    $$('#eventFilter .seg').forEach((b) => b.classList.toggle('active', b === btn));
    renderEvents();
  });

  $('#addSiteBtn').addEventListener('click', () => openSiteModal(null));
  $('#addSiteBtn2').addEventListener('click', () => openSiteModal(null));

  $('#demoPanel').addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (btn) loadScenario(btn.dataset.scene);
  });
  $('#demoHide').addEventListener('click', () => {
    $('#demoPanel').hidden = true;
    $('#demoShow').hidden = false;
  });
  $('#demoShow').addEventListener('click', () => {
    $('#demoPanel').hidden = false;
    $('#demoShow').hidden = true;
  });

  bindDelegates();
  bindSettings();
  fillSmtpForm();
  switchTab('overview');
  loadScenario('normal');

  console.log('网站哨兵界面原型 ' + VERSION + ' · 纯静态演示，无后端请求');
}

document.addEventListener('DOMContentLoaded', init);
