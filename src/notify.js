import {
  getSettings,
  setSetting,
  getPage,
  getSnapshot,
  latestSnapshot,
  listEventsByBatch,
  checkInBatch,
  markEventsNotified,
  markPagesAlerted,
  addEvent
} from './db.js';
import { diffLines } from './diff.js';
import { localParts } from './schedule.js';
import { badRequest } from './http.js';

/**
 * 邮件告警（PROJECT.md §6）。
 * 原则：一轮巡检最多一封汇总信；没有需要通知的变化就不发；发信成功才把事件标记为已通知，
 * 否则事件留在库里等下一轮（避免“以为发了其实没发”）。
 */

export const MAIL_SETTING_KEYS = {
  enabled: 'mail_enabled',
  host: 'smtp_host',
  port: 'smtp_port',
  secure: 'smtp_secure',
  user: 'smtp_user',
  password: 'smtp_pass',
  from: 'mail_from',
  to: 'mail_to',
  cooldownHours: 'alert_cooldown_hours',
  panelUrl: 'panel_url'
};

const TYPE_META = {
  bad: { label: '异常', icon: '🔴' },
  suspect: { label: '可疑', icon: '🟠' },
  unknown: { label: '无法确认', icon: '⚪' },
  changed: { label: '内容变更', icon: '🟡' },
  recovered: { label: '已恢复', icon: '✅' }
};

const TYPE_ORDER = ['bad', 'suspect', 'unknown', 'changed', 'recovered'];
const TRIGGER_LABEL = { manual: '手动巡检', catchup: '补跑', schedule: '计划巡检' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad2 = (n) => String(n).padStart(2, '0');

export function formatInZone(ts, timeZone = 'Asia/Shanghai') {
  if (!ts) return '—';
  const p = localParts(Number(ts), timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const truncate = (text, max = 120) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

const normalizeRecipients = (value) =>
  String(value ?? '')
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function readMailSettings(db) {
  const settings = getSettings(db);
  return {
    enabled: settings[MAIL_SETTING_KEYS.enabled] === '1',
    host: settings[MAIL_SETTING_KEYS.host] ?? '',
    port: Number(settings[MAIL_SETTING_KEYS.port] ?? 465),
    secure: settings[MAIL_SETTING_KEYS.secure] ?? 'ssl',
    user: settings[MAIL_SETTING_KEYS.user] ?? '',
    password: settings[MAIL_SETTING_KEYS.password] ?? '',
    from: settings[MAIL_SETTING_KEYS.from] ?? '',
    to: settings[MAIL_SETTING_KEYS.to] ?? '',
    cooldownHours: Number(settings[MAIL_SETTING_KEYS.cooldownHours] ?? 6),
    panelUrl: settings[MAIL_SETTING_KEYS.panelUrl] ?? ''
  };
}

export function saveMailSettings(db, settings) {
  setSetting(db, MAIL_SETTING_KEYS.enabled, settings.enabled ? '1' : '0');
  setSetting(db, MAIL_SETTING_KEYS.host, settings.host);
  setSetting(db, MAIL_SETTING_KEYS.port, settings.port);
  setSetting(db, MAIL_SETTING_KEYS.secure, settings.secure);
  setSetting(db, MAIL_SETTING_KEYS.user, settings.user);
  setSetting(db, MAIL_SETTING_KEYS.password, settings.password);
  setSetting(db, MAIL_SETTING_KEYS.from, settings.from);
  setSetting(db, MAIL_SETTING_KEYS.to, settings.to);
  setSetting(db, MAIL_SETTING_KEYS.cooldownHours, settings.cooldownHours);
  setSetting(db, MAIL_SETTING_KEYS.panelUrl, settings.panelUrl);
  return readMailSettings(db);
}

/** 对外输出永远不带密码原文。 */
export function publicMailSettings(settings) {
  const { password, ...rest } = settings;
  return { ...rest, hasPassword: Boolean(password) };
}

/** 把密码从任何错误文案里抹掉，避免授权码进日志或界面。 */
const redact = (text, settings = {}) => {
  let out = String(text ?? '');
  if (settings.password) out = out.split(settings.password).join('******');
  return out;
};

export function describeMailError(err, settings = {}) {
  const text = redact(`${err?.code ?? ''} ${err?.responseCode ?? ''} ${err?.response ?? ''} ${err?.message ?? err}`, settings);
  if (/EAUTH|535|invalid login|authentication failed|username and password not accepted/i.test(text)) {
    return '授权码或密码错误（QQ/163 邮箱需使用授权码，不是登录密码）';
  }
  if (/ETIMEDOUT|ECONNECTION|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ESOCKET|greeting never received|connection timeout/i.test(text)) {
    return '连不上邮件服务器，请检查地址、端口与加密方式是否匹配';
  }
  if (/certificate|self.signed|SSL routines|UNABLE_TO_VERIFY/i.test(text)) {
    return '证书校验失败，请检查 SSL/STARTTLS 设置';
  }
  if (/EENVELOPE|550|551|553|recipient address rejected|mailbox not found/i.test(text)) {
    return '发件人或收件人地址被拒绝，请确认发件人与账号一致';
  }
  return `发送失败：${text.trim().slice(0, 200)}`;
}

async function defaultSend({ settings, message }) {
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new Error('未安装 nodemailer，请先执行 npm install');
  }

  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure === 'ssl',
    requireTLS: settings.secure === 'starttls',
    auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });

  try {
    return await transport.sendMail(message);
  } finally {
    transport.close?.();
  }
}

const countTypes = (items) => {
  const counts = {};
  for (const item of items) counts[item.event.type] = (counts[item.event.type] ?? 0) + 1;
  return counts;
};

export function buildSubject(site, items) {
  const counts = countTypes(items);
  const label = {
    bad: '个页面异常',
    suspect: '个页面可疑',
    unknown: '个页面无法确认',
    changed: '个页面内容变更',
    recovered: '个页面已恢复'
  };
  const parts = TYPE_ORDER.filter((type) => counts[type]).map((type, index) => {
    const icon = index === 0 ? `${TYPE_META[type].icon} ` : '';
    return `${icon}${counts[type]} ${label[type]}`;
  });
  return `[网站哨兵] ${parts.join(' · ')} · ${site.name}`;
}

const factsOf = (item) => {
  const facts = [];
  if (item.check?.http_code) facts.push(`HTTP ${item.check.http_code}`);
  if (item.check?.response_ms != null) facts.push(`${item.check.response_ms}ms`);
  if (item.check?.text_len != null) {
    const base = item.baselineLen ? `（基线 ${Number(item.baselineLen).toLocaleString('en-US')}）` : '';
    facts.push(`正文 ${item.check.text_len} 字${base}`);
  }
  return facts;
};

export function renderTextDigest({ settings, site, items, nextRunAt, trigger, at }) {
  const timeZone = site.timezone || 'Asia/Shanghai';
  const lines = [
    `巡检时间：${formatInZone(at, timeZone)}（${timeZone}）`,
    `站点：${site.name}（${site.base_url}）`,
    ''
  ];

  let index = 0;
  for (const type of TYPE_ORDER) {
    const group = items.filter((item) => item.event.type === type);
    if (!group.length) continue;

    lines.push(`── ${TYPE_META[type].label}（${group.length}）${'─'.repeat(24)}`);
    for (const item of group) {
      index += 1;
      lines.push(`${index}) ${item.page.name}  ${item.page.url}`);

      const facts = factsOf(item);
      if (facts.length) lines.push(`   ${facts.join(' · ')}`);

      if (type === 'bad' || type === 'suspect' || type === 'unknown') {
        const reasons = (item.check?.reasons ?? []).map((reason) => reason.text).filter(Boolean);
        if (reasons.length) lines.push(`   判定：${reasons.join('；')}`);
      }

      if (type === 'changed') {
        lines.push(`   ${item.event.message}`);
        if (item.diff) {
          lines.push(`   差异：+${item.diff.addedCount} / -${item.diff.removedCount} 行`);
          for (const line of item.diff.removed.slice(0, 3)) lines.push(`   - ${truncate(line)}`);
          for (const line of item.diff.added.slice(0, 3)) lines.push(`   + ${truncate(line)}`);
        }
      }

      if (type === 'recovered') lines.push(`   ${item.event.message}`);
      lines.push('');
    }
  }

  if (settings.panelUrl) lines.push(`查看面板：${settings.panelUrl}`);
  const next = nextRunAt ? `；下一轮：${formatInZone(nextRunAt, timeZone)}` : '';
  lines.push(`本轮：${TRIGGER_LABEL[trigger] ?? '巡检'}${next}`);
  lines.push('');
  lines.push('这封邮件由网站哨兵自动发送。调整收件人或冷却时间，请到面板「设置 → 邮件通知」。');
  return lines.join('\n');
}

export function renderHtmlDigest({ settings, site, items, nextRunAt, trigger, at }) {
  const timeZone = site.timezone || 'Asia/Shanghai';
  const colors = { bad: '#dc2626', suspect: '#d97706', unknown: '#64748b', changed: '#ca8a04', recovered: '#16a34a' };
  const parts = [
    `<div style="font:14px/1.6 -apple-system,Segoe UI,Microsoft YaHei,sans-serif;color:#0f172a;max-width:720px">`,
    `<h2 style="margin:0 0 4px;font-size:18px">${escapeHtml(site.name)} · 巡检汇总</h2>`,
    `<p style="margin:0 0 16px;color:#475569">巡检时间：${escapeHtml(formatInZone(at, timeZone))}（${escapeHtml(timeZone)}）</p>`
  ];

  let index = 0;
  for (const type of TYPE_ORDER) {
    const group = items.filter((item) => item.event.type === type);
    if (!group.length) continue;

    parts.push(
      `<h3 style="margin:18px 0 8px;font-size:15px;color:${colors[type]}">${TYPE_META[type].label}（${group.length}）</h3>`,
      '<ol style="margin:0;padding-left:20px">'
    );

    for (const item of group) {
      index += 1;
      const facts = factsOf(item);
      const reasons = type === 'bad' || type === 'suspect' || type === 'unknown'
        ? (item.check?.reasons ?? []).map((reason) => reason.text).filter(Boolean)
        : [];

      parts.push('<li style="margin-bottom:10px">');
      parts.push(`<strong>${escapeHtml(item.page.name)}</strong> <span style="color:#64748b">${escapeHtml(item.page.url)}</span>`);
      if (facts.length) parts.push(`<div style="color:#475569">${escapeHtml(facts.join(' · '))}</div>`);
      if (reasons.length) parts.push(`<div>判定：${escapeHtml(reasons.join('；'))}</div>`);
      if (type === 'changed') {
        parts.push(`<div>${escapeHtml(item.event.message)}</div>`);
        if (item.diff) {
          parts.push(`<div style="color:#475569">差异：+${item.diff.addedCount} / -${item.diff.removedCount} 行</div>`);
          for (const line of item.diff.removed.slice(0, 3)) {
            parts.push(`<div style="color:#b91c1c;font-family:monospace">- ${escapeHtml(truncate(line))}</div>`);
          }
          for (const line of item.diff.added.slice(0, 3)) {
            parts.push(`<div style="color:#15803d;font-family:monospace">+ ${escapeHtml(truncate(line))}</div>`);
          }
        }
      }
      if (type === 'recovered') parts.push(`<div>${escapeHtml(item.event.message)}</div>`);
      parts.push('</li>');
    }

    parts.push('</ol>');
  }

  if (settings.panelUrl) {
    parts.push(`<p style="margin-top:18px"><a href="${escapeHtml(settings.panelUrl)}">打开面板查看完整记录</a></p>`);
  }
  const next = nextRunAt ? `；下一轮：${formatInZone(nextRunAt, timeZone)}` : '';
  parts.push(
    `<p style="margin-top:18px;color:#64748b">本轮：${escapeHtml(TRIGGER_LABEL[trigger] ?? '巡检')}${escapeHtml(next)}</p>`,
    `<p style="color:#94a3b8;font-size:12px">这封邮件由网站哨兵自动发送。</p>`,
    '</div>'
  );
  return parts.join('');
}

const capBody = (text, html) => {
  const limit = 180_000;
  const note = '\n…内容过长，完整信息请到面板查看。';
  return {
    text: text.length > limit ? text.slice(0, limit) + note : text,
    html: html.length > limit ? `${html.slice(0, limit)}<p>…内容过长，完整信息请到面板查看。</p>` : html
  };
};

export function createNotifier({
  db,
  config,
  logger,
  sendMail = null,
  retryDelaysMs = [60_000, 300_000],
  now = () => Date.now()
}) {
  const send = sendMail ?? defaultSend;

  async function deliver(settings, message, { retry = true } = {}) {
    let lastError = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await send({ settings, message });
      } catch (err) {
        lastError = err;
        const delay = retry ? retryDelaysMs[attempt] : undefined;
        if (delay == null) break;
        logger.warn('mail.retry', { attempt: attempt + 2, delay, message: String(err?.message ?? err) });
        await sleep(delay);
      }
    }
    throw lastError;
  }

  function missingSettingsReason(settings) {
    if (!settings.enabled) return '邮件告警未启用';
    if (!settings.host) return 'SMTP 服务器未填写';
    if (!settings.from) return '发件人未填写';
    if (!normalizeRecipients(settings.to).length) return '收件人未填写';
    return null;
  }

  async function notifyBatch({ site, batchId, summary = {}, nextRunAt = null, trigger = 'schedule' }) {
    const settings = readMailSettings(db);
    const missing = missingSettingsReason(settings);
    if (missing) return { sent: false, reason: missing };

    const events = listEventsByBatch(db, batchId).filter((event) => TYPE_ORDER.includes(event.type));
    const cooldownMs = Math.max(0, Number(settings.cooldownHours) || 0) * 3600_000;
    const at = now();

    const included = [];
    for (const event of events) {
      if (event.type === 'changed') {
        const page = getPage(db, event.page_id);
        // 同类冷却：同一种“内容变更”在冷却期内不重复发信；事件仍留在界面里可查。
        if (page?.last_alert_at && at - Number(page.last_alert_at) < cooldownMs) continue;
      }
      included.push(event);
    }

    if (!included.length) return { sent: false, reason: '本轮没有需要通知的变化' };

    const items = included.map((event) => {
      const page = getPage(db, event.page_id) ?? {
        id: event.page_id,
        name: event.page_name ?? '已删除页面',
        url: event.page_url ?? '',
        baseline_id: null
      };
      const check = checkInBatch(db, batchId, event.page_id);
      const baseline = page.baseline_id ? getSnapshot(db, page.baseline_id) : null;
      const baselineLen = baseline ? Number(baseline.meta?.textLen ?? baseline.text.length) : null;

      let diff = null;
      if (event.type === 'changed') {
        const latest = latestSnapshot(db, page.id);
        if (baseline && latest && latest.id !== baseline.id) {
          diff = diffLines(baseline.text, latest.text, { limit: 5 });
        }
      }

      return { event, page, check, baselineLen, diff };
    });

    const subject = buildSubject(site, items);
    const text = renderTextDigest({ settings, site, items, nextRunAt, trigger, at });
    const html = renderHtmlDigest({ settings, site, items, nextRunAt, trigger, at });
    const body = capBody(text, html);
    const message = {
      from: settings.from,
      to: normalizeRecipients(settings.to).join(','),
      subject,
      text: body.text,
      html: body.html
    };

    try {
      const info = await deliver(settings, message);
      markEventsNotified(db, included.map((event) => event.id));
      // 只把“内容变更”计入冷却：恢复/异常不该压住下一次真实变更的告警。
      markPagesAlerted(
        db,
        items.filter((item) => item.event.type === 'changed').map((item) => item.page.id),
        at
      );
      logger.info('mail.send', { site: site.id, batch: batchId, events: included.length, subject });
      return { sent: true, included: included.length, subject, messageId: info?.messageId ?? null };
    } catch (err) {
      const reason = describeMailError(err, settings);
      addEvent(db, {
        batchId,
        siteId: site.id,
        type: 'system',
        message: `告警邮件发送失败：${reason}`
      });
      logger.error('mail.fail', { site: site.id, batch: batchId, reason });
      return { sent: false, reason };
    }
  }

  async function sendTest({ to = null } = {}) {
    const settings = readMailSettings(db);
    if (!settings.host) throw badRequest('请先填写 SMTP 服务器', { host: 'SMTP 服务器未填写' });
    if (!settings.from) throw badRequest('请先填写发件人', { from: '发件人未填写' });

    const recipients = to ? normalizeRecipients(to) : normalizeRecipients(settings.to);
    if (!recipients.length) throw badRequest('请先填写收件人', { to: '收件人未填写' });

    const at = now();
    const timeZone = config?.timezone || 'Asia/Shanghai';
    const message = {
      from: settings.from,
      to: recipients.join(','),
      subject: '[网站哨兵] 测试邮件',
      text: [
        '这是一封测试邮件，说明 SMTP 配置可以使用。',
        `发送时间：${formatInZone(at, timeZone)}（${timeZone}）`,
        `服务器：${settings.host}:${settings.port}（${settings.secure}）`,
        `发件人：${settings.from}`,
        '',
        '收到这封邮件后，巡检发现异常时会按同样方式发送汇总通知。'
      ].join('\n'),
      html: [
        '<div style="font:14px/1.6 -apple-system,Segoe UI,Microsoft YaHei,sans-serif;color:#0f172a">',
        '<h2 style="margin:0 0 8px;font-size:16px">网站哨兵 · 测试邮件</h2>',
        '<p>这是一封测试邮件，说明 SMTP 配置可以使用。</p>',
        `<p style="color:#475569">发送时间：${escapeHtml(formatInZone(at, timeZone))}（${escapeHtml(timeZone)}）<br>`,
        `服务器：${escapeHtml(`${settings.host}:${settings.port}（${settings.secure}）`)}<br>`,
        `发件人：${escapeHtml(settings.from)}</p>`,
        '</div>'
      ].join('')
    };

    try {
      const info = await deliver(settings, message, { retry: false });
      logger.info('mail.test', { to: recipients.join(','), messageId: info?.messageId ?? null });
      return { sent: true, to: recipients.join(','), messageId: info?.messageId ?? null };
    } catch (err) {
      const reason = describeMailError(err, settings);
      logger.warn('mail.test.fail', { to: recipients.join(','), reason });
      throw badRequest(reason);
    }
  }

  return { notifyBatch, sendTest };
}
