# 网站哨兵 Site Guard · 开发技术文档

> 版本：0.8.4 ｜ 日期：2026-10-26 ｜ 作者：by Mr lin
> 读者：维护本项目的开发者。设计方案（为什么这么做）见 [DESIGN.md](DESIGN.md)；部署运维见 [DEPLOY.md](DEPLOY.md)。
> 状态说明：截至 `0.8.4` 已实现抓取、归一化、四档判定、基线/差异、邮件汇总与事件/设置接口，以及接入真实 API 的正式前端面板；`0.8.1` 修复网关裸前缀下的相对资源加载，`0.8.2` 修复网关改写 `Host` 下的同源校验，`0.8.3` 修复忽略规则与基线不对称（比对前按当前规则过滤基线，改规则即时生效），`0.8.4` 修复手机端页签塌陷与页面表格溢出。标注 `[已实现]` 的部分有代码与测试；未标注的为后续规范。

---

## 1. 总体架构

### 1.1 进程模型

单进程、单容器。没有独立 worker、没有 Redis、没有消息队列：

```
node src/server.js
 ├── HTTP Server（内置 node:http）              ← 唯一对外入口，端口 8686
 ├── Scheduler（setInterval 20s 的到期判定）     ← 与 HTTP 同进程，共用 SQLite
 ├── Checker（抓取 + 判定 + 指纹，按站点串行）
 ├── Notifier（批次汇总 + SMTP）
 └── SQLite（node:sqlite，WAL 模式，单文件 /data/app.db）
```

选择理由：NAS 场景下进程越少越稳；巡检是"每天几次"的低频任务，不需要队列；崩溃后 `restart: unless-stopped` 拉起即可，状态全在 SQLite。

### 1.2 两条链路

**读取链路（用户操作）**

```
浏览器 → GET/POST /api/* → 鉴权中间件 → 路由 → 业务函数 → SQLite → JSON
                                            └→ 静态文件（public/）
```

**巡检链路（定时/手动）**

```
Scheduler.tick()
 └→ 找出到期站点（enabled=1 且 now ≥ nextRunAt）
     └→ 为站点开一个 batch
         └→ 逐页：fetch → 解码 → 提取正文 → 健康判定 → 指纹比对 → 写 checks/snapshots
             └→ 批次结束：比对上一状态 → 生成 events → 冷却判定 → 发汇总邮件
```

### 1.3 关键设计约束

| 约束 | 原因 |
| --- | --- |
| 单站点内页面**串行**，间隔 3 秒 | 不给目标站点压力，避免被判为爬虫 |
| 不同站点并发 ≤ 2 | 命中 NAS 小 CPU 的舒适区 |
| 每轮巡检**只发一封**邮件 | 用户看的是"这一轮有没有问题" |
| 任何判定都要带 `reasons[]` | 前端与邮件都要能解释"为什么" |
| 抓取失败**不做无限重试** | 失败即结论，避免放大对方压力 |

---

## 2. 目录结构

```
site-guard/
├── package.json              # 版本、scripts、唯一依赖 nodemailer
├── README.md                 # 面向使用者
├── CHANGELOG.md              # 版本历史 + 详细更新日志
├── doc/
│   ├── DESIGN.md             # 设计方案（为什么）
│   ├── PROJECT.md            # 开发技术文档（本文，怎么做）
│   ├── PROJECT_STATE.md      # 状态与交接（做到哪了）
│   ├── DEPLOY.md             # 部署手册
│   ├── TEST.md               # 测试文档
│   └── images/               # README 截图（由 prototype 渲染）
├── prototype/                # 纯静态界面原型（零依赖，可直接打开）
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── server.js             # [已实现] HTTP 入口、静态资源、安全头、优雅退出
│   ├── routes.js             # [已实现] API 路由、鉴权、序列化
│   ├── http.js               # [已实现] JSON 读写、错误映射、Cookie、同源校验
│   ├── db.js                 # [已实现] SQLite 建表/迁移与 store 函数
│   ├── auth.js               # [已实现] scrypt 密码、会话、登录限速
│   ├── validate.js           # [已实现] 站点/页面/密码校验
│   ├── schedule.js           # [已实现] 计划计算（时区/抖动/补跑）
│   ├── scheduler.js          # [已实现] tick、并发、补跑、手动触发
│   ├── runner.js             # [已实现] 轮次编排（页间间隔、批次进度）
│   ├── batches.js            # [已实现] 批次进度（内存）
│   ├── logger.js             # [已实现] JSON Lines 日志
│   ├── config.js             # [已实现] 环境变量与默认值
│   ├── fetch-page.js         # [已实现] 抓取与解码（重定向/超时/截断/GBK）
│   ├── extract.js            # [已实现] 标题/正文提取与归一化
│   ├── verdict.js            # [已实现] 健康判定规则引擎（R-01~R-15、R-07b）
│   ├── diff.js               # [已实现] sha256 指纹与行级差异
│   ├── checker.js            # [已实现] 单页巡检编排（快照/检测/事件/基线落库）
│   └── notify.js             # [已实现] 邮件设置、汇总模板、冷却与发送
├── public/
│   ├── index.html            # [已实现] 正式面板：四页签 + 登录/初始化覆盖层 + 各类弹窗
│   ├── style.css             # [已实现] 面板样式（含深色顶栏、状态徽标、弹窗、登录卡片）
│   └── app.js                # [已实现] 前端逻辑：API 对接、渲染、轮询、表单与错误映射
├── deploy/
│   └── Dockerfile            # [已实现] Docker 镜像构建（node:22-alpine，非 root + SQLite /data）
├── test/                     # node:test 用例
├── scripts/                  # 构建/打包/推送镜像脚本
└── tools/                    # 运维小工具（备份导出等）
```

> 约定：`prototype/` 是**设计确认用的原型**（假数据、带演示场景开关，不参与构建）；`public/` 才是真正交付的前端（四页签面板，直连真实 API）。0.8.0 起两者视觉一致，但只有 `public/` 会随 `.fpk` / 镜像交付。

---

## 3. 数据模型

SQLite，WAL，外键开启。时间统一存 **Unix 毫秒整数**（`INTEGER`），展示时按容器时区格式化。

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
-- 不启用外键：级联删除由 db.js 的 store 函数显式完成，删除顺序可控且便于单测

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
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  base_url        TEXT    NOT NULL,
  schedule_mode   TEXT    NOT NULL,           -- daily | interval
  schedule_value  TEXT    NOT NULL,           -- "09:00,21:00" | "6"
  timezone        TEXT    NOT NULL DEFAULT 'Asia/Shanghai',
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     INTEGER,
  next_run_at     INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id          INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  url              TEXT    NOT NULL,
  must_contain     TEXT    NOT NULL DEFAULT '[]',  -- JSON 字符串数组
  ignore_patterns  TEXT    NOT NULL DEFAULT '[]',  -- JSON 正则数组
  keywords         TEXT    NOT NULL DEFAULT '',    -- 逗号分隔
  enabled          INTEGER NOT NULL DEFAULT 1,
  state            TEXT    NOT NULL DEFAULT 'unknown', -- normal|suspect|bad|unknown
  changed          INTEGER NOT NULL DEFAULT 0,
  baseline_id      INTEGER REFERENCES snapshots(id) ON DELETE SET NULL,
  last_checked_at  INTEGER,
  last_message     TEXT    NOT NULL DEFAULT '',
  last_alert_at    INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pages_site ON pages(site_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,          -- baseline | check
  created_at INTEGER NOT NULL,
  hash       TEXT    NOT NULL,
  text       TEXT    NOT NULL,          -- 归一化后的正文
  meta       TEXT    NOT NULL DEFAULT '{}'  -- {httpCode, ms, finalUrl, title, textLen}
);

CREATE INDEX IF NOT EXISTS idx_snapshots_page ON snapshots(page_id, id DESC);

CREATE TABLE IF NOT EXISTS checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    TEXT    NOT NULL,
  page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  ran_at      INTEGER NOT NULL,
  verdict     TEXT    NOT NULL,          -- normal|suspect|bad|unknown
  http_code   INTEGER,
  response_ms INTEGER,
  final_url   TEXT,
  title       TEXT,
  text_len    INTEGER,
  changed     INTEGER NOT NULL DEFAULT 0,
  reasons     TEXT    NOT NULL DEFAULT '[]'   -- [{hit,text}]
);

CREATE INDEX IF NOT EXISTS idx_checks_batch ON checks(batch_id);
CREATE INDEX IF NOT EXISTS idx_checks_page ON checks(page_id, id DESC);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    TEXT,
  site_id     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  page_id     INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,          -- bad|suspect|unknown|changed|recovered|system
  message     TEXT    NOT NULL,
  notified    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events(id DESC);
```

### 3.1 保留策略

| 表 | 策略 |
| --- | --- |
| `snapshots(kind='check')` | 每页保留最近 60 份，超出按 id 升序删除 |
| `snapshots(kind='baseline')` | 永久保留（换基线时旧基线降级为 check 再由上面的规则回收） |
| `checks` | 保留 180 天 |
| `events` | 保留 180 天 |
| `sessions` | 每次启动与每小时清理过期 |

清理在 `scheduler` 的每日首轮巡检后执行，避免与巡检抢锁。

---

## 4. 检测引擎

### 4.1 抓取（`fetch-page.js`）

```js
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs); // 默认 20000

const res = await fetch(url, {
  redirect: 'follow',
  signal: controller.signal,
  headers: {
    'user-agent': `SiteGuard/${VERSION} (+self-hosted monitor)`,
    'accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6'
  }
});
```

规则：

| 项 | 约定 |
| --- | --- |
| 超时 | 20 秒（设置可调 5~60） |
| 重定向 | 跟随，最多 5 跳；记录 `finalUrl` |
| 响应体上限 | 5 MB，超出截断并记入理由 |
| 重试 | 仅对网络错误重试 1 次，间隔 5 秒；HTTP 5xx 不重试 |
| 状态码 | 记录但不作为唯一判据（见 4.3） |
| 编码 | 优先 `Content-Type; charset=`，其次 `<meta charset>`；`gbk/gb2312` 用 `TextDecoder('gbk')`（Node 22 自带 full-icu） |
| 失败分类 | `DNS` / `TIMEOUT` / `TLS` / `CONN` / `HTTP`，供邮件与界面显示 |

返回结构：

```js
{
  ok: true,
  status: 200,
  finalUrl: 'https://example.com/',
  contentType: 'text/html; charset=utf-8',
  html: '<html>…',
  responseMs: 238,
  truncated: false
}
// 或 { ok: false, error: 'TIMEOUT', message: '请求超时（20s）', responseMs: 20000 }
```

### 4.2 正文提取与归一化（`extract.js`）

顺序执行，任何一步都不抛错（异常输入返回空正文并标记）：

1. 取 `<title>`（去空白，最长 200 字）。
2. 删 `<!-- -->`、`<head>`、`<title>`（已单独提取）、`<script>`、`<style>`、`<noscript>`、`<svg>`、`<iframe>`、`<template>`。
3. 块级标签（`p div li tr h1~h6 section article header footer table ul ol br`）替换为换行，其余标签替换为空格。
4. 解码实体：`&nbsp; &amp; &lt; &gt; &quot; &#39;` 与 `&#数字;`。
5. 逐行 `trim` + 内部连续空白压缩为单空格，丢弃空行。
6. 应用忽略规则（编译好的 `RegExp[]`，逐行命中即丢弃整行）。
7. 输出 `{ title, text, lines, charCount, ignoredLines }`，`text = lines.join('\n')`；`charCount` 不含换行。

**为什么逐行过滤而不是整体正则替换**：逐行可以保证"被忽略的内容不会影响指纹"，同时不破坏上下文行号，便于差异展示。

### 4.3 健康判定（`verdict.js`）

判定是**规则集合**，每条规则返回 `{ level, reason }` 或 `null`，由聚合函数给出最终结论。

```js
export function evaluate(ctx) {
  const hits = RULES.map((rule) => rule(ctx)).filter(Boolean);
  const level = hits.some((h) => h.level === 'unknown') ? 'unknown'
    : hits.some((h) => h.level === 'bad') ? 'bad'
    : hits.some((h) => h.level === 'suspect') ? 'suspect'
    : 'normal';
  // level 一并落库，界面可分组显示“哪几条把它判成异常/无法确认”。
  return { verdict: level, reasons: hits.map((h) => ({ hit: true, level: h.level, text: h.reason })) };
}
```

> 优先级说明：`unknown`（反爬/需登录）最高，因为此时"判不出来"，不能冒充"异常"；其次是 `bad`，最后是 `suspect`。

`ctx` 字段：`fetch, url, baseUrl, html, title, text, charCount, baseline, mustContain`。`url` 是本次请求的页面地址，R-04/R-15 以它为参照，而不是站点首页。

| 规则 ID | 触发条件 | 结论 | 理由文案模板 |
| --- | --- | --- | --- |
| R-01 传输失败 | `fetch` 返回 `ok:false` | bad | `{失败分类}：{message}` |
| R-02 非 HTML | `content-type` 不含 `text/html` | bad | `返回类型为 {type}，不是网页` |
| R-03 5xx | `status >= 500` | bad | `服务器返回 {status}` |
| R-04 跨域跳转 | `finalUrl` 主机 ≠ 请求页面主机（`www` 归一化后） | bad | `被跳转到 {host}` |
| R-05 标题异常 | 标题为空，或命中 `404/500/502/503/Error/Forbidden/无法访问/该站点已暂停/建设中/维护` | bad | `页面标题变为「{title}」` |
| R-06 错误页特征 | 正文前 2000 字命中词库 | bad | `正文命中错误页特征：{word}` |
| R-07 正文近空白 | `charCount < 50` 且基线不短于 50 字 | bad | `正文仅 {n} 字，接近空白页` |
| R-07b 正文偏少 | `50 ≤ charCount < 200` 且基线不短于 200 字 | suspect | `正文仅 {n} 字，内容偏少` |
| R-08 正文骤降 | `charCount < baseline * 0.3` | bad | `正文由 {base} 字降至 {n} 字` |
| R-09 关键断言缺失 | `mustContain` 中任一字符串不在正文 | bad | `缺少必须包含的文字「{s}」` |
| R-10 反爬挑战 | 命中 `just a moment`、`checking your browser`、`verify you are human`、`验证您是否为真人`、`请开启 javascript`、`cf-chl` | unknown | `疑似反爬挑战页（{word}），无法确认内容` |
| R-11 需要登录 | `finalUrl` 含 `/login|/signin` 或正文含 `请登录后查看` | unknown | `页面要求登录，无法确认内容` |
| R-12 SPA 空壳 | `charCount < 200` 且 HTML 含 `<div id="app"`/`__NEXT_DATA__`/`<div id="root"` | unknown | `该页依赖 JS 渲染，抓取到的是空壳` |
| R-13 响应缓慢 | `responseMs > 10000` | suspect | `响应耗时 {ms}ms，超过 10 秒` |
| R-14 正文下降 | `0.3 ≤ n/base < 0.6` | suspect | `正文较基线下降 {pct}%` |
| R-15 同域跳转 | 与请求地址主机相同但路径变化 | suspect | `被重定向到 {path}` |

错误页词库（内置，可在设置中追加）：`bad gateway`、`service unavailable`、`502 bad gateway`、`404 not found`、`页面不存在`、`该域名已过期`、`域名未绑定`、`站点已被暂停`、`该站点已暂停`、`数据库连接失败`、`连接数据库失败`、`internal server error`、`access denied`、`forbidden`、`站点建设中`、`网站维护中`、`服务器错误`。

规则顺序不影响结论（聚合时按优先级），但影响 `reasons` 的展示顺序，按上表顺序输出。

两条实现上的取舍：

- **为什么 R-07 从 200 改成 50 + R-07b**：`example.com` 这类真实但简短的页面只有 156 字，200 字一刀切会把它永久判坏，而且无法建立基线（`bad` 不能当基线），只能每天报同一个假异常。现在 50 字以下才是空白页，50~199 字降为可疑；基线本身不足 200 字时不再套用阈值。
- **为什么 R-04/R-15 以 `url` 为参照**：一个站点通常有 `/list`、`/post/1` 这类页面，拿首页做参照会让每个子路径页都被判“被重定向”。

### 4.4 指纹与差异（`diff.js`）

```js
const hash = sha256(text);          // hex，64 字符
const changed = baseline && baseline.hash !== hash;
```

差异算法（多重集合差集，O(n)）：

1. 统计旧文本与新文本每行的出现次数。
2. 逐行对比计数差，得到 `removed`（旧多出的行）与 `added`（新多出的行）。
3. 按原文本中的出现顺序输出，各截断 200 行并标记 `truncated`。

> 不做 LCS：博客/列表页动辄数千行，LCS 在 O(n·m) 下会拖垮 NAS；集合差集足以回答"多了什么、少了什么"，且不受段落重排影响。

### 4.5 判定与变化的组合

| verdict | changed | 事件类型 | 邮件措辞 |
| --- | --- | --- | --- |
| bad | * | `bad` | 🔴 页面异常（附判定理由，不再说"内容变了"） |
| suspect | * | `suspect` | 🟠 页面可疑 |
| unknown | * | `unknown` | ⚪ 无法确认（疑似反爬/需登录） |
| normal | true | `changed` | 🟡 内容变更（附差异） |
| normal | false | 无事件 | 不发信 |

基线与事件的两条补充约定（0.5.0 实现）：

- **首次成功抓取**：`normal` 或 `suspect` 都建立基线（慢响应、正文偏少只影响健康结论，内容本身可信）；`bad/unknown` 绝不建基线，否则错误页/反爬页会成为“标准答案”。建基线时记一条 `system` 事件。
- **新页面首次判 `unknown`**：新页 `state` 初始就是 `unknown`，不能据此认定“持续无变化”；只要本轮结论不是 `normal` 就记事件。
- **确认基线**：页面详情里的「设为基线」只接受 `normal/suspect` 快照，拒绝 `bad/unknown`。

---

## 5. 调度器（`schedule.js` + `scheduler.js`）

### 5.1 下次运行时间

```js
// daily: "09:00,21:00"
function nextDaily(now, times, timezone) {
  const today = fmtInZone(now, timezone);           // 用 Intl.DateTimeFormat 取当地日期
  const candidates = times.map((t) => toUtc(today, t, timezone)).filter((ts) => ts > now);
  return candidates.length ? Math.min(...candidates) : toUtc(nextDay(today), times[0], timezone);
}

// interval: "6"（小时）
function nextInterval(now, lastRunAt, hours) {
  return (lastRunAt ?? now) + hours * 3600_000;
}
```

时区实现：**不使用系统本地时区**，统一用 `Intl.DateTimeFormat('en-CA', { timeZone })` 取当地日期与时刻，再用固定偏移换算时间戳。这样容器 `TZ` 配错也不会算错（但邮件里展示的时间仍按 `TZ`）。

### 5.2 抖动

```js
const jitterMs = (hashInt(String(site.id)) % 180 - 90) * 1000; // ±90s，站点级稳定
const due = now >= site.next_run_at + jitterMs;
```

站点级固定偏移保证"同一站点每天同一分钟"，便于用户预期；不使用全局随机。

### 5.3 补跑

启动时（以及每小时）：

```js
const overdue = site.last_run_at && (now - site.last_run_at) > periodMs(site) * 1.5;
if (overdue) runSite(site, { catchup: true });
```

补跑只跑一次，邮件标题追加 `[补跑]`，且不改变 `next_run_at` 的既有节奏（重新计算为下一个未来时刻）。

### 5.4 并发与守卫

```js
const running = new Set();      // siteId
let active = 0;                 // 全局并发
const MAX_CONCURRENCY = 2;
```

- 同一站点绝不并发（用户手动点"立即巡检"时，若在跑则返回 409）。
- 全局最多 2 个站点同时巡检；排队按 `next_run_at` 升序。
- 每页之间 `await sleep(gapMs)`（默认 3000），可通过设置调整 1~60 秒。
- 单站点每天最多 24 轮：超过则跳过并在事件里记 `system`。

### 5.5 批次

```js
const batchId = `${site.id}-${Date.now()}`;
```

`checks.batch_id` 与 `events.batch_id` 共用，前端"本轮巡检"视图与邮件汇总都按此聚合。批次状态保存在内存 Map（最多 20 条），供前端轮询；进程重启后丢失，前端回退到读 `checks`。

---

## 6. 告警（`notify.js`，已实现）

### 6.1 事件生成

批次结束时逐页比较 `page.state` 与本次 `verdict`：

| 变化 | 事件 | 是否发信 |
| --- | --- | --- |
| 首次抓取成功（无基线） | `system`（已建立基线） | 否 |
| 新页首次判出 unknown（`last_checked_at` 为空） | `unknown` | 是 |
| normal → bad/suspect/unknown | 对应类型 | 是 |
| 任意 → normal（此前非 normal） | `recovered` | 是（不受冷却限制） |
| normal 且 changed | `changed` | 是 |
| bad → bad（持续） | 无新事件 | 否 |
| 内容变更仍在冷却窗口内 | 事件照常记录 | 否（事件保留，只是不发信） |

冷却：`now - page.last_alert_at < cooldownHours * 3600_000` 时抑制发信，默认 6 小时。

> 实现取舍：冷却生效在“发信”层，而不是“建事件”层。事件流是事实记录，热却只决定要不要打扰邮箱；否则用户在界面上会看不到刚刚发生的变化。

### 6.2 邮件结构

```
主题：[网站哨兵] 🔴 2 个页面异常 · 1 个页面内容变更 · 示例科技官网
      （仅有可疑时为 🟠，仅有变更时为 🟡，均无异常时用中性措辞）
正文（纯文本 + 简易 HTML 双版本）：
  巡检时间：2026-10-25 09:00（Asia/Shanghai）
  站点：示例科技官网（https://www.example.com/）

  ── 异常（2）────────────────────────────
  1) 主页  https://www.example.com/
     HTTP 200 · 1180ms · 正文 180 字（基线 12,480）
     判定：标题变为「502 Bad Gateway」；正文命中错误页特征 Bad Gateway
  2) 博客首页  https://blog.example.com/
     连接超时（20s），重试 1 次仍失败

  ── 可疑（1）────────────────────────────
  3) 产品列表页 …正文较基线下降 52%

  ── 内容变更（1）────────────────────────
  4) 文章详情页 … 新增 2 行、删除 1 行
     - 本次发布会将于 11 月 8 日举行…
     + 加微信 abc8866 领取内部资料…

  ── 已恢复（1）──────────────────────────
  5) 帮助中心 … 已恢复（403 → 200）

  查看面板：http://192.168.1.10:8686
  本轮为 09:00 计划巡检；下一轮 21:00。
```

约束：

- 单封邮件正文 ≤ 200 KB；超出时每段截断并在末尾注明"完整内容请到面板查看"。
- 不发外链图片、不用 CSS 布局，保证邮件客户端兼容。
- 发信失败**重试 2 次**（1 分钟、5 分钟），仍失败则写 `events(notified=0)` 并在界面顶部提示"最近一次告警发送失败"。

### 6.3 SMTP 错误映射（已实现）

| 错误码 | 展示 |
| --- | --- |
| `EAUTH` / `535` | 授权码或密码错误（QQ/163 需使用授权码，不是登录密码） |
| `ETIMEDOUT` / `ECONNECTION` | 连不上服务器，检查地址与端口/加密方式 |
| `ESOCKET` + 自签证书 | 证书校验失败，可勾选"忽略证书错误" |
| `550` | 发件地址被拒绝，检查发件人是否与账号一致 |

### 6.4 实现说明（0.6.0）

**设置存储**（`settings` 表，接口读写时密码永不出库）：

| 键 | 含义 | 默认 |
| --- | --- | --- |
| `mail_enabled` | 是否启用告警 | `0` |
| `smtp_host` / `smtp_port` | 服务器与端口 | 空 / `465` |
| `smtp_secure` | `ssl` / `starttls` / `none` | `ssl` |
| `smtp_user` / `smtp_pass` | 账号与授权码 | 空 |
| `mail_from` / `mail_to` | 发件人；收件人逗号分隔（≤10） | 空 |
| `alert_cooldown_hours` | 同类内容变更冷却 | `6` |
| `panel_url` | 邮件里的面板链接（可选） | 空 |

**一轮巡检的发信流程**：

1. `runner` 跑完页面，`checker` 写入事件（`notified=0`）。
2. 调度器先回写 `last_run_at/next_run_at` 并把批次标为 `done`（SMTP 重试可能长达数分钟，不能把批次卡在“运行中”）。
3. 调 `notifyBatch({ site, batchId, nextRunAt, trigger })`：取本批次事件 → 过滤冷却中的 `changed` → 组装一封汇总。
4. 成功：`UPDATE events SET notified=1`，并把“变更类页面”的 `last_alert_at` 推进到本次发送时刻。
5. 失败：按 `[60s, 300s]` 重试 2 次；仍失败则写一条 `system` 事件（“告警邮件发送失败：…”）并保留 `notified=0`。
6. 批次日志追加“已发送汇总邮件（N 条事件）”或“未发送邮件：原因”；`notified=0` 的事件下轮仍可再发。

**边界**：

- 单页复检（`POST /api/pages/:id/run`）不建批次、不发信，避免手动点击刷屏；事件仍入库，可在事件流看到。
- 没有任何可通知事件（例如首次建基线只有 `system`）时不发信。
- 测试邮件只发一封、不重试，失败直接把可读原因返回给界面；密码在错误文案中统一替换为 `******`。
- 邮件正文上限 180 KB，超出截断并提示到面板查看。

---

## 7. Web 层

### 7.1 路由表

> **0.6.0 实现状态**：表中接口全部可用。`pages/:id/run` 会真实抓取该页并返回判定结果，单页复检写检测记录与事件（不建批次、不发信）；`GET /api/events` 支持 `type`、`siteId`、`limit`（≤200）、`offset`，返回 `{ items, total, limit, offset }`；设置接口的 `password` 只写不读，留空表示保留原值。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/` | 否 | 返回 `public/index.html`（前端自行判断是否已登录） |
| GET | `/api/state` | 否 | `{ needSetup, loggedIn, version }` |
| POST | `/api/setup` | 否 | 首次设置密码（已设置则 409） |
| POST | `/api/login` | 否 | 登录，限速 |
| POST | `/api/logout` | 是 | 销毁会话 |
| GET | `/api/overview` | 是 | 统计、需处理清单、最近事件、下一轮时间 |
| GET | `/api/sites` | 是 | 站点 + 页面 + 最近一次判定 |
| POST | `/api/sites` | 是 | 新建站点 |
| PATCH | `/api/sites/:id` | 是 | 修改站点（名称/地址/计划/启用） |
| DELETE | `/api/sites/:id` | 是 | 删除站点（级联删除页面/快照/事件） |
| POST | `/api/sites/:id/run` | 是 | 手动巡检，返回 `{ batchId }`；已在跑返回 409 |
| GET | `/api/batches/:id` | 是 | 批次进度与日志行（前端轮询） |
| POST | `/api/sites/:id/pages` | 是 | 新增页面 |
| PATCH | `/api/pages/:id` | 是 | 修改页面 |
| DELETE | `/api/pages/:id` | 是 | 删除页面 |
| POST | `/api/pages/:id/run` | 是 | 单页巡检 |
| GET | `/api/pages/:id/detail` | 是 | 判定详情（含最近一次 reasons 与抓取事实） |
| GET | `/api/pages/:id/diff` | 是 | 基线 vs 最近一次快照的差异 |
| POST | `/api/pages/:id/accept` | 是 | 设为新基线 |
| GET | `/api/events` | 是 | 事件列表（分页 + 类型/站点筛选） |
| GET | `/api/settings` | 是 | 设置（密码脱敏） |
| PUT | `/api/settings` | 是 | 保存设置 |
| POST | `/api/settings/test-mail` | 是 | 发送测试邮件 |
| GET | `/api/health` | 否 | `{ ok, version, db, lastRunAt }`（容器 healthcheck 用） |

### 7.2 请求处理约定

```js
// 统一 JSON 响应
{ ok: true, data: … }                 // 成功
{ ok: false, error: { code, message, fields? } }  // 失败
```

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 字段校验失败，`fields` 指出具体字段 |
| 401 | `UNAUTHORIZED` | 未登录或会话过期 |
| 403 | `FORBIDDEN` | Origin 不合法 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 已初始化 / 巡检进行中 |
| 429 | `RATE_LIMITED` | 登录失败过多 |
| 500 | `INTERNAL` | 未捕获异常（日志记录堆栈，响应不含堆栈） |

### 7.3 鉴权

- 密码：`scrypt(password, salt, 64)`，`salt` 16 字节随机；存储 `scrypt$<salt>$<hash>`。校验用 `timingSafeEqual`。
- 会话：32 字节随机 token，**库里只存 sha256**；Cookie `sg_sid=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`。
- 首次设置：仅当 `settings.admin_password` 为空时允许 `POST /api/setup`，成功后自动登录。
- 登录限速：同 IP 5 分钟窗口内失败 8 次 → 429；成功后清零。
- 会话清理：启动时 + 每小时删除 `expires_at < now`。

### 7.4 输入校验（服务端为准，前端只为体验）

| 字段 | 规则 |
| --- | --- |
| `name` | 1~40 字符，去首尾空格 |
| `base_url` / `url` | 必须 `http://` 或 `https://`，长度 ≤ 2048；不接受其它协议 |
| `schedule_mode` | 枚举 `daily` / `interval` |
| `schedule_value` | daily：1~4 个 `HH:MM`；interval：`1,2,3,4,6,8,12,24` 之一 |
| `must_contain` | 数组，≤ 10 项，每项 ≤ 100 字 |
| `ignore_patterns` | 数组，≤ 50 条，每条必须能被 `new RegExp()` 编译 |
| `keywords` | 逗号分隔，≤ 30 项，每项 ≤ 20 字 |
| `interval`/`timeout`/`gap`/`cooldown` | 整数且在各自区间内 |

> 前端与后端共用同一套规则常量（`src/validate.js` 导出，前端在 `public/app.js` 里保持同值），避免"前端拦住了、后端没拦"。

### 7.5 安全

| 风险 | 处理 |
| --- | --- |
| SQL 注入 | 全部使用 `db.prepare(...).run/get/all` 参数绑定，禁止字符串拼接 SQL |
| XSS | 前端输出一律走 `escapeHtml()`；后端不返回 HTML 片段 |
| CSRF | `SameSite=Strict` + 非 GET 请求校验 `Origin`（存在且不等于本机 Origin 则 403） |
| SSRF | 允许私网地址（自托管常监控内网），但在文档与界面明示风险；禁止 `file://` 等协议 |
| 目录穿越 | 静态资源按白名单文件名返回，不拼接用户路径 |
| 凭据泄露 | SMTP 密码仅在写入时可读，读取一律返回 `"******"`；日志不打印密码与 Cookie |
| 容器权限 | 非 root 运行、不挂 `docker.sock`、监测目录只读 |

### 7.6 前端

- 无框架、无构建：`public/index.html` + `app.js` + `style.css`，由 `prototype/` 演进而来（原型仅作设计参考）。
- API 基址推导：`/app/<name>/` 网关路径取 `/app/<name>/api`，直连取 `/api`；静态资源用相对路径，同源部署天然成立。
- 登录态：`GET /api/state` 决定「初始化 / 登录 / 进入面板」；任何接口返回 401 都会弹出登录覆盖层并提示「登录状态已过期」。
- 视图切换通过 `hidden` 属性 + `aria-selected`；顶栏「退出登录」调 `POST /api/logout` 并清空本地状态。
- 数据获取：`GET /api/sites`、`/api/overview`、`/api/events?limit=200` 并行刷新；未巡检页面显示「未巡检」并排除在异常/待确认统计外。
- 巡检进行中：`POST /api/sites/:id/run` 拿 `batchId`，每 800ms 轮询 `GET /api/batches/:id`，展示进度条与日志；批次结束按 `summary.verdicts` 汇总提示并刷新全量数据。单页复检走 `POST /api/pages/:id/run`（同步返回结果）。
- 弹窗与校验：站点/页面/邮件表单提交前做本地校验，后端 `fields` 错误按字段回填到对应输入框；删除、设为基线均有二次确认。
- 未实现的能力不做假控件：告警策略、巡检参数、修改密码、导出备份等后端没有接口的表单已从界面移除。
- 每 60 秒静默刷新一次，页面隐藏、弹窗打开、巡检运行中、未登录时跳过。

---

## 8. 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8686` | 监听端口 |
| `DATA_DIR` | `/data` | SQLite 与附件目录 |
| `TZ` | `Asia/Shanghai` | 展示与调度时区 |
| `LOG_LEVEL` | `info` | `debug/info/warn/error` |
| `FETCH_TIMEOUT_MS` | `20000` | 单页超时（5~60 秒） |
| `FETCH_MAX_BYTES` | `5242880` | 响应体上限，超出截断并标记 |
| `FETCH_RETRIES` | `1` | 网络错误重试次数，`0` 关闭 |
| `FETCH_RETRY_DELAY_MS` | `5000` | 重试前等待 |
| `PAGE_GAP_MS` | `3000` | 同站页面之间的间隔，允许 `0` |
| `SCHEDULER_TICK_MS` | `20000` | 调度器检查间隔 |
| `MAX_CONCURRENCY` | `2` | 同时巡检的站点数上限 |
| `MAX_PAGES_PER_SITE` | `30` | 单站点页面上限 |
| `ALLOW_PRIVATE_TARGETS` | `true` | 是否允许抓取 127.0.0.1/内网地址 |

界面内可改的项（存 `settings` 表）：SMTP 全部参数、告警冷却、面板地址。页面间隔、并发数、时区属于进程级配置，只能通过环境变量设置（`PAGE_GAP_MS` / `MAX_CONCURRENCY` / `TZ`）。

---

## 9. 可观测性

- 日志：JSON Lines 输出到 stdout，容器 `docker logs` 可读。
  ```json
  {"ts":"2026-10-25T01:00:01.234Z","level":"info","event":"check.page","site":1,"page":11,"verdict":"bad","status":200,"ms":1180,"changed":false}
  ```
- 关键事件：`scheduler.tick`、`site.run.start`、`check.page`、`batch.finish`、`mail.send`、`mail.fail`、`auth.login.fail`。
- `/api/health` 返回 `{ ok, version, db: 'ok', lastRunAt }`，Docker healthcheck 每 60 秒探测。
- 心跳：超过 2 个计划周期无任何巡检记录 → 生成 `system` 事件并尝试发信（说明监测自己可能挂了）。

---

## 10. 测试策略

| 层级 | 工具 | 覆盖 |
| --- | --- | --- |
| 单元 | `node:test` | 归一化、差异、判定规则、调度时间计算、输入校验 |
| 集成 | `node:test` + 本地 HTTP fixture | 抓取→判定→入库全链路；错误页/空白页/挑战页/慢响应/跨域跳转 |
| 邮件 | 本地 SMTP stub | 主题分级、汇总、冷却、失败重试 |
| 接口 | `node:test` + `fetch` | 鉴权、校验、错误码、并发巡检 409 |
| 界面 | 浏览器 + 原型 | 四页签、三态、表单校验、进度与日志 |

测试用例与实测记录见 [TEST.md](TEST.md)。

---

## 11. 编码规范

- ESM（`"type": "module"`），2 空格缩进，单引号，语句以分号结尾（与 `src/*.js` 一致）。
- 中文注释，写"为什么"而不是"做了什么"。
- 禁止吞异常：捕获后必须要么记录日志并转成用户可读错误，要么继续抛出。
- 所有对外字符串走 `escapeHtml`；所有 SQL 走参数绑定。
- 一个文件一个关注点，单文件不超过 400 行为宜。
- 提交信息中文，格式：`类型: 做了什么`（如 `feat: 增加站点巡检批次`）。

---

## 12. 性能与资源预算

| 指标 | 目标 |
| --- | --- |
| 常驻内存 | < 100 MB（10 个站点 × 5 页） |
| 单页抓取耗时 | 正常 < 2 s；超时上限 20 s |
| 一轮巡检（10 页） | < 40 s（含 3 s 页间隔） |
| SQLite 体积 | 每年 < 200 MB（60 份/页 + 180 天事件） |
| 镜像体积 | 90~120 MB |

---

## 13. 后续扩展（不在 MVP）

| 扩展 | 影响面 |
| --- | --- |
| Headless 渲染（Playwright） | 新增容器层与 300MB 镜像，判定规则不变 |
| 指定区块比对（CSS 选择器） | `pages` 加 `region_selector`，提取层多一步 |
| 登录态抓取（Cookie/表单） | `pages` 加 `auth_profile`，抓取层加凭据管理 |
| 图片指纹/截图比对 | 新增 `image_hash` 存储，判定加规则 |
| Bark/企业微信/Telegram | 通知适配器接口化，`notify.js` 加渠道 |
| 目录文件完整性 | 复用 `checks/snapshots`，新增 `dir` 类型与只读挂载 |
