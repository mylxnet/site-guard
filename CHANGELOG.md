# 更新日志

本项目的所有重要改动都记录在此文件。版本号遵循 `主版本.次版本.修订号`，每轮改动递增修订号或次版本号。

## 版本历史速览

| 版本 | 日期 | 一句话 |
| --- | --- | --- |
| [0.8.5](#085---2026-10-26) | 2026-10-26 | 概览页「需要处理」与「最近事件」由左右并列改为上下全宽 |
| [0.8.4](#084---2026-10-26) | 2026-10-26 | 手机端修复：页签不再塌陷消失，页面表格改卡片、操作按钮不再跑出屏幕 |
| [0.8.3](#083---2026-10-26) | 2026-10-26 | 忽略规则改为即时生效：比对前用当前规则过滤基线，无需重建基线 |
| [0.8.2](#082---2026-10-26) | 2026-10-26 | 修复飞牛网关改写 Host 导致初始化/登录报「跨站请求被拒绝」 |
| [0.8.1](#081---2026-10-26) | 2026-10-26 | 修复飞牛桌面入口无尾斜杠时 CSS/JS 404（注入 `<base>`） |
| [0.8.0](#080---2026-10-26) | 2026-10-26 | 正式前端面板落地：四页签接入真实 API，替代原状态页 |
| [0.7.3](#073---2026-10-26) | 2026-10-26 | 实机验收通过：.fpk 安装问题闭环，升版重打包并重推镜像 |
| [0.7.2](#072---2026-10-26) | 2026-10-26 | 修复 .fpk 安装报「包格式不符合系统版本要求」：移除 wizard 文件 |
| [0.7.0](#070---2026-10-25) | 2026-10-25 | 飞牛 fnOS 原生应用：包目录、生命周期脚本、内置 Node 运行时、一键出 .fpk |
| [0.6.0](#060---2026-10-25) | 2026-10-25 | 邮件告警：批次汇总、冷却、恢复补发、事件流与设置接口 |
| [0.5.0](#050---2026-10-25) | 2026-10-25 | 检测引擎：抓取、正文归一化、四档判定、基线与差异 |
| [0.4.0](#040---2026-10-25) | 2026-10-25 | 后端骨架：HTTP 服务、鉴权、站点/页面 API、调度器 |
| [0.3.1](#031---2026-10-25) | 2026-10-25 | 补齐全套技术文档与界面截图 |
| [0.3.0](#030---2026-10-25) | 2026-10-25 | 界面 demo 按 MVP 重做：站点/页面、日程、四档判定 |
| [0.2.2](#022---2026-10-25) | 2026-10-25 | MVP 方案定稿：内容优先判定、汇总邮件 |
| [0.2.1](#021---2026-10-25) | 2026-10-25 | 澄清文件监测能力边界（需授权） |
| [0.2.0](#020---2026-10-25) | 2026-10-25 | 首个可点界面原型（四页签 + 三态） |
| [0.1.0](#010---2026-10-25) | 2026-10-25 | 项目初始化、环境搭建、需求与方案 |

---

## 详细更新日志（按版本倒序）

### 0.8.5 - 2026-10-26

**背景**：桌面版概览页把「需要处理」和「最近事件」放在左右两栏，两栏互相挤压，事件列表偏窄，阅读顺序也别扭。

**调整**
- `.overview-grid` 固定为单列（`grid-template-columns: minmax(0, 1fr)`），两张卡片上下排列、等宽，并与上方统计卡片左右对齐；删除 980px 下重复的单列覆盖规则。
- 手机端（≤720px）原本就是上下排列，本次无变化。

**验证**
- Chrome DevTools 1280×800：grid 单列宽 1132px；「需要处理」y=139、高 116px，「最近事件」y=267（间距 12px），左对齐、等宽。
- 小屏复核：仍为上下排列，`document.scrollWidth` 未超视口，无横向滚动。
- `npm test` 115 条全绿（本次为纯 CSS 改动，未新增用例）。

**文档**
- 版本号统一 0.8.5；文档同步 README 当前阶段、PROJECT_STATE、DESIGN 计划表、PROJECT 状态说明、DEPLOY 版本表与打包示例、TEST 新增 3.9、DEBUG_FPK 当前状态。

**交付**
- 已出 x86/arm 两个 `.fpk`（`siteguard-0.8.5-x86.fpk` 45,297,387 字节 / `siteguard-0.8.5-arm.fpk` 45,418,806 字节），构建并推送 ACR 镜像 `0.8.5` + `latest`（digest `sha256:065a50e9…`），发布 `tag v0.8.5` 与 GitHub Release（见 PROJECT_STATE §8）。

### 0.8.4 - 2026-10-26

**背景**：手机（390×844）打开面板时有两处功能不可用：顶部页签在内容超过一屏后整条消失（实测高度仅 1px，无法切页）；监测页的页面表格宽 720px，超出 360px 容器，「详情 / 差异 / 编辑 / 删除」四个操作按钮完全落在屏幕外。

**修复**
- `.tabs` 增加 `flex: none`。根因是 `body` 为纵向 flex 且 `min-height: 100vh`，`.tabs` 因 `overflow-x: auto` 的 `min-height` 被算作 0，内容超高时被压缩成 1px。修复后 390px 宽实测高度 42.9px。
- `max-width: 720px` 下把页面表格改为卡片：每行一张小卡，页面名/URL 与判定、上次巡检时间组成头部，判定理由单独一行，操作按钮换行到卡片底部；隐藏 `colgroup` 与 `thead`，取消横向滚动。

**验证**
- Chrome DevTools 设备模拟 390×844×3（mobile + touch）：表格宽 360px = 容器宽，`document.scrollWidth = 390`（无横向滚动）；四个按钮 x 区间 29–80 / 88–139 / 147–198 / 206–257，全部在视口内。
- 桌面 1280×800 复核无回归：表格仍为 `display: table`、`thead` 仍为 `table-header-group`、表格宽 1130px = 容器宽。
- `npm test` 115 条全绿（本次为纯 CSS 改动，未新增用例）。

**边界**
- 事件日志表（`.data-table`）仍保留表格形态、可按需横向滑动，未做卡片化；本次只处理导致功能不可用的页面表格。

**调整**
- 版本号统一 0.8.4；文档同步 README 当前阶段、PROJECT_STATE、DESIGN 计划表、PROJECT 状态说明、DEPLOY 版本表与打包示例、TEST 新增 3.8 与视口版本、DEBUG_FPK 当前状态。
- 已出 x86/arm 两个 `.fpk`、构建并推送 ACR 镜像 `0.8.4` + `latest`，发布 `tag v0.8.4` 与 GitHub Release（见 PROJECT_STATE §8）。

### 0.8.3 - 2026-10-26

**背景**：忽略规则只在抓取时过滤当前文本，基线里存的仍是未过滤的旧正文。新增或修改忽略规则后，哈希与差异两侧不对称，必须点一次「设为新基线」才会安静下来。本轮改为比对前用当前规则重新过滤基线。

**修复**
- 比对前用**当前忽略规则**把基线正文再过滤一遍（`baselineText`）；`contentChanged` 改用过滤后基线哈希比较，`diffLines(baselineText, extracted.text)` 两侧对称。
- 喂给 R-08/R-14 的基线字数也改为过滤后字数，避免新增规则误判「正文骤降」/「正文下降」。
- 旧基线原文不被改写：删掉规则后比对结果可恢复。

**优化**
- `src/extract.js` 新增导出 `filterIgnoredLines(lines, patterns)` 与 `applyIgnorePatterns(text, patterns)`，`extractHtml` 复用前者（行为不变）。
- 改忽略规则立即生效，不再需要点「设为新基线」。

**测试**
- `test/checker.test.js` 新增 3 条用例（过滤后基线哈希比较、差异行来自过滤后基线、R-08 基线字数按过滤后计算），全部测试 112 → 115 条全绿。

**边界**
- 规则若误过滤真实内容，会同时作用于当前文本与基线，差异中看不出来（可能掩盖变化）；配置时需先用差异预览校准。

**调整**
- 版本号统一 0.8.3；文档同步 README 当前阶段与用例数、PROJECT_STATE 坑 6、TEST 3.7、DEPLOY 版本表、DESIGN 计划表、PROJECT 状态说明、DEBUG_FPK 当前状态。

### 0.8.2 - 2026-10-26

**背景**：0.8.1 的包在飞牛实机安装后页面能正常显示，但输入两次密码提交初始化时报「跨站请求被拒绝」。根因是飞牛统一网关反向代理到 Unix Socket 时改写了 `Host`（浏览器 `Origin` 是 NAS 地址，服务端看到的 `Host` 是转发后的地址），`assertSameOrigin` 比对两者天然对不上，因此把所有写操作都判成跨站。

**修复**
- 前端每个 API 请求统一带自定义头 `x-siteguard-client: 1`，表示「这是同源页面发出的请求」；服务端 `assertSameOrigin` 见到该头即跳过 `Origin`/`Host` 比对。
- 跨站表单无法伪造自定义头；跨站 `fetch` 加自定义头会触发预检，而本服务不返回 CORS 头，浏览器会直接拦下。因此 CSRF 防御强度不降反升。
- 不带该头的请求仍按原逻辑严格比对 `Origin` 与 `Host`/`X-Forwarded-Host`，`ALLOWED_ORIGINS` 白名单继续生效。

**验证**
- `npm test`：112 条全过（新增「带 `x-siteguard-client` 放行、缺头仍 403」用例）。
- curl 对照：网关模式裸前缀下，不带自定义头返回 403「跨站请求被拒绝」，带后返回 200 并下发 `sg_sid`。
- 浏览器实测（`GATEWAY_PREFIX=/app/siteguard`、访问裸前缀 `/app/siteguard`、密码 `Test12345678`）：初始化与登录均成功，无跨站报错，控制台无报错。

**调整**
- 版本号统一 0.8.2；重出 `dist/fnos/siteguard-0.8.2-x86.fpk` / `-arm.fpk`；重建镜像并推送阿里云 ACR（`0.8.2` / `latest`）。
- 文档同步：README 当前阶段、PROJECT_STATE 坑 5/限制/记录、TEST 3.6 实测、DEPLOY 版本表与产物名、DEBUG_FPK 当前状态、DESIGN 计划表、PROJECT 状态说明。

### 0.8.1 - 2026-10-26

**修复**
- 飞牛桌面入口配置为 `"url": "/app/siteguard"`（无尾斜杠），浏览器把页面里的相对路径 `style.css` / `app.js` 解析成 `/app/style.css`、`/app/app.js`；网关只转发 `/app/siteguard/*`，于是两个资源都 404，面板变成无样式的裸 HTML（登录表单也因 JS 未执行而不显示）。
- 修复方式：返回 HTML 时按请求路径注入 `<base href="/app/siteguard/">`（直连调试注入 `<base href="/">`），相对资源自然落到网关前缀下；CSP 的 `base-uri 'none'` 相应改为 `'self'`（仍限同源）。
- 新增回归断言：网关前缀入口（带/不带尾斜杠）、SPA 兜底页面返回的 HTML 必须含正确的 `<base>`；直连模式为 `<base href="/">`；网关模式 CSP 含 `base-uri 'self'`。

**验证**
- `npm test`：111 条全过。
- 浏览器实测（本地以 `GATEWAY_PREFIX=/app/siteguard` 启动，访问不带尾斜杠的 `/app/siteguard`）：`document.baseURI` 正确、样式表加载成功、body 背景 `rgb(245,246,248)`、登录与四页签布局正常、控制台无报错。

**调整**
- 版本号统一 0.8.1；重出 `dist/fnos/siteguard-0.8.1-x86.fpk` / `-arm.fpk`；重建镜像并推送阿里云 ACR（`0.8.1` / `latest`）。
- 文档同步：README 当前阶段与镜像示例、PROJECT_STATE 坑 4/限制/记录、TEST 网关 `<base>` 用例与实测、DEPLOY 版本表与产物名、DEBUG_FPK 当前状态、DESIGN 计划表。

### 0.8.0 - 2026-10-26

**背景**：0.7.3 的 `.fpk` 实机装完后，打开仍是深色背景的「接口清单状态页」。根因不是打包或网关，而是正式前端 `public/` 只有一个占位状态页，四页签一直停留在 `prototype/`（假数据、不参与构建）。本轮把原型按真实 API 重写并落进 `public/`，让安装包交付的界面就是设计里的面板。

**新增**
- `public/app.js`（约 1000 行）：同源 API 基址推导（直连 `/api`、网关 `/app/<name>/api`）、初始化/登录/退出、站点与页面 CRUD、巡检批次轮询（800ms）与实时日志、判定详情、行级差异、设为基线、事件流、邮件设置与测试邮件、60 秒静默刷新。
- `public/index.html`：四页签面板 + 登录/初始化覆盖层 + 站点/页面/详情/差异/删除弹窗；页脚与设置页版本号、`by Mr lin` 署名。
- `public/style.css`：面板样式 + 登录卡片 + 未巡检态灰色圆点（`.verdict.plain`）。

**优化**
- 未巡检页面显示「未巡检」，不计入异常/待确认统计，避免新加页面被误报。
- 设置页只保留后端真实支持的邮件字段；测试邮件改为「先保存再测试」，避免用旧配置发信。
- 巡检运行中禁用重复触发按钮；弹窗内按钮顺序统一为「取消 → 主操作」。

**修复**
- 网关静态资源断言随 `app.js` 落地更新：`/app/siteguard/app.js` 由「必须 404」改为 200，另用 `/app/siteguard/missing-asset.js` 验证缺失资源仍 404。

**调整**
- 版本号统一同步至 0.8.0：`package.json`、`package-lock.json`（两处）、`fnos/siteguard/manifest`、`public/`（标题/页脚/设置页/app.js）、`prototype/`、README、CHANGELOG 与五份 doc 头部。
- 重新出包 `dist/fnos/siteguard-0.8.0-x86.fpk` / `-arm.fpk`；Docker 镜像重建并推送阿里云 ACR（`0.8.0` / `latest`，构建带 `--provenance=false --sbom=false`）。
- 文档：README 当前阶段与项目结构、DESIGN 实施计划与前端章节、PROJECT 前端实现、PROJECT_STATE 进度/限制/踩坑 3、TEST 新增 3.4 面板端到端实测、DEPLOY 版本表与产物名、DEBUG_FPK 当前状态。

### 0.7.3 - 2026-10-26

**背景**：0.7.2 的 `.fpk` 在飞牛 fnOS 实机**安装成功**，桌面图标打开后正常显示状态页（统一网关 iframe 入口可用），确认「应用包格式不符合系统版本要求」的根因就是 `wizard/install` 与 `wizard/uninstall` 两个文件。本轮为验收后的升版与重新出包。

**修复（实机验证）**
- `.fpk` 安装问题闭环：删除 wizard 文件后的包在 fnOS 实机可装、可打开，不再报格式错误。

**调整**
- 版本号统一同步至 0.7.3：manifest、package.json、package-lock.json、界面页脚（public 与 prototype）、README 与五份 doc 头部。
- 重新出包 `dist/fnos/siteguard-0.7.3-x86.fpk` / `-arm.fpk`。
- Docker 镜像重建并推送阿里云 ACR（标签 `0.7.3` 与 `latest`，构建命令带 `--provenance=false --sbom=false`）。
- 文档：`PROJECT_STATE.md` 记录实机验收结论、`DEPLOY.md` §4.1 同步 `deploy/Dockerfile` 实际内容、`DEBUG_FPK.md` §八 状态更新为已验证。

### 0.7.2 - 2026-10-26

**背景**：0.7.0 / 0.7.1 的 .fpk 在飞牛 fnOS 1.2.08 应用中心安装时报「应用包格式不符合系统版本要求」。经二分定位（裸模板 + 单变量逐项隔离）确认根因是 `wizard/install` 与 `wizard/uninstall` 两个文件——fnOS 校验器对 wizard 内容敏感（本地手册 §10 预警）。

**新增**
- Docker 镜像：新增 `deploy/Dockerfile`（`node:22-alpine`、国内 npm 源、非 root 运行、SQLite `/data` 卷）与 `.dockerignore`；镜像已构建并推送阿里云 ACR `registry.cn-hangzhou.aliyuncs.com/mylxnet/site-guard`（标签 `0.7.2` 与 `latest`）。

**修复**
- 删除 `fnos/siteguard/wizard/install` 与 `fnos/siteguard/wizard/uninstall`，回归空 `wizard/` 目录。
- 卸载「彻底删除数据」选项暂以默认保留数据替代（`uninstall_init` 中 `${wizard_purge:-}` 恒为空 → 安全保留）。

**调整**
- 版本号统一同步至 0.7.2：manifest、package.json、package-lock.json、界面页脚（public 与 prototype）、README 与五份 doc 头部。
- 新增排错记录 `doc/DEBUG_FPK.md`。

### 0.7.0 - 2026-10-25

**背景**：交付形态从 Docker 改为 **fnOS 原生应用（.fpk）**，按 `doc/FNOS_APP_DEV_GUIDE.md` 实现；能不依赖 Docker 就不依赖，容器方案降级为备用路径（未实现）。

**新增**
- `fnos/siteguard/`：飞牛包目录——`manifest`（统一网关 `os_min_version = 1.1.3100`、无 `service_port`、`checkport=false`）、`config/privilege`（4 空格缩进、`run-as: package`）、`config/resource`（`siteguard/data` 数据 share）、`app/ui/config`（iframe 网关入口 `siteguard.main` + `gatewayPrefix/gatewaySocket`）、图标与 `wizard/`。
- `fnos/siteguard/cmd/`：9 个生命周期脚本——`main`（start/stop/status，双布局探测 `server/` 与 `target/server/`，内置 Node → 应用中心 nodejs_v22 → 系统 node 的三级运行时选择，curl 打 socket 探活，失败把原因写进 `TRIM_TEMP_LOGFILE`），以及 install/upgrade/uninstall/config 的 init 与 callback；卸载默认保留数据，仅 `wizard_purge=true` 才清空。
- `scripts/build-fnos.mjs`：一键打包——组装 `app/server`、`npm ci --omit=dev` 随包携带依赖、按架构下载官方 Node 只取 `bin/node`、权限归一、按架构写 `platform`、调 `fnpack build` 出包并还原 manifest。支持 `--arch`、`--no-runtime`、`--no-pack` 与 `FNPACK_BIN`。
- 产物：`dist/fnos/siteguard-0.7.0-x86.fpk`（43.2 MB）与 `siteguard-0.7.0-arm.fpk`（43.3 MB）。
- 测试：`test/gateway.test.js` 新增 Unix Socket 用例（111 条总计）。

**服务端适配**
- `src/server.js`：新增 `socketTargetFor()`（`SOCKET_PATH` 非空则监听 Socket；Windows 本地开发映射为命名管道），网关前缀下放行同源 iframe 嵌套（`X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'`），socket 清理全部 try/catch 包裹。
- `src/config.js` / `src/routes.js`：`GATEWAY_PREFIX` 归一成 `/app/xxx` 形式，双前缀（直连 + 网关）都能访问。

**修复**
- 调度器补跑用例改为“闸门”确定性写法（先确认在跑再断言 409，放行后再收尾），消除高负载下的偶发失败。
- `cmd/*` 中 `${TRIM_DATA_SHARE_PATHS:-}` 加默认值，避免 `set -u` 下未声明变量直接报 unbound；授权目录取第一个时不再被 Windows 盘符截断（仅本地模拟场景）。

**验证**
- `npm test`：111 条全绿（单文件重跑 10 次、全量重跑多次均通过）。
- fnpack 打包成功两次，`tar` 解开检查：`app.tgz` 含 `server/src`、`server/public`、`server/node_modules/nodemailer`、`runtime/x64/node`、`ui/config`；图标 64/256 尺寸正确；无 `.DS_Store` 之类杂物。
- 生命周期模拟：`status 3 → start 0 → 重复 start 0 → status 0 → stop 0 → status 3`，数据目录生成 `app.db`；网关前缀下 `/app/siteguard/api/health` 与 `/app/siteguard/` 均 200，直连 `/api/health` 也 200；install/upgrade/uninstall 回调各自幂等，purge 开关按预期生效。
- **未验证**：真实 fnOS 实机安装（需设备）、真实 ARM 架构运行（包已产出但没跑过）。

### 0.6.0 - 2026-10-25

**新增**
- `src/notify.js`：邮件告警——SMTP 设置读写与密码脱敏、汇总模板（纯文本 + 内联样式 HTML）、主题按严重度分级、6 小时同类冷却、恢复补发、失败重试（1 分钟/5 分钟）、SMTP 错误映射、测试邮件。
- `src/validate.js`：`validateMailSettings()`——启用时才强制服务器/发件人/收件人，密码留空表示保留原值，校验端口、加密方式、收件人格式与冷却区间。
- `src/db.js`：`listEventsByBatch`、`checkInBatch`、`markEventsNotified`、`markPagesAlerted`，事件列表支持 `offset` 并新增 `countEvents`。
- `src/scheduler.js`：批次结束后触发汇总邮件，发送结果写入批次日志；发信失败不影响本轮结论。
- 接口：`GET /api/events`（类型/站点筛选 + 分页）、`GET/PUT /api/settings`（密码只写不读）、`POST /api/settings/test-mail`。
- 测试：`test/notify.test.js`（10 条）、`test/mail-api.test.js`（8 条），总数达到 105 条。
- 依赖：安装 `nodemailer ^7.0.9`（项目唯一依赖，纯 JS）。

**优化**
- 汇总只统计本批次事件，不跨轮次；`events.notified` 仅在实际发送成功后置 1，失败时保留 0 供下一轮重试。
- 冷却只针对 `changed`：只有真的发出去的变更邮件才推进 `pages.last_alert_at`，恢复/异常不会把后续真实变更压掉。
- 无事件（如仅建立基线）直接跳过发信，不产生空邮件。
- 单页复检不建批次、不发信，避免手动点击刷屏；事件仍照常入库。
- 密码、授权码不会出现在接口响应、日志或失败事件中（错误文案统一脱敏）。

**修复**
- `GET /api/events` 不传 `limit` 时只返回 1 条：查询参数缺失是 `null`，`Number(null) === 0` 被当成用户要 0 条并夹到下限 1；现缺失/空串一律用默认 50，并补了回归用例。

**调整**
- 批次先标记 `done` 再发信：SMTP 重试最长可达数分钟，不能把批次状态卡在“运行中”；发送结果追加到批次日志，失败写 `system` 事件。
- `PUT /api/settings` 支持部分字段更新（如只改冷却时间），未传的字段保持原值。
- 版本同步到 `0.6.0`（`package.json`、README、五份 doc、状态页与原型页脚）。

**验证**
- `npm test`：105 条全部通过。
- 真实 SMTP 端到端（本地 SMTP 桩，非 mock）：测试邮件真实完成 EHLO/DATA（1595 B）；改内容后收到 `[网站哨兵] 🟡 1 个页面内容变更 · 邮件验证站点`，正文含差异行与面板链接；事件 `notified=true`；6 小时内再改只入库不发信；SMTP 端口不可达时返回「连不上邮件服务器，请检查地址、端口与加密方式」。

---

### 0.5.0 - 2026-10-25

**新增**
- `src/fetch-page.js`：抓取与解码——手动跟随重定向（最多 5 跳，记录 `finalUrl` 与跳数）、20 秒超时、5 MB 截断、`Content-Type`/`<meta charset>` 探测（含 GBK）、网络错误重试 1 次、失败分类 `DNS/TIMEOUT/TLS/CONN/HTTP/REDIRECT`。
- `src/extract.js`：正文提取——丢弃 `head/script/style/noscript/svg/iframe` 等容器，块级标签转换行、实体解码、空白压缩、零宽字符清理、逐行应用忽略规则；字数不含换行。
- `src/verdict.js`：四档判定——R-01~R-15 + R-07b，共 16 条规则；聚合优先级 `unknown > bad > suspect > normal`；内置错误页、坏标题、反爬词库。
- `src/diff.js`：`sha256` 指纹与多重集合差集（各方向最多 200 行并标记 `truncated`），不用 LCS。
- `src/checker.js`：单页检测编排——抓取 → 提取 → 判定 → 与基线比对 → 写快照/检测/事件 → 回写页面状态；首次成功（normal/suspect）建基线，`bad/unknown` 绝不覆盖基线；恢复事件优先于变更事件。
- `src/runner.js`：接入真实检测引擎，向批次上报 `total/done` 进度，单页失败不拖垮整轮。
- 接口：`POST /api/pages/:id/run`（真实单页复检）、`GET /api/pages/:id/detail`、`GET /api/pages/:id/diff`、`POST /api/pages/:id/accept`、`GET /api/overview`。
- 配置项：`FETCH_MAX_BYTES`、`FETCH_RETRIES`、`FETCH_RETRY_DELAY_MS`；`PAGE_GAP_MS` 允许 0。
- 测试：`test/extract.test.js`、`verdict.test.js`、`diff.test.js`、`fetch.test.js`、`checker.test.js`、`engine-api.test.js`，合计 87 条。

**优化**
- R-04/R-15 以“本次请求的页面地址”为参照，而不是站点首页；子路径页（`/list`）与子域页（`blog.`）不再被误判为跨域跳转。
- R-07 空白阈值收紧到 50 字，50~199 字改判 R-07b「内容偏少」（suspect）；基线本身不足 200 字时不再套用阈值，避免 `example.com` 这类真实短页被永久判坏、也避免用户对告警脱敏。
- 新页面首次判 `unknown` 也会产生事件：初始 `state` 就是 `unknown`，不能把它当成“持续无变化”而静默。
- suspect（慢响应、正文偏少）首次抓取同样建立基线：健康结论与内容基线是两件事。

**修复**
- 基线快照未标记 `kind='baseline'`，会被“每页保留 60 份 check”的清理规则删掉，导致基线凭空丢失。
- suspect 首次建基线时 `baseline_id` 没有落库（只在 normal 分支写入），重启后基线失效。
- 提取时 `<title>` 文本残留在正文里，标题字数被重复计入。
- 端到端验证发现的重定向误报：每个子路径页都会被 R-15 判为“被重定向”。

**调整**
- `POST /api/pages/:id/run` 从 501 变为可用；确认基线允许 `normal/suspect`，拒绝 `bad/unknown`（错误页当基线会把异常洗成正常）。
- 版本同步到 `0.5.0`（`package.json`、README、五份 doc、状态页与原型页脚）。

**验证**
- `npm test`：87 条全部通过（约 1 秒）。
- 真实进程端到端（本地夹具站点 + 真实 HTTP）：首次抓取 269 字建基线 → 改内容后 `changed=true`、差异新增 1 行 → 确认后差异归零 → 502 页判 `bad` 且拒绝设为基线 → 整轮巡检 `checked=2`、`normal=1`、`bad=1` → 概览统计与事件正确。
- 公网抽检：`https://example.com/` 判 `suspect`（正文 156 字，内容偏少）、`https://www.iana.org/help/example-domains` 判 `normal`（1205 字）。

---

### 0.4.0 - 2026-10-25

**新增**
- `src/server.js`：`node:http` 服务——API 分发、静态资源（限定 `public/` 内且扩展名白名单）、安全响应头、请求超时、SIGINT/SIGTERM 优雅退出。
- `src/routes.js`：15 个接口（`health`/`state`/`setup`/`login`/`logout`、站点 CRUD、页面增删改、手动巡检、批次查询），统一 `{ ok, data }` / `{ ok, error: { code, message, fields } }` 形状。
- `src/http.js`：JSON 读写、错误映射、Cookie、同源（Origin）校验、客户端 IP。
- `src/schedule.js`：按站点时区计算下次运行（不依赖容器 `TZ`）、±90 秒站点级抖动、补跑判定。
- `src/scheduler.js`：20 秒 tick、并发上限 2、同站点互斥、单站点每日 24 轮上限、启动补跑、手动触发。
- `src/batches.js`：批次进度（内存，最多 20 条），供前端轮询。
- `src/runner.js`：一轮巡检的页面遍历与间隔控制；检测引擎以 `checkPage` 接口预留（0.5.0 接入）。
- `src/validate.js`：站点/页面/密码/ID 服务端校验，一次返回全部字段错误。
- `public/index.html`：后端骨架状态页（接口清单 + 后续计划），不再 404。
- `test/schedule.test.js`、`test/validate.test.js`、`test/api.test.js`、`test/scheduler.test.js`：32 条自动化用例。

**优化**
- 时间计算统一「取目标时区的墙上时间再还原时间戳」，容器时区配错也不会把 09:00 跑到凌晨。
- 站点 JSON 一次带出页面与最近一次判定（`latestChecksForPages` 单条 SQL，避免 N+1）。

**修复**
- 修改站点时把 camelCase 传给 `nextRunAt`（只认 snake_case），导致 `PATCH /api/sites/:id` 返回 500。
- `ValidationError` 没有 `status`，被统一错误处理当成 500；现映射为 400 并保留字段错误。
- 静态目录路径保留结尾分隔符，越界判断恒不成立，`GET /` 返回 404。

**调整**
- `npm test` 改为 `node --test`（Windows 下传目录参数会被当作模块解析而报错）。
- `POST /api/pages/:id/run` 暂返回 501 并说明原因：单页复检依赖 0.5.0 的检测引擎。
- 版本同步到 `0.4.0`（`package.json`、README、五份 doc、界面与状态页页脚）。

---

### 0.3.1 - 2026-10-25

**新增**
- `README.md`：按项目规范补齐"是什么 / 功能 / 截图 / 快速开始 / 技术栈 / 数据与隐私 / 项目结构 / 常用操作 / 故障排查 / 更新日志 / 许可证"及英文摘要。
- `doc/PROJECT.md`：开发技术文档（架构、数据模型、检测引擎规则表、调度算法、告警、接口表、安全、测试策略）。
- `doc/DEPLOY.md`：飞牛 NAS 部署手册（Compose、镜像构建、备份恢复、反向代理、故障排查）。
- `doc/TEST.md`：测试文档（18 条已执行用例、25 条后端计划用例、回归清单）。
- `doc/images/`：4 张界面截图（概览/监测/事件/设置），由原型渲染并裁掉宿主水印。
- `CHANGELOG.md`：本文件。

**优化**
- 界面版本号、`package.json`、两份设计文档同步到 `0.3.1`。

**修复**
- 监测页"判定"列过窄导致"变更"徽标被裁切（列宽 112 → 150px）。
- 页面表格"操作"列按钮被裁为省略号（列宽 236 → 272px，按钮内边距收紧）。

---

### 0.3.0 - 2026-10-25

**新增**
- 监测页改为**站点 / 页面两层**：站点卡片显示计划、下轮/上次时间、汇总徽标；卡内为页面表格（页面、判定、上次巡检、判定依据、操作）。
- 站点表单支持**两种巡检计划**：每天定时（最多 4 个 `HH:MM`）或每 N 小时（1/2/3/4/6/8/12/24），带时区与 ±90 秒抖动说明。
- **四档判定**：正常 / 可疑 / 异常 / 无法确认，四色区分，附判定依据。
- **判定详情弹窗**：结论 + 命中理由（命中/说明）+ 抓取事实（状态码、耗时、正文规模对比、必须包含）。
- 页面表单新增「必须包含的文字」，用于降低"页面被换掉"的漏判。
- 差异预览：基线/当前时间、增删行红绿对照、一键设为新基线。
- 巡检模拟：进度条 + 逐页实时日志（HTTP/耗时/字数/判定），结束写入汇总事件并标注"已发送汇总邮件"。
- 事件页新增"无法确认"筛选。

**优化**
- 概览统计改为 站点 / 异常 / 可疑·待确认 / 内容变更。
- 空状态引导由三步扩为四步（站点 → 页面 → 邮箱 → 看判定）。
- 设置页新增"巡检参数"（超时、页间隔、并发、时区只读）。

**修复**
- `.site` 类名同时用于站点卡片与文字标签导致样式串味（标签改为 `.site-tag`）。

**调整**
- 移除了分钟级间隔与"目录（需授权）"入口：MVP 只做网页层，目录监测依赖文件系统授权，暂不提供。

---

### 0.2.2 - 2026-10-25

**新增**
- MVP 方案定稿：健康判定改为"内容优先"的四档结论，明确"200 的错误页必须判异常"。
- 检测计划改为每天定时或每 N 小时（默认每天 09:00、21:00）。
- 邮件改为"一轮巡检一封汇总"，只报状态变化，同类 6 小时冷却，恢复补发。
- 单页"必须包含的文字"断言、反爬挑战识别、SPA 空壳识别。

**调整**
- 服务器目录文件监测移出 MVP（需授权），侵权检索正式否决。

---

### 0.2.1 - 2026-10-25

**新增**
- 界面「目录」类型标注"需授权"，并在表单内提示"只能监测已挂载的本机目录"。
- 设计文档补充文件监测能力边界与远程服务器的四种接入方式（SSH 拉取/挂载/探针/就地部署）。

**修复**
- 修正"远程网站可以读取目录"的理解偏差：HTTP 无列目录能力，未授权探测属于越界。

---

### 0.2.0 - 2026-10-25

**新增**
- 首个可点击的界面原型（`prototype/`，纯静态、零依赖、离线可开）。
- 四个页签：概览 / 监测 / 事件 / 设置；空状态、有数据、异常三种演示场景。
- 检测活动面板：进度条 + 终端式实时日志。
- 表单预校验（名称、URL、间隔、正则、邮箱、端口）。
- 差异弹窗、设为基线、删除二次确认、Toast 提示。

**修复**
- 空状态元素的 `display:flex` 覆盖 `[hidden]`，导致空状态与列表同时出现。

---

### 0.1.0 - 2026-10-25

**新增**
- 项目立项：确定形态（自建一体化）、范围（网站监测）、告警渠道（邮件）、部署形态（Docker + 飞牛 NAS）。
- 设计方案 `doc/DESIGN.md`：需求逐项评估、选型对比、功能与数据模型、部署与验收标准。
- 开发环境：WSL 发行版 `site-guard`（Ubuntu 22.04.5 + Node 22.23.0 + 国内源），初始化脚本 `E:\public\site-guard\provision.sh`。
- 独立仓库与目录骨架（`src/ doc/ prototype/ deploy/ test/ scripts/ tools/`）。
- 数据层与鉴权草稿（`src/db.js`、`src/auth.js`）。

**修复**
- 修复本机 WSL 残缺导致 `wsl.exe` 完全不可用（定位为 `C:\Program Files\WSL` 缺主程序 + MSI 注册源失效，卸载后重装官方签名包）。

---

## 下次开发计划

| 版本 | 计划 |
| --- | --- |
| ~~0.4.0~~ | ~~后端骨架：`node:http` 服务、鉴权、SQLite 建表、站点/页面 API、调度器~~ ✅ 已完成 |
| ~~0.5.0~~ | ~~检测引擎：抓取、正文提取、四档判定、指纹与差异；页面详情/差异/概览接口~~ ✅ 已完成 |
| ~~0.6.0~~ | ~~告警：批次汇总、冷却、邮件模板、失败重试 + 事件流与设置接口~~ ✅ 已完成 |
| 0.7.0 | Docker 镜像与 Compose、部署手册实测 |
| 1.0.0 | 验收（见 DESIGN 第 10 章）与正式发布 |
