import { parseDailyTimes, parseIntervalHours, isValidTimeZone } from './schedule.js';

/** 校验失败统一抛这个，路由层转成 400 + fields。 */
export class ValidationError extends Error {
  constructor(fields, message) {
    // 顶层 message 带上第一条字段错误：界面横幅不必再自己拼接。
    const first = fields ? Object.values(fields)[0] : null;
    super(message ?? (first ? `输入有误：${first}` : '输入有误'));
    this.name = 'ValidationError';
    this.code = 'VALIDATION_FAILED';
    this.fields = fields ?? {};
  }
}

const name = (value, field = 'name', label = '名称') => {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError({ [field]: `${label}不能为空` });
  if (text.length > 40) throw new ValidationError({ [field]: `${label}最多 40 个字符` });
  return text;
};

/** 只接受 http/https，且必须能构造出合法 URL。 */
const url = (value, field = 'url') => {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError({ [field]: '地址不能为空' });
  if (text.length > 2048) throw new ValidationError({ [field]: '地址过长（最多 2048 字符）' });

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new ValidationError({ [field]: '地址格式不对，需要以 http:// 或 https:// 开头' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError({ [field]: '只支持 http:// 或 https://' });
  }
  if (!parsed.hostname) throw new ValidationError({ [field]: '地址缺少域名' });
  return parsed.toString();
};

const bool = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  return Boolean(value);
};

const stringList = (value, field, { maxItems, maxLength, label }) => {
  let items = value;
  if (typeof items === 'string') items = items.split(/[,，\n]/);
  if (items == null) return [];
  if (!Array.isArray(items)) throw new ValidationError({ [field]: `${label}格式不对` });

  const out = items
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .map((item) => {
      if (item.length > maxLength) {
        throw new ValidationError({ [field]: `${label}每项最多 ${maxLength} 个字符：「${item.slice(0, 20)}…」` });
      }
      return item;
    });

  if (out.length > maxItems) throw new ValidationError({ [field]: `${label}最多 ${maxItems} 项` });
  return out;
};

export function validateSite(input = {}, { defaultTimezone = 'Asia/Shanghai' } = {}) {
  const fields = {};
  // 某个字段失败也要继续校验其它字段：一次把问题全报出来，用户不用挤牙膏。
  const normalized = {
    scheduleMode: String(input.scheduleMode ?? 'daily'),
    timezone: String(input.timezone ?? defaultTimezone),
    enabled: bool(input.enabled, true)
  };

  try {
    normalized.name = name(input.name);
  } catch (err) {
    Object.assign(fields, err.fields);
  }

  try {
    normalized.baseUrl = url(input.baseUrl, 'baseUrl');
  } catch (err) {
    Object.assign(fields, err.fields);
  }

  if (!['daily', 'interval'].includes(normalized.scheduleMode)) {
    fields.scheduleMode = '计划类型只能是 daily 或 interval';
  }

  try {
    if (normalized.scheduleMode === 'daily') {
      const times = parseDailyTimes(input.scheduleValue);
      normalized.scheduleValue = times
        .map((t) => `${String(t.hh).padStart(2, '0')}:${String(t.mm).padStart(2, '0')}`)
        .join(', ');
    } else {
      normalized.scheduleValue = String(parseIntervalHours(input.scheduleValue));
    }
  } catch (err) {
    fields.scheduleValue = err.message;
  }

  if (!isValidTimeZone(normalized.timezone)) {
    fields.timezone = `未知时区「${normalized.timezone}」`;
  }

  if (Object.keys(fields).length) throw new ValidationError(fields);
  return normalized;
}

export function validatePage(input = {}) {
  const fields = {};
  const normalized = { enabled: bool(input.enabled, true) };

  try {
    normalized.name = name(input.name);
  } catch (err) {
    Object.assign(fields, err.fields);
  }

  try {
    normalized.url = url(input.url);
  } catch (err) {
    Object.assign(fields, err.fields);
  }

  try {
    normalized.mustContain = stringList(input.mustContain, 'mustContain', {
      maxItems: 10,
      maxLength: 100,
      label: '必须包含的文字'
    });
  } catch (err) {
    Object.assign(fields, err.fields ?? { mustContain: err.message });
  }

  try {
    const patterns = stringList(input.ignorePatterns, 'ignorePatterns', {
      maxItems: 50,
      maxLength: 200,
      label: '忽略规则'
    });
    for (const pattern of patterns) {
      try {
        new RegExp(pattern);
      } catch {
        throw new ValidationError({ ignorePatterns: `忽略规则写法有误：「${pattern}」` });
      }
    }
    normalized.ignorePatterns = patterns;
  } catch (err) {
    Object.assign(fields, err.fields ?? { ignorePatterns: err.message });
  }

  try {
    const keywords = stringList(input.keywords, 'keywords', {
      maxItems: 30,
      maxLength: 20,
      label: '敏感词'
    });
    normalized.keywords = keywords.join(',');
  } catch (err) {
    Object.assign(fields, err.fields ?? { keywords: err.message });
  }

  if (Object.keys(fields).length) throw new ValidationError(fields);
  return normalized;
}

const EMAIL = /^[^\s@,，;；]+@[^\s@,，;；]+\.[^\s@,，;；]+$/;

export const isEmailAddress = (value) => EMAIL.test(String(value ?? '').trim());

const mailRecipients = (value) =>
  String(value ?? '')
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * 邮件设置校验。密码留空表示“不改动”，避免界面每次保存都要重填授权码。
 * 只有启用告警时才强制要求服务器/发件人/收件人，方便先存配置后开。
 */
export function validateMailSettings(input = {}, { existing = {} } = {}) {
  const fields = {};
  const pick = (key, fallback) => (input[key] === undefined ? fallback : input[key]);

  const enabled = bool(pick('enabled', existing.enabled ?? false), false);
  const host = String(pick('host', existing.host ?? '')).trim();
  const secure = String(pick('secure', existing.secure ?? 'ssl'));
  const user = String(pick('user', existing.user ?? '')).trim();
  const passwordInput = input.password;
  const password = passwordInput === undefined || passwordInput === ''
    ? existing.password ?? ''
    : String(passwordInput);
  const from = String(pick('from', existing.from ?? '')).trim();
  const recipients = mailRecipients(pick('to', existing.to ?? ''));
  const panelUrl = String(pick('panelUrl', existing.panelUrl ?? '')).trim();

  const port = Number(pick('port', existing.port ?? 465));
  if (!Number.isInteger(port) || port < 1 || port > 65535) fields.port = '端口需为 1~65535 的整数';
  if (!['ssl', 'starttls', 'none'].includes(secure)) fields.secure = '加密方式只能是 ssl、starttls 或 none';

  if (host.length > 255) fields.host = '服务器地址最多 255 个字符';
  if (user.length > 255) fields.user = '账号最多 255 个字符';
  if (password.length > 255) fields.password = '密码/授权码最多 255 个字符';

  if (recipients.length > 10) fields.to = '收件人最多 10 个';
  const badRecipient = recipients.find((item) => !isEmailAddress(item));
  if (badRecipient) fields.to = `邮箱格式不对：「${badRecipient}」`;

  if (from && !isEmailAddress(from)) fields.from = '发件人邮箱格式不对';

  if (enabled) {
    if (!host) fields.host = '启用告警时必须填写 SMTP 服务器';
    if (!from) fields.from = '启用告警时必须填写发件人';
    if (!recipients.length) fields.to = '启用告警时至少填一个收件人';
  }

  const cooldownHours = Number(pick('cooldownHours', existing.cooldownHours ?? 6));
  if (!Number.isInteger(cooldownHours) || cooldownHours < 0 || cooldownHours > 168) {
    fields.cooldownHours = '冷却时间需为 0~168 的整数（小时）';
  }

  if (panelUrl) {
    try {
      const url = new URL(panelUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      if (!url.hostname) throw new Error('host');
    } catch {
      fields.panelUrl = '面板地址需要以 http:// 或 https:// 开头';
    }
  }

  if (Object.keys(fields).length) throw new ValidationError(fields);
  return {
    enabled,
    host,
    port,
    secure,
    user,
    password,
    from,
    to: recipients.join(','),
    cooldownHours,
    panelUrl
  };
}

export function validatePassword(value) {
  const text = String(value ?? '');
  if (text.length < 8) throw new ValidationError({ password: '密码至少 8 位' });
  if (text.length > 128) throw new ValidationError({ password: '密码最多 128 位' });
  return text;
}

export function requireId(value, field = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError({ [field]: 'ID 不合法' });
  return n;
}
