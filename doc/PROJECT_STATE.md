# 项目状态 / 交接文档

> 版本：0.7.2 ｜ 更新：2026-10-25 ｜ 作者：by Mr lin

---

## 1. 当前进度

| 阶段 | 状态 |
| --- | --- |
| 需求确认（形态 / 范围 / 告警渠道） | ✅ 完成 |
| 设计方案（`doc/DESIGN.md`） | ✅ 完成，待评审 |
| 独立开发环境（WSL + Node 22） | ✅ 完成 |
| 目录骨架 | ✅ 完成 |
| 界面 demo（`prototype/`） | ✅ 已交付，待你确认 |
| MVP 方案定稿（本文档 0.2.2） | ✅ 完成，待确认 |
| demo v2（站点/页面两层 + 日程 + 四档判定） | ✅ 已交付 `prototype/` |
| 文档五件套 + CHANGELOG + 测试文档 + 截图 | ✅ 完成（0.3.1） |
| 后端骨架（HTTP/鉴权/建表/站点页面 API/调度器，0.4.0） | ✅ 完成 |
| 检测引擎（抓取/归一化/四档判定/基线差异，0.5.0） | ✅ 完成 |
| 页面级接口（复检/详情/差异/确认基线/概览） | ✅ 完成（0.5.0） |
| 邮件告警（批次汇总/冷却/恢复/重试/测试邮件，0.6.0） | ✅ 完成，105 条用例全绿 |
| 事件流与邮件设置接口（0.6.0） | ✅ 完成 |
| **飞牛原生应用 .fpk（包目录/生命周期脚本/打包脚本，0.7.0）** | ✅ 完成，已出 x86 与 arm 两包；**实机安装待验收** |
| 前端（`public/` 接入 API） | ⬜ 未开始 |
| Docker 镜像（备用路径，`deploy/Dockerfile`） | ✅ 已产出并推送阿里云 ACR（0.7.2 / latest） |

> 说明：当前 `npm start` 可完成“初始化 → 建站点/页面 → 巡检 → 看判定与差异 → 确认基线 → 收到汇总邮件”的闭环，抓取与 SMTP 都是真实链路；0.7.0 起可打包成飞牛原生安装包（不依赖 Docker），尚未交付的是正式前端面板与实机安装验收。

---

## 2. 环境事实（已验证）

| 项 | 值 |
| --- | --- |
| WSL 版本 | 2.7.12.0，内核 6.18.33.2-2 |
| 项目专属发行版 | `site-guard`（Ubuntu 22.04.5 LTS），位于 `E:\public\site-guard\wsl\ext4.vhdx` |
| 其他发行版 | `lxsyzd`（默认）、`superclip` —— **未改动** |
| 环境初始化脚本 | `E:\public\site-guard\provision.sh`（可重放） |
| Node / npm | v22.23.0 / 10.9.8（npmmirror 二进制直装） |
| npm registry | `https://registry.npmmirror.com` |
| apt 源 | 阿里云镜像（`mirrors.aliyun.com`） |
| 源码仓 | `E:\work\site-guard`（分支 `main`） |
| Docker | WSL 内已装 Docker 29.8.0（镜像构建/推送在此执行） |
| 自动化测试 | Windows 侧 Node v22.23.2 直接 `npm test`（无需 WSL，也不依赖 `node_modules`） |

### 2.1 常用命令

```bash
# 进入项目环境
wsl -d site-guard --cd /mnt/e/work/site-guard -- bash

# 安装依赖（必须在 WSL 内，node_modules 不落 Windows 侧）
wsl -d site-guard --cd /mnt/e/work/site-guard -- npm install

# 跑测试
wsl -d site-guard --cd /mnt/e/work/site-guard -- npm test
```

> Git Bash 中调用 `wsl` 若遇到路径被改写，加 `MSYS2_ARG_CONV_EXCL='*'`。

---

## 3. 架构决策记录（ADR）

| 编号 | 决策 | 理由 | 备选与代价 |
| --- | --- | --- | --- |
| ADR-001 | 自建一体化，而非 Uptime Kuma + changedetection.io 组合 | 组合方案无法覆盖目录文件完整性，且两套面板/两套告警 | 组合方案成熟但运维成本高（详见 DESIGN 2.2） |
| ADR-002 | 单容器 + SQLite 单文件 | NAS 场景零运维；备份即拷目录 | PostgreSQL 需多一容器，属过度设计 |
| ADR-003 | 零原生依赖（`node:sqlite` + 内置 `fetch`） | NAS 上 `docker build` 最怕编译失败；ARM/x86 都能装 | 若不使用内置模块则需 better-sqlite3 等编译型依赖 |
| ADR-004 | 内容比对只比"正文文字"，不比整页 HTML | 随机 class、埋点脚本、内联样式会天天误报 | 整页比对更"严格"但会自我摧毁告警信誉 |
| ADR-005 | 目录一律只读挂载 | 监测程序不应有写权限，杜绝反向破坏 | 读写挂载可用于自动修复，但风险高 |
| ADR-006 | 邮件为首期唯一渠道，但做成适配器 | 零账号成本、可留痕；后续加 Bark/企微不动核心 | 多通道同时做会拖慢首版 |

---

## 4. 踩坑记录

### 坑 1：WSL 表面健康、实际无法启动

- **现象**：任何 `wsl.exe` 调用（含 `--version`、`-l -v`）都返回「系统找不到指定的文件」。
- **误导点**：`Microsoft-Windows-Subsystem-Linux` 与 `VirtualMachinePlatform` 均为 `Enabled`，Appx 包状态 `Ok`（2.7.12.0），`WslService` 正在运行 —— 所有常规检查都显示"已装好"。
- **根因**：`C:\Windows\System32\wsl.exe` 只是 217 KB 的旧版硬链接桩（指向 WinSxS），真正 4.29 MB 的程序在商店包里，启动即报 `Wsl/CallMsi/ERROR_FILE_NOT_FOUND`；`C:\Program Files\WSL` 有 `wslservice.exe`、`libwsl.dll` 却**独缺 `wsl.exe`**。注册表中产品 `{020F8AC8-A788-4E39-8E9B-8FECFA843632}` 的 `InstallSource` 指向已失效的 `e:\work\lxsyzd2004\lxsyzd\`，因此 `/fa` 修复必然触发 1706。
- **修复**：下载微软官方 2.7.12.0 MSI（签名校验 `Valid` / Microsoft Corporation）→ 按引擎期望原名 `wsl-2.7.12.msi` 放置 → 修复失败（1603/1706）→ 按产品码卸载（本机无 WSL 发行版，零数据风险）→ 全新静默安装 → `MainEngineThread is returning 0`。
- **教训**：
  1. WSL"功能已启用"≠"程序完整"，`--version` 都跑不通时直接看 `C:\Program Files\WSL` 缺不缺主程序。
  2. MSI 的注册源失效时，`/fa` 和重新 `/i` 都救不了，卸载重装才是最短路径。
  3. 提权进程可能读不到当前用户的 Temp 目录，安装包应放全机可读路径。

### 坑 2：阿里云 ACR 不支持 buildx 生成的 OCI 空层

- **现象**：`docker push` 到阿里云 ACR 时，各层都已 `Pushed`/`Mounted`，却在最后写 manifest 阶段报 `error from registry: unknown manifest class for application/vnd.oci.empty.v1+json`。
- **根因**：Docker 29.x 默认 BuildKit/buildx 会额外生成 OCI 格式 attestation/provenance 与 manifest list（含 `vnd.oci.empty.v1+json` 空层媒体类型），阿里云 ACR 不支持这类 OCI 扩展类型。
- **修复**：改用经典构建器 `DOCKER_BUILDKIT=0 docker build`（只产出单一 Docker manifest），或 `docker buildx build --provenance=false --sbom=false`。
- **教训**：推给阿里云 ACR 的镜像须禁用 attestation/provenance，避免 OCI 扩展媒体类型。

---

## 5. 已知限制

- **原生应用尚未实机验证**：`.fpk` 已能打包，但没有在真实 fnOS 上安装过；`fnpack` 对 `wizard` 内容的校验规则（如不接受 `tips` 类型）是实测出来的，实机仍可能遇到校验器差异，需按 `fnos-native-app-dev-guide.md` 第 14 节清单逐项验收。
- ARM 包（`siteguard-0.7.0-arm.fpk`）只完成了打包与结构检查，没有在 ARM 机器上跑过。
- Docker 已落地为 `deploy/Dockerfile`（node:22-alpine、非 root、SQLite `/data` 卷），镜像已推阿里云 ACR；`docker-compose.yml` 尚未产出（如需要再补）。
- 侵权发现仅做降级处理（详见 DESIGN 2.2 R6），不做全网检索。
- demo 为纯静态假数据，不发请求、不写真数据；真实数据只能通过 API 写入。
- 检测引擎只做静态 HTML 抓取，不执行 JS；SPA 会判 `unknown`（无法确认），不引入 Headless 浏览器。
- 基线只认“正文文字”：图片替换、纯样式改版不会告警；需要时可后续加区块/图片指纹。
- 单页复检不建批次、不发信：事件会入库，但只有整站巡检才触发汇总邮件。
- 邮件冷却以“上一次真的发出去的变更邮件”为起点；SMTP 未配置或连续失败时不会推进冷却。
- SMTP 失败重试间隔为 1 分钟与 5 分钟，期间批次已标为完成，发送结果只体现在批次日志与 `system` 事件里。
- 邮件只包含本批次事件；被冷却压制的事件保留 `notified=0`，不会在下一轮“补发”（避免过期告警）。
- 前端 `public/` 目前只有一个状态页，尚未接入 API；正式界面仍待从原型演进。
- 登录失败限速、批次进度都在进程内存，重启后清零/丢失；单实例自托管场景可接受。
- **目录监测依赖文件系统访问权**：只能监测已挂载的本机目录；远程网站无法读取目录，未授权站点不探测路径（已写入 DESIGN 4.3）。用户当前目标站点属于“他人站点或待定”，故首版以网页层监测为主，目录类型在界面标注“需授权”。

---

## 6. 待办清单

| # | 事项 | 阻塞于 |
| --- | --- | --- |
| 0 | ~~0.5.0 检测引擎：抓取 + 归一化 + 四档判定 + 差异，接入 `runner.js` 的 `checkPage` 接口~~ ✅ 已完成 | — |
| 8 | ~~0.6.0 告警：批次汇总、冷却、邮件模板、失败重试；事件列表与设置接口~~ ✅ 已完成 | — |
| 9 | ~~0.7.0 飞牛原生应用 .fpk（包目录、生命周期脚本、内置 Node、打包脚本）~~ ✅ 已完成 | — |
| 10 | 实机 fnOS 安装验收（应用中心装包、启停、网关访问、升级与卸载） | 需要 fnOS 设备 |
| 11 | 正式前端面板接入 API（`public/`） | 设计确认 |
| 1 | ~~技术选型裁决~~ ✅ Node.js 22 + SQLite 单文件 + 原生前端（分发方式仍待定） | — |
| 2 | ~~界面 demo~~ ✅ demo v2 已交付（站点/页面两层、日程、四档判定与差异） | 待确认视觉效果 |
| 7 | SSH 拉取文件清单通道（仅当站点自有且有 SSH 时） | 需求确认 |
| 3 | ~~`README.md` / `PROJECT.md` / `DEPLOY.md` / `CHANGELOG.md` / `TEST.md`~~ ✅ 已补齐（0.3.1） | — |
| 4 | Docker 镜像已完成（Dockerfile + 推阿里云 ACR）；剩余可选：docker-compose.yml 编排 | 可选 |
| 5 | ~~`doc/images/` 界面截图~~ ✅ 已产出 4 张（概览/监测/事件/设置） | — |
| 6 | ~~应用图标~~ ✅ 已产出：`scripts/make-icons.mjs` 生成 `fnos/siteguard/ICON*.PNG` 与 `app/ui/images/icon_*.png` | — |

---

## 7. 变更记录

| 版本 | 日期 | 内容 |
| --- | --- | --- |
| 0.7.2 | 2026-10-26 | 修复 .fpk 安装报「包格式不符合系统版本要求」：移除 wizard 文件；新增 Docker 镜像（`deploy/Dockerfile`）并推阿里云 ACR；版本 0.7.2 多处同步 + 排错文档 |
| 0.7.0 | 2026-10-25 | 飞牛原生应用：`fnos/siteguard` 包目录（manifest 统一网关、privilege/resource、`app/ui/config` iframe 入口、9 个生命周期脚本、卸载向导）、`scripts/build-fnos.mjs` 一键出 x86/arm 两个 .fpk（内置 Node v22.23.4、依赖随包、按架构写 platform）、网关前缀 + Unix Socket 适配与 111 条用例、调度器补跑用例去抖；生命周期与回调在本机模拟通过，实机安装待验收 || 0.6.0 | 2026-10-25 | 邮件告警：SMTP 设置读写与脱敏、纯文本/HTML 汇总模板、主题分级、同类 6 小时冷却、恢复补发、失败重试与错误映射、测试邮件；事件流（筛选/分页）与设置接口；批次结束后自动发信并标记 `notified`；105 条用例；真实 SMTP 桩端到端验证 |
| 0.5.0 | 2026-10-25 | 检测引擎：抓取（重定向/超时/截断/GBK/失败分类）、正文提取与忽略规则、R-01~R-15 + R-07b 四档判定、sha256 指纹与多重集合差异、基线与事件状态机、单页复检/详情/差异/确认基线/概览接口；87 条用例；修复基线快照被清理、suspect 基线不落库、标题重复计入正文、子路径页被误判重定向 4 个缺陷 |
| 0.4.0 | 2026-10-25 | 后端骨架：`node:http` 服务与安全头、首次初始化/登录/会话、站点与页面 API、时区感知的调度器（抖动/补跑/并发互斥/每日上限）、批次进度；32 条自动化用例（调度时区、校验、接口、补跑与 409）；修复静态首页 404、PATCH 站点 500、校验错误被当 500 三个缺陷 |
| 0.1.0 | 2026-10-25 | 完成需求评估与设计方案；修复 WSL 并建立项目专属发行版；建立独立仓库与目录骨架；`package.json` 起始版本 0.1.0；选型按推荐项定案（Node 22 + SQLite + 原生前端） |
| 0.3.1 | 2026-10-25 | 补齐全套技术文档：README、PROJECT、DEPLOY、TEST、CHANGELOG、4 张界面截图；修复监测页判定列与操作列的裁切问题 |
| 0.3.0 | 2026-10-25 | 交付 demo v2：站点/页面两层、每天定时或每 N 小时的日程表单、四档判定（正常/可疑/异常/无法确认）与判定依据、差异预览、巡检进度与实时日志；修复 `.site` 类名与文字标签冲突 |
| 0.2.2 | 2026-10-25 | MVP 方案定稿：健康判定改为“内容优先”四档结论（不再以 200 论正常）；按站点/页面两层组织；检测计划改为每天定时或每 N 小时（已定默认 09:00/21:00）；邮件汇总与冷却；目录监测移出 MVP |
| 0.2.1 | 2026-10-25 | 明确文件监测能力边界：目录需授权，远程站点不探路径；界面「目录」类型加“需授权”标注与表单提示；DESIGN 4.3 补充四种远程接入方式与站点归属对照表 |
| 0.2.0 | 2026-10-25 | 交付界面 demo：4 个页签（概览/监测/事件/设置）、空/有数据/异常三态、检测进度与实时日志、差异弹窗、表单预校验；修复空状态与 `[hidden]` 的样式冲突 |
