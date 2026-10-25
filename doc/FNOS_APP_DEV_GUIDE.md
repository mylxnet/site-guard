# 飞牛 fnOS Native 应用本地开发技术方案

> **用途**：本仓库开发新飞牛应用时的通用参考手册，供人工与 AI Agent 共同使用。
> **来源**：飞牛应用开放平台官方文档（[开发指南](https://developer.fnnas.com/docs/guide/)、[应用框架](https://developer.fnnas.com/docs/core-concepts/framework/)、[Manifest](https://developer.fnnas.com/docs/core-concepts/manifest/)、[应用权限](https://developer.fnnas.com/docs/core-concepts/privilege/)、[应用资源](https://developer.fnnas.com/docs/core-concepts/resource/)、[应用入口](https://developer.fnnas.com/docs/core-concepts/app-entry/)、[统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration/)、[index.cgi](https://developer.fnnas.com/docs/core-concepts/index-cgi/)、[用户向导](https://developer.fnnas.com/docs/core-concepts/wizard/)、[fnpack](https://developer.fnnas.com/docs/cli/fnpack/)、[appcenter-cli](https://developer.fnnas.com/docs/cli/appcentercli/)）、官方 Native 案例（Notepad）、社区实践，以及「网站哨兵」v0.7.0~v0.8.2 的实机事故复盘（§9.4、§13.5、§15 第 11~14 条）。
> **维护**：本文件随 fnpack / fnOS 版本演进更新；引用官方行为时以官方文档为准。**标注「本项目约定」的内容是实现习惯，不是平台强制要求**。每遇到新的实机故障，按「现象 / 根因 / 修复 / 教训」补进 §15。
> **校对**：2026-10-26 已按官方文档逐页复核；官方与实机行为冲突处单独标注（如 `install_dep_apps`）。

---

## 0. Agent 使用指引（快速决策）

开发一个新应用时，按以下顺序使用本文档：

1. **选型**：读 §1，决定 Native 还是 Docker 技术路线。
2. **脚手架**：按 §2 准备 `fnpack`，`fnpack create <appname>` 生成骨架。
3. **填配置**：按 §3~§10 逐项填写 manifest、privilege、resource、cmd、ui/config、wizard。
4. **本地开发**：按 §12 搭建本地预览（PORT 模式），验证功能；并**用不带尾斜杠的网关前缀**再开一次（网关前端铁律见 §9.4）。
5. **打包**：按 §13 构建并 `fnpack build` 生成 `.fpk`。
6. **验收**：按 §14 检查清单在 fnOS 实机/虚拟机上逐项验证。
7. **排错**：出问题先查 §15 故障表（现象→根因→修复→教训），定位后再动手。

---

## 1. 应用类型与技术选型

| 类型 | 适用场景 | 说明 |
|------|----------|------|
| **Native 应用** | 自研后端 + Web UI / 后台服务 / CLI | 进程直接运行在 fnOS 上；自带运行时（随包携带 Node/Python/Go 产物）最稳，依赖其他应用时用 `install_dep_apps`；可走统一网关或自监听端口 |
| **Docker 应用** | 上游已有官方/社区镜像的服务 | `fnpack create <appname> --template docker`，核心是 `docker-compose.yaml` + 启停脚本；本文档不展开 |
| **纯静态应用** | 无后端 SPA / 文档站 | 前端构建产物放 `app/www/`，用 `index.cgi` 或统一网关静态转发，fpk 极小（2~5MB） |

Native 应用内常见技术栈组合：

- 后端：Node.js（Express/原生 http）/ Python（优先 stdlib，NAS 上 pip 包安装受限）/ Go 单二进制（最省心，无运行时依赖）
- 前端：React/Vue 单页应用（Vite 构建）或单 HTML 文件
- 多架构：含原生 `.node` 模块时按 x86/arm 分别构建；纯 JS/解释型语言可用 `platform=all`

> 依赖选型原则：优先选依赖少、许可证宽松（MIT/Apache-2.0）且可商用的库；能用 stdlib 解决的不上包管理器。

---

## 2. 开发环境与工具

### 2.1 fnpack CLI（官方打包工具，核心）

按开发机系统下载对应二进制：

| 系统 | 文件名 |
|------|--------|
| Windows x86 | `fnpack-x.x.x-windows-amd64` |
| Linux x86 | `fnpack-x.x.x-linux-amd64`（需 `chmod +x`） |
| Linux ARM | `fnpack-x.x.x-linux-arm64` |
| macOS | `fnpack-x.x.x-darwin-amd64` / `-darwin-arm64` |

- Linux/macOS 可装到 `/usr/local/bin/fnpack`。
- 脚本化构建时可用环境变量 `FNPACK_BIN=/abs/path/to/fnpack` 显式指定。
- 官方下载页：https://developer.fnnas.com/docs/cli/fnpack/（当前 1.2.3，含 Windows / Linux x86 / Linux ARM / macOS 二进制）

常用命令：

```bash
fnpack create <appname>                     # 创建 Native 应用骨架
fnpack create <appname> --without-ui true    # 无桌面入口的服务类项目
fnpack create <appname> --template docker    # Docker 应用骨架（官方写法）
fnpack build                                 # 在当前应用目录打包生成 <appname>.fpk
fnpack build --directory <path>              # 指定目录打包
```

`fnpack build` 前的内置检查：`manifest` 存在且含必要字段、`config/privilege` 与 `config/resource` 为合法 JSON、`ICON.PNG` / `ICON_256.PNG` 存在、`app/`、`cmd/`、`wizard/` 目录存在、声明 `desktop_uidir` 时对应目录存在。

### 2.2 本地开发前置

- Node.js / Python 本地运行时（仅本地预览用，与 fnOS 上的运行时独立）。
- 一台 fnOS 设备或虚拟机用于实机测试。
- 日志排查路径（实机）：
  - fnOS 生命周期日志：`/var/log/apps/<appname>.log`（实机观察，系统版本不同可能变化）
  - 应用自身日志：约定写到 `${TRIM_PKGVAR}/<appname>.log`
  两者都要看，启动失败往往一半信息在生命周期日志里。

---

## 3. 标准目录结构

### 3.1 构建目录（开发机 / 仓库内）

```
<project>/
├── backend/                    # 应用源码（不进 fpk 的中间形态）
├── frontend/                   # 前端源码
├── scripts/                    # 构建脚本（保留，勿随清理删除）
└── <appname>/                  # fpk 包目录（fnpack create 生成，进版本管理）
    ├── app/                    # 应用可执行文件（打包进 app.tgz）
    │   ├── server/             #   运行时服务（构建产物）
    │   ├── ui/
    │   │   ├── config          #   入口配置（JSON）
    │   │   └── images/         #   入口图标 icon_64/128/256.png
    │   └── www/                #   静态文件（可选）
    ├── cmd/                    # 生命周期脚本（官方共 9 个，建议全部提供）
    │   ├── main                #   start / stop / status
    │   ├── install_init / install_callback
    │   ├── upgrade_init / upgrade_callback
    │   ├── uninstall_init / uninstall_callback
    │   └── config_init / config_callback
    ├── config/
    │   ├── privilege           # 权限（JSON）
    │   └── resource            # 资源（JSON）
    ├── wizard/                 # 用户向导（JSON 数组，可空目录）
    ├── manifest                # 应用"身份证"
    ├── LICENSE                 # 隐私协议（可选）
    ├── ICON.PNG                # 64×64
    └── ICON_256.PNG            # 256×256
```

### 3.2 安装后目录（fnOS 上，/var/apps/<appname>）

```
/var/apps/<appname>
├── cmd/ config/ manifest ICON*.PNG
├── target -> /vol{n}/@appcenter/<appname>    # TRIM_APPDEST：应用文件
├── etc    -> /vol{n}/@appconf/<appname>      # TRIM_PKGETC：静态配置
├── var    -> /vol{n}/@appdata/<appname>      # TRIM_PKGVAR：运行期数据（重启保留）
├── tmp    -> /vol{n}/@apptemp/<appname>      # TRIM_PKGTMP：临时文件
├── home   -> /vol{n}/@apphome/<appname>      # TRIM_PKGHOME：用户数据
├── meta
├── shares/                                # resource 中声明的共享目录软链
└── wizard/
```

**关键规则**：

- 脚本与代码中**永远使用 TRIM_* 环境变量，不硬编码路径**。
- 官方要求卸载尊重用户数据：是否保留由 `wizard/uninstall` 收集用户选择、`uninstall_callback` 执行。**不要把需要长期保留的数据放在 `target/`**（升级/卸载会替换该目录）；持久数据放 `TRIM_PKGVAR`，用户可见文件放 `data-share`。
- ⚠️ **不同 fnOS 版本 `TRIM_APPDEST` 指向不同**：老版本指向 `/var/apps/<appname>`（文件在 `target/` 下），1.1.31xx+ 可能直接指向 `/vol4/@appcenter/<appname>`（文件直接在其下，无 `target/` 层）。`cmd/main` 必须双布局探测（见附录 A），不能只写一种。

---

## 4. manifest 配置

文件名 `manifest`（无扩展名），KEY=VALUE 格式。`=` 两侧空格与值加不加引号均非强制：官方 Manifest 页示例不带引号，快速开始示例带引号，两种都能解析——保持与 `fnpack create` 模板一致即可。

### 4.1 字段表

| 字段 | 必填 | 说明 |
|------|------|------|
| `appname` | 是 | 应用唯一标识，系统范围内唯一；官方示例含大小写（如 `HelloFnos`），网关路径也用同名 |
| `version` | 是 | 版本号，官方示例 `1.0.0` / `2.1.3-beta`；本项目另用 4 段约定见 §13.4 |
| `display_name` | 是 | 应用中心显示名 |
| `desc` | 是 | 应用介绍，支持 HTML |
| `source` | 是 | 固定 `thirdparty` |
| `arch` | — | 官方 Manifest 页**未列出**；旧模板/旧文档出现过，不要依赖，用 `platform` |
| `platform` | 否 | `x86` / `arm` / `all`；**只写单值**。`all` 仅当包内没有架构相关二进制（原生模块、Go 二进制）时使用 |
| `os_min_version` | 否 | 最低系统版本，按**实机测试过**的版本填，不要虚报 |
| `os_max_version` | 否 | 最高系统版本，仅当确有兼容上限时填 |
| `maintainer` / `maintainer_url` | 否 | 开发者 |
| `distributor` / `distributor_url` | 否 | 发布者 |
| `desktop_uidir` | 否 | 默认 `ui`，入口配置所在目录；声明时必须存在 |
| `desktop_applaunchname` | 否 | 多入口时应用卡片打开的入口 ID，须与 `ui/config` 的 key 完全一致 |
| `service_port` | 否 | 监听端口；走统一网关（Socket 转发）时**不声明**（网关入口忽略该字段） |
| `checkport` | 否 | 默认 `true`，启动前检查端口占用；不监听固定端口可设 `false` |
| `ctl_stop` | 否 | 默认 `true`；静态/无进程应用设 `false` 隐藏启停控制 |
| `install_type` | 否 | 空=用户选存储位置；`root`=装系统分区 |
| `install_dep_apps` | 否 | 依赖**其他应用**（含应用中心提供的运行时应用），`:` 分隔，版本约束 `>`，如 `database>2.2.2:cache`；官方未规定安装顺序。实机 1.1.31xx 曾拒绝该字段，见 §11 |
| `disable_authorization_path` | 否 | `true` 隐藏应用设置里的授权目录项；仅当应用不需要用户文件授权时使用 |
| `changelog` | 否 | 升级时展示 |

### 4.2 最小可用示例

```ini
appname = myapp
version = 1.0.0
display_name = 我的应用
desc = 一个示例应用
source = thirdparty
maintainer = yourname
distributor = yourname
platform = all
desktop_uidir = ui
desktop_applaunchname = myapp.main
```

---

## 5. 应用权限（config/privilege）

应用默认以**专用包用户**运行，降低系统风险；`username` / `groupname` 省略时系统按 `manifest.appname` 自动生成：

```json
{
    "defaults": {
        "run-as": "package"
    },
    "username": "myapp_user",
    "groupname": "myapp_group"
}
```

- 需要访问系统组保护的资源（硬件转码等）：用官方字段 **`join-groups`**，如 `"join-groups": ["video", "render"]`；只加确实需要的组。
- **`run-as: root` 官方允许但明确不建议**：仅当生命周期脚本确实需要特权准备时使用，且启动长期服务前用 `runuser -u "$TRIM_USERNAME" -- ...` 降权。
- 外部文件访问默认不开放：由用户在应用设置中授权目录，或在 `config/resource` 声明 `data-share`。`TRIM_DATA_ACCESSIBLE_PATHS`（V1.1.8+）可感知授权结果——该变量官方环境变量页未列出，属实测经验，使用前先打印环境变量确认。
- `config/privilege` 只需是**合法 JSON**（可用 `jq . config/privilege` 校验），官方未要求固定缩进。

---

## 6. 应用资源（config/resource）

```json
{
    "data-share": {
        "shares": [
            { "name": "myapp/documents" },
            { "name": "myapp/backups" }
        ]
    }
}
```

- `data-share.shares`：安装时系统创建目录并**自动**为应用运行用户授权（Windows ACL 模型）；运行时通过 `TRIM_DATA_SHARE_PATHS`（冒号分隔）或 `/var/apps/<appname>/share/<name>` 软链访问。
- `permission`（`rw` / `ro` 用户列表）**仅当需要授权其他应用或系统用户**访问时才写，不要给自己应用配。
- 其他能力声明（按需）：
  - `usr-local-linker`：启动时把 `bin/`、`lib/`、`etc/` 项软链到 `/usr/local/` 对应目录。
  - `docker-project`：Docker 应用的 compose 编排声明（Native 应用不用）。

---

## 7. 生命周期脚本（cmd/*）

fnOS 在安装、升级、配置、卸载各阶段调用 `cmd/` 下脚本。所有脚本要求**可重复执行**（幂等）。

| 脚本 | 时机 | 典型用途 |
|------|------|----------|
| `install_init` | 安装文件应用**前** | 环境检查；注意此时 `TRIM_PKGVAR` 目录可能尚不存在（坑 §15-6） |
| `install_callback` | 安装文件应用**后** | 初始化配置、建 venv、写入向导值 |
| `main` | 启停与状态轮询 | `start` / `stop` / `status` 三命令 |
| `upgrade_init` / `upgrade_callback` | 升级前/后 | 数据与配置迁移；升级中应用会被自动停止再重启 |
| `uninstall_init` / `uninstall_callback` | 卸载前/清理后 | 可选的"彻底删数据"逻辑 |
| `config_init` / `config_callback` | 配置变更前/后 | 落盘新配置、通知进程 |

### 7.1 `cmd/main` 三命令约定

```bash
case "$1" in
  start)  # 启动服务；成功 exit 0，失败 exit 1 ;;
  stop)   # 停止服务；成功 exit 0 ;;
  status) # 运行中 exit 0；未运行 exit 3 ;;
  *) exit 1 ;;
esac
```

- **`status` 未运行时必须返回非 0（惯例 3）**：fnOS 靠 status 退出码决定是否调用 start；status 恒返回 0 会导致应用永远不被拉起（§15-1 头号坑）。
- `start` 中先做端口占用检查、清残留进程，再以后台进程 + PID 文件方式启动，并做健康检查轮询。
- `stop` 先 `kill -TERM`，等待 10s 后 `kill -KILL`，并清 PID 文件与 Socket。
- 失败前把简短可执行的错误写入 `$TRIM_TEMP_LOGFILE`（用户可见 Dialog），再 `exit 1`；不写则显示"执行XX脚本出错且原因未知"。`TRIM_TEMP_LOGFILE` 在 `main`、`install_*`、`upgrade_*` 中有效。

完整健壮模板见 **附录 A**。

---

## 8. 环境变量速查

### 8.1 应用变量（系统注入，勿硬编码）

> 官方环境变量页并未完整列出全部 `TRIM_*`；下表含实机补充项。首次适配某系统版本时，先在脚本里 `env | grep '^TRIM_' | sort` 打印确认，再决定依赖哪些变量。

| 变量 | 说明 |
|------|------|
| `TRIM_APPNAME` / `TRIM_APPVER` / `TRIM_OLD_APPVER` | 应用名 / 当前版本 / 升级前版本 |
| `TRIM_APPDEST` | 应用文件目录（注意 §3.2 的版本差异） |
| `TRIM_PKGETC` / `TRIM_PKGVAR` / `TRIM_PKGTMP` / `TRIM_PKGHOME` / `TRIM_PKGMETA` | etc / var / tmp / home / meta 路径 |
| `TRIM_SERVICE_PORT` | manifest 的 `service_port` |
| `TRIM_USERNAME` / `TRIM_GROUPNAME` / `TRIM_UID` / `TRIM_GID` | 应用专用用户 |
| `TRIM_RUN_USERNAME` / `TRIM_RUN_UID` | 当前执行脚本的用户（可能是 root） |
| `TRIM_DATA_SHARE_PATHS` | data-share 路径，冒号分隔；取第一个：`${TRIM_DATA_SHARE_PATHS%%:*}` |
| `TRIM_DATA_ACCESSIBLE_PATHS` | 用户授权目录（V1.1.8+，冒号分隔） |
| `TRIM_TEMP_LOGFILE` | 用户可见日志文件 |
| `TRIM_APP_STATUS` | 当前阶段：INSTALL/START/UPGRADE/UNINSTALL/STOP/CONFIG |
| `TRIM_SYS_VERSION` / `TRIM_SYS_ARCH` 等 | 系统版本与架构 |

### 8.2 向导变量

**字段名就是环境变量名**，系统不会自动加前缀；官方建议自定义字段自行使用 `wizard_` 前缀，例如 `"field": "wizard_port"` → `${wizard_port}`。不要用 `TRIM_` 前缀（保留给系统变量）。

⚠️ 向导值在**安装/升级/配置**脚本中可靠可用。`cmd/main` 是否继承这些变量取决于系统调用方式，实机不稳；需要运行时使用就：

1. `install_callback` / `config_callback` 中把值写入 `${TRIM_PKGETC}/app.conf`（或 `TRIM_PKGVAR`）；
2. `cmd/main` 中 `source` 该配置文件并给安全默认值。

---

## 9. 入口配置（app/ui/config）

一个应用可定义多个入口。顶层 key 必须是 `.url`：

```json
{
    ".url": {
        "myapp.main": {
            "title": "我的应用",
            "icon": "images/icon_{0}.png",
            "type": "url",
            "protocol": "http",
            "port": "8787",
            "url": "/",
            "allUsers": true
        }
    }
}
```

### 9.1 字段说明

| 字段 | 说明 |
|------|------|
| `title` | 桌面图标 / 右键菜单名称 |
| `icon` | 相对 ui/ 目录；`{0}` 占位，系统替换为 64/256 等尺寸 |
| `type` | `url`=浏览器标签页或外部 WebView；`iframe`=飞牛桌面窗口内打开 |
| `protocol` | `http`/`https`；**空字符串 `""` 表示交给系统自适应**（推荐网关入口使用） |
| `port` | 端口服务的应用端口。**桌面入口地址由它拼出，必须与实际监听端口一致**（§15-4）；网关/CGI 入口忽略 |
| `url` | 入口打开的路径；端口服务如 `/`，网关如 `/app/myapp`，CGI 如 `/cgi/ThirdParty/<appname>/index.cgi/` |
| `allUsers` | `false`=仅管理员可见 |
| `fileTypes` / `noDisplay` | 文件右键入口：关联类型、是否不在桌面显示 |
| `control.accessPerm` | `editable` / `readonly` / `hidden`，控制应用设置中该入口是否可改、只读或隐藏 |

### 9.2 统一网关模式（推荐）

官方流程：应用注册 `gatewayPrefix` → 服务监听 `gatewaySocket` 声明的 Unix Socket → 用户访问网关路径 → fnOS 校验 NAS 会话 → 转发到 `/var/apps/<appname>/target/<socket名>` → 应用从 `X-Trim-*` 头读取用户上下文。

```json
{
    ".url": {
        "myapp.main": {
            "title": "我的应用",
            "icon": "images/icon_{0}.png",
            "type": "iframe",
            "protocol": "",
            "gatewayPrefix": "/app/myapp",
            "gatewaySocket": "app.sock",
            "url": "/app/myapp",
            "allUsers": true
        }
    }
}
```

- `gatewayPrefix`：`/app/{appname}` 或 `/app/{appname}/{customPath}`，跨版本保持稳定，避免点号。
- `gatewaySocket`：**只写文件名**（如 `app.sock`），Socket 必须创建在已安装应用的 `target` 目录（网关固定转发到 `/var/apps/<appname>/target/<socket名>`）。脚本里用 `${TRIM_APPDEST}` 定位；旧布局（`TRIM_APPDEST=/var/apps/<appname>`）需取 `${TRIM_APPDEST}/target`。
- 网关入口**忽略** `protocol` 与 `port`；manifest 里**不声明** `service_port`。
- 官方转发的用户头：`X-Trim-Userid`（UID）、`X-Trim-Isadmin`（`true`/`false`）、`X-Trim-Username`。网关只校验"已登录"，业务权限仍由应用自己判断。
- WebSocket 复用同一前缀与 Socket，建议放在稳定子路径（如 `/app/myapp/ws`）。
- `os_min_version` 按**实测支持网关的系统版本**填写（本项目为 `1.1.3100`）；网关文档未强制绑定特定版本，别照抄未验证的版本号。
- 好处：免端口冲突、免 checkport、天然鉴权、移动端可用；前端用相对路径 `/app/myapp/api/...`，本地与线上零差异。

### 9.3 双版本交付（url / iframe）

本项目建议按需构建两种入口：`type:"url"`（浏览器标签页，体验完整）与 `type:"iframe"`（桌面窗口内嵌）。iframe 版注意登录态：**优先用统一网关**（与 fnOS 同源，不受第三方 Cookie 拦截）；若用独立端口，浏览器可能按第三方上下文拦截会话 Cookie，表现为密码正确仍回登录页。此时发 `url` 版，或改用网关入口（§15-9）。

### 9.4 网关模式前端铁律（实战必读）

> 以下五条全部来自真实实机事故：0.8.0 打开无样式、0.8.1 初始化报“跨站请求被拒绝”。新应用照此实现，可一次避开。

**① 入口 URL 可能没有尾斜杠，相对资源会解析错位**

- `ui/config` 写 `"url": "/app/myapp"`（官方示例就是这样）时，浏览器把它当“文件”地址，页面里的 `style.css` / `app.js` 被解析到 `/app/style.css`、`/app/app.js`；网关只转发 `/app/myapp/*` → 两个资源 404，页面退化成裸 HTML，`app.js` 不执行连登录表单都不显示。
- 修复：服务端返回 HTML 时按**原始请求路径**注入 `<base href="/app/myapp/">`；直连调试注入 `<base href="/">`。不要写死在 `index.html` 里——同一份 HTML 要同时服务两种入口。
- CSP 的 `base-uri` 必须从 `'none'` 改为 `'self'`，否则浏览器拒绝注入的 `<base>`。
- 验证：访问**不带斜杠**的入口，`document.baseURI` 应为 `http://host/app/myapp/`，`document.styleSheets.length > 0`，控制台无 404。

**② 静态资源与 SPA 兜底必须分流**

- 无扩展名路径 → 回 `index.html`（前端路由）。
- **有扩展名但文件不存在 → 直接 404**，不能回 `index.html`；否则浏览器把 HTML 当 JS/CSS 执行，报 MIME/语法错误，真正的 404 被掩盖。
- 托管前先 `path.resolve` 再校验结果仍在 `public/` 根内，防目录穿越。

**③ 同源 / CSRF 校验不能只看 `Origin` 与 `Host`**

- 网关反代到 Unix Socket 时会**改写 `Host`**：浏览器 `Origin` 是 `http://nas:5666`，服务端看到的 `Host` 是转发地址，两者天然不等 → 所有写请求被误判跨站，表现为初始化/登录提交时报“跨站请求被拒绝”。
- 做法：前端所有 `fetch` 统一带自定义头 `x-<appname>-client: 1`；服务端见到该头即视为“同源页面发出的请求”，跳过 `Origin`/`Host` 比对；**不带该头的请求仍按原逻辑严格校验**，`ALLOWED_ORIGINS` 白名单继续生效。
- 为什么够安全：HTML 表单无法伪造自定义头；跨站 `fetch` 加自定义头会触发 CORS 预检，而本服务不返回 CORS 头，浏览器直接拦下。
- 会话 Cookie 用 `HttpOnly; SameSite=Strict; Path=/`；网关 iframe 与页面同源，Strict 不影响使用。
- 反向提醒：**不要信任客户端自造的 `X-Trim-*` 头**。它们只应由网关注入；直连端口调试时应忽略这些头。

**④ API 基址从 `location.pathname` 推导**

```js
// 直连 /app 网关都成立，别写死绝对地址
const API_BASE = (() => {
  const m = location.pathname.match(/^\/app\/([^/]+)/);
  return m ? `/app/${m[1]}/api` : '/api';
})();
```

**⑤ iframe 与 CSP 分模式放行**

- 网关模式：`X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'`。
- 直连模式：`X-Frame-Options: DENY` + `frame-ancestors 'none'`。
- `script-src 'self'`（不要内联脚本）；`style-src 'self' 'unsafe-inline'` 兼容内联样式；`connect-src 'self'` 保证 API 可达。

### 9.5 index.cgi 轻量入口（可选）

适合纯静态页面或简单包，不适合常驻服务：

- 入口 `url` 固定为 `/cgi/ThirdParty/<appname>/index.cgi/`，CGI 文件放 `app/ui/index.cgi`（打包工具会处理可执行权限）；`protocol` / `port` 被忽略。
- fnOS 调用 CGI 前会校验 NAS 登录态；CGI **不支持 WebSocket**，每次请求启动一个进程，高流量 API 应改用网关。
- 静态映射要点：`BASE_PATH=/var/apps/<appname>/target/www`；拒绝含 `..` 的路径；缺失文件返回 404；按扩展名输出正确 MIME（HTML/CSS/JS/图片）。`BASE_PATH` 必须与安装后的实际路径一致。

---

## 10. 用户向导（wizard/）

`wizard/install`、`wizard/config`、`wizard/upgrade`、`wizard/uninstall` 各为 JSON 数组（步骤→表单项）：

```json
[
  {
    "stepTitle": "创建管理员账号",
    "items": [
      { "type": "text", "field": "wizard_admin_username", "label": "管理员用户名",
        "initValue": "admin",
        "rules": [ { "required": true, "message": "请输入用户名" },
                   { "min": 3, "max": 20, "message": "长度 3-20 个字符" } ] },
      { "type": "password", "field": "wizard_admin_password", "label": "管理员密码",
        "rules": [ { "required": true, "message": "请输入密码" },
                   { "min": 8, "message": "不少于 8 位" } ] },
      { "type": "select", "field": "wizard_db_type", "label": "数据库",
        "initValue": "sqlite",
        "options": [ { "label": "SQLite（推荐）", "value": "sqlite" },
                     { "label": "MariaDB", "value": "mariadb" } ] },
      { "type": "switch", "field": "wizard_backup", "label": "自动备份", "initValue": "true" }
    ]
  }
]
```

- 支持类型：`text` / `password` / `radio` / `checkbox` / `select` / `switch` / `tips`。
- **`field` 名即环境变量名**（官方不自动加前缀）；自定义字段建议统一 `wizard_` 前缀（§8.2）。
- 校验规则：`required` / `min` / `max` / `len` / `pattern`，每条带 `message`。脚本里仍需按字符串再校验一次。
- 卸载向导常放"保留数据 / 彻底删除"单选，逻辑由 `uninstall_callback` 执行。
- `wizard/` 目录必须存在，但可以是空目录（fnpack 打包检查要求）。

---

## 11. 运行时环境与依赖

fnOS 应用中心里确有 Node/Python/Java 等**运行时应用**，可在 manifest 用 `install_dep_apps` 声明依赖。但官方 Manifest 文档只定义该字段为"依赖应用"，**不保证运行时包名/版本在所有系统版本一致**——下表是实机观察，使用前先在目标设备 `ls /var/apps` 确认。**最稳的做法仍是自带运行时随包发布**（见本节末）。

| 运行时 | 包名示例 | 脚本中路径 |
|--------|----------|------------|
| Node.js | `nodejs_v22`（另有 v14/16/18/20，新版见过 `nodejs_v24`） | 用 `readlink -f /var/apps/nodejs_v22[/target]` 解析，不写死存储卷 |
| Python | `python312`/`311`/`310`/`39`/`38` | `/var/apps/python312/target/bin` |
| Java | `java-21-openjdk` / `17` / `11` | 同上规律 |
| 中间件 | `redis`（127.0.0.1:6379）、`minio`（:9000）、`rabbitmq`（:5672）、`mariaDB` | 连接串均走 127.0.0.1 |

⚠️ **`install_dep_apps` 坑（重要）**：fnOS 1.1.31xx+ 的包校验器会因该字段**拒绝安装**（"应用包格式不符合系统版本要求"），即使官方文档声明支持。通用做法：

- 优先把运行时二进制/依赖**随包携带**（构建期 `npm install --omit=dev`、Go 静态编译、Python 零依赖），manifest 不写 `install_dep_apps`。
- 必须依赖系统运行时的应用，先在同版本 fnOS 上用 `fnpack create` 模板 + 仅加该字段做最小安装验证，确认支持后再启用。

Node.js 应用 PATH 写法（用软链解析，**不要硬编码 `/vol4`**——存储卷编号因设备而异）：

```bash
RUNTIME_DIR="$(readlink -f /var/apps/nodejs_v22/target 2>/dev/null || readlink -f /var/apps/nodejs_v22 2>/dev/null)"
if [ -n "$RUNTIME_DIR" ] && [ -d "$RUNTIME_DIR/bin" ]; then
  export PATH="$RUNTIME_DIR/bin:$PATH"
else
  echo "未找到 nodejs_v22 运行时" > "$TRIM_TEMP_LOGFILE"
  exit 1
fi
```

这样同时兼容 `target/` 旧布局与新版直接指向 `@appcenter/<appname>` 的布局。

---

## 12. Native 应用本地开发模式（核心）

目标：本地开发与 fnOS 上运行**共用一套代码**，切换只靠环境变量。

### 12.1 四个关键环境变量

| 变量 | 本地开发 | 安装到 fnOS（cmd/main 中 export） |
|------|----------|-----------------------------------|
| `PORT` | 监听 TCP 端口（如 5001） | 留空 |
| `SOCKET_PATH` | 留空 | `${TRIM_APPDEST}/app.sock`（统一网关模式） |
| `GATEWAY_PREFIX` | `/app/<appname>`（提前模拟网关路径） | `/app/<appname>` |
| `DATA_DIR` | `./data` | `${TRIM_PKGVAR}`（运行数据）；需要用户可见的文件再放 `data-share`，用 `${TRIM_DATA_SHARE_PATHS%%:*}` |

服务启动逻辑：`SOCKET_PATH` 非空则监听 Unix Socket，否则监听 `PORT`。

### 12.2 用户区分

- fnOS 统一网关转发时带 `X-Trim-Userid` 头；后端据此给每个用户隔离数据文件。
- 本地开发无此头，回落为 `local` 用户。

### 12.3 静态资源与 SPA

- 构建脚本把前端产物拷到 `dist/public/`；后端按优先级选择：`FRONTEND_DIST` 环境变量 → `./public` 本地目录。
- SPA 路由：**只有无扩展名的路径**才回 `index.html`；带扩展名但文件不存在必须 404（见 §9.4 ②）。
- 双前缀挂载（`/` 与 `GATEWAY_PREFIX`）保证本地直接访问与网关前缀访问都可用。

### 12.4 本地验证流程

```bash
npm install --workspaces
npm run start        # build 前端 + 起后端
# 访问 http://localhost:5001/app/myapp
```

本地页面能打开、功能闭环（保存/读取）之后才进入打包环节。

---

## 13. 构建与打包流程

### 13.1 构建脚本（Node.js 前后端 monorepo 模板，见附录 B）

1. `vite build` 前端 → `frontend/dist`。
2. 合并：`backend` 源码 + 前端产物 → `dist/`，生成合并 `package.json`，`npm install --omit=dev` 到 `dist`。
3. 清空并复制 `dist/*` → `<appname>/app/server/`。
4. `fnpack build --directory <appname>`。

产物：`<appname>.fpk`（本质是 tar.gz：`app.tgz` + cmd/ + config/ + wizard/ + manifest + 图标）。

### 13.2 打包前必做

```bash
# 权限归一（scp/tar 往返极易把目录变成 700，导致 fnpack 报 permission denied）
find . -type d -exec chmod 755 {} \;
find . -type f -exec chmod 644 {} \;
chmod 755 cmd/*
# 不要直接塞 app.tgz：fnpack 只接受 app/ 目录
```

### 13.3 图标规范

| 文件 | 要求 |
|------|------|
| `ICON.PNG` / `ICON_256.PNG` | fnpack **强制要求存在**；按模板提供 64×64 / 256×256，正方形、PNG（应用中心上架时另有尺寸规范） |
| `ui/images/icon_64.png`、`icon_128.png`、`icon_256.png` | 入口图标，`{0}` 占位按尺寸取文件 |
| 圆角 | 官方标准：画布边长 × **18.75%**（256→48px 圆角；512→96px；128→24px）；官方 PSD 底版可从 fnnas 静态站下载 |

### 13.4 版本号约定

官方只要求 `version` 是合法版本串（示例 `1.0.0`、`2.1.3-beta`）。以下为**本项目约定**，不是平台强制：

- 采用四位版本 `X.Y.Z.N`：`N` 为测试迭代号。测试包文件名带 `-test`，只累加第 4 位；用户明确说"打包正式版"才升第 3 位并去掉 `-test`。
- 包装上游应用：直接沿用上游官方版本号，不加 `.01` 之类的重打包后缀。
- `manifest`、代码内 `APP_VERSION`、前端展示版本三处必须一致；界面版本号写在署名「by Mr lin」之前。
- fpk 是构建产物：进 Release 附件，不进 git；仓库 `.gitignore` 加 `*.fpk`，构建素材（`scripts/`）保留。

### 13.5 产物自检（不装 NAS 也能核对）

`.fpk` 本质是 **tar.gz**（不是 ar/deb）：外层含 `manifest`、`cmd/`、`config/`、`ui/` 与 `app.tgz`；`app.tgz` 里就是 `app/` 目录的内容（本仓库为 `server/`、`ui/`、`www/` 等）。用 `ar x` 会报 `file format not recognized`。

```bash
rm -rf /tmp/fpk-check && mkdir -p /tmp/fpk-check && cd /tmp/fpk-check
tar xzf /path/to/myapp-1.2.3-x86.fpk     # 外层
tar xzf app.tgz                          # 内层：server/ 等
grep '^version' manifest                 # 版本必须与预期一致
grep -c 'x-myapp-client' server/src/http.js   # 修复代码真的进包了吗
grep -o "VERSION = 'v[0-9.]*'" server/public/app.js
```

必查四项：**manifest 版本**、**入口 `ui/config`**、**本次修复涉及的源文件**、**前端资源确实在 `server/public/` 下**。打包脚本若会临时改写 manifest（如按架构写 `platform`），要确认打包后已还原。

---

## 14. 安装测试清单（逐项打勾后才算完成）

- [ ] 应用中心手动安装成功。官方同时提供 `appcenter-cli install-fpk <app.fpk>`（带向导可用 `--env config.env`）；若目标设备没有该命令，改用 Web UI 手动安装（实机 1.1.31xx 曾缺失，先 `appcenter-cli --help` 确认）。
- [ ] 应用卡片可打开，入口 URL/iframe 正常。
- [ ] **用不带尾斜杠的入口打开**（如 `/app/myapp`）：CSS/JS 全部 200，`document.baseURI` 正确，控制台无 404（见 §9.4 ①）。
- [ ] 初始化 / 登录 / 保存等**写操作**能成功，不报“跨站请求被拒绝”（见 §9.4 ③）。
- [ ] 缺失的静态文件返回 404 而非 `index.html`；SPA 路由能正常回首页（见 §9.4 ②）。
- [ ] 多用户场景：不同用户只看到自己的数据（验证 `X-Trim-Userid` 隔离）。
- [ ] 启停状态：应用中心 启动/停止/状态 与 `cmd/main` 行为一致；status 未运行时退出码非 0。
- [ ] 数据写入声明的 data-share 目录；`/var/apps/<appname>/share/<name>` 软链可用。
- [ ] 日志写入 `${TRIM_PKGVAR}/<appname>.log`；生命周期日志在 `/var/log/apps/<appname>.log`。
- [ ] 停止后再启动可恢复；连续两次 停止→启动 无端口残留。
- [ ] 升级路径：旧版本→新版本，`upgrade_init/callback` 幂等、数据不丢。
- [ ] 卸载路径：保留数据（默认）与彻底删除（wizard 选项）各验一次。
- [ ] 飞牛 App（移动端）打开行为符合预期（iframe 容器限制）。

---

## 15. 常见故障与排查（现象 / 根因 / 修复 / 教训）

| # | 现象 | 根因 | 修复 | 教训 |
|---|------|------|------|------|
| 1 | 安装正常但服务永远不自动拉起，生命周期日志只有 `stopped` | `cmd/main status` 停止时误返回 0，fnOS 认为在运行、从不调 start | status 停止分支 `return 1`；`bash cmd/main status; echo $?` 验证 | status 的退出码是 fnOS 的拉起判据，模板必须带 |
| 2 | 安装报"应用包格式不符合系统版本要求"（1.1.31xx+） | **官方文档称 `install_dep_apps` 受支持，但实机该校验器曾拒绝含该字段的包**；也可能是个别字段/结构与同版本校验器不匹配 | 先做最小化：移除 `install_dep_apps` 改随包携带运行时；再与同机 `fnpack create` 模板逐字段 diff 定位 | 同机先装模板应用，再 diff 两个解包目录；以实机校验结果为准，并在 §11 记录版本 |
| 3 | "本地应用启动失败 / 拒绝了我们的连接请求" | `ui/config` 的 `port` 与 `service_port`/实际监听端口不一致；或 `TRIM_APPDEST` 布局差异导致 `cd .../target/server` 失败；或 DATA_DIR 默认值落在只读的 appcenter 目录 | 端口两处保持同步（或 `${wizard_port}`）；cmd/main 双布局探测 `server/` 与 `target/server/`；DATA_DIR 默认 `${TRIM_PKGVAR}` 且启动时 `mkdir -p` | 端口/路径"改一漏三"是启动失败最常见根因，改端口后全仓搜索旧端口 |
| 4 | 应用中心显示 running，但访问的是旧版本 | 手动 SSH 启动的残留进程占用端口，新服务 bind 失败；残留进程以应用用户/其他用户运行，跨用户 kill 无权限 | `ss -tlnp` 找占位 pid；请用户在应用中心执行停止（fnOS 以 root 停）后重新启用；仍不行则重启 fnOS | `cmd/main stop` 的 pkill 模式必须匹配**真实运行 cmdline**（如 `next-server` 而非脚本路径），否则孤儿进程无法被回收 |
| 5 | `fnpack build` 报 `mkdir /tmp/fnpack.XXX/app/ui: permission denied` | 源目录被 tar/scp 变成 700，fnpack 复制保留权限 | 打包前 `find` 归一 755/644 | 见 §13.2，进 CI 固化 |
| 6 | `install_init` 里 `mkdir -p $TRIM_PKGVAR` 报 Permission denied | 安装期 `TRIM_PKGVAR`（@appdata）目录尚未创建/不可写 | 一切产物随 `app/` 携带，install_init 做成 no-op（`exit 0`）；首次运行的初始化延迟到 `cmd/main start` | 安装期可写路径只有下载目录，别依赖 PKGVAR |
| 7 | 向导收集的值在 cmd/main 里全为空 | 向导变量（`wizard_*`）只在安装/配置期注入，运行时脚本拿不到 | install_callback 落盘到 `${TRIM_PKGVAR}/app.conf`，cmd/main `source` + 默认值 | 见 §8.2，运行时一切以配置文件为准 |
| 8 | scp 到带空格路径（`/vol1/1000/fnOS App/`）"成功"但文件没更新 | sftp 子系统对远程空格路径解析错误，静默失败 | scp 到 `/tmp` 再 ssh `cp` 到目标；`md5sum` 校验 | NAS 侧路径含空格一律中转 /tmp |
| 9 | iframe 版登录不上（密码正确仍回登录页） | 浏览器把 iframe 内请求当第三方上下文，拦截会话 Cookie；或 `SameSite=None` 缺 `Secure` 被丢弃 | 优先改**统一网关**入口（与 fnOS 同源，无第三方 Cookie 问题）；或发 `type:"url"` 版；或调整 Cookie 属性 | 打包前 curl 登录接口看 `Set-Cookie` 的 `SameSite`/`Secure`；同源网关优先于折腾 Cookie |
| 10 | ARM 离线包在 x86/ARM 上 `wrong ELF class` | 原生 node_modules 在另一架构容器里编译 | 各架构产物在**对应架构**环境编译；ARM 用 manylinux_2_28_aarch64 容器（glibc≤2.28 兼容 fnOS） | 离线包命名带 `-x86`/`-arm`，`platform` 字段同步改 |
| 11 | 网关入口能打开，但页面完全没有样式、登录表单也不显示 | `ui/config` 的 `"url": "/app/myapp"` 无尾斜杠，相对 `style.css`/`app.js` 被解析到 `/app/*`，网关不转发 → 404，`app.js` 未执行 | 服务端按原始请求路径注入 `<base href="/app/myapp/">`（直连注入 `/`），CSP `base-uri` 由 `'none'` 改 `'self'` | 网关入口不能假设带斜杠；本地必须用**裸前缀**验证，只测 `/app/myapp/` 会漏 |
| 12 | 初始化/登录提交报“跨站请求被拒绝”（403） | 网关反代到 Unix Socket 时改写 `Host`，`Origin.host ≠ Host`，同源校验误杀所有写请求 | 前端统一带自定义头 `x-<appname>-client: 1`，服务端据此视为同源；缺头仍严格校验，白名单保留 | 在反代后面，`Origin` 与 `Host` 不可作为同源唯一判据；用自定义头或 CSRF token |
| 13 | 缺失的 `app.js` 返回 HTML，控制台报 MIME/语法错误 | SPA 兜底把带扩展名的请求也回 `index.html` | 按扩展名分流：无扩展名回 `index.html`，有扩展名不存在直接 404 | 兜底路由最容易把 404 伪装成“奇怪的前端报错” |
| 14 | 解包核对发现修复没进包 / 版本号不对 | 打包脚本复制了旧产物，或 manifest 被按架构临时改写后未还原 | 按 §13.5 解包自检四项后再分发 | 「本地跑通」≠「包里是新的」；分发前必须验包 |

通用排查顺序：**看两份日志**（`/var/log/apps/<appname>.log` + 应用自身 log）→ `ss -tlnp` 看端口 → `ps aux | grep` 看进程与运行用户 → 按上表定位。定位后按"现象/根因/修复/教训"格式补录到本表。

---

## 附录 A：cmd/main 健壮模板（Node.js + 统一网关）

```bash
#!/bin/bash
LOG_FILE="${TRIM_PKGVAR}/<appname>.log"
PID_FILE="${TRIM_PKGVAR}/app.pid"

# 运行时 PATH（用软链解析，不硬编码存储卷编号）
RUNTIME_DIR="$(readlink -f /var/apps/nodejs_v22/target 2>/dev/null || readlink -f /var/apps/nodejs_v22 2>/dev/null)"
if [ -n "$RUNTIME_DIR" ] && [ -d "$RUNTIME_DIR/bin" ]; then
  export PATH="$RUNTIME_DIR/bin:$PATH"
else
  echo "未找到 nodejs_v22 运行时" > "$TRIM_TEMP_LOGFILE"
  exit 1
fi

# 应用目录：兼容 TRIM_APPDEST 直接指向 target 或仍带 target/ 层的两种布局
APP_DIR="${TRIM_APPDEST}"
if [ -d "${APP_DIR}/target" ]; then APP_REAL="$(readlink -f "${APP_DIR}/target")"; else APP_REAL="$(readlink -f "${APP_DIR}")"; fi
if [ -d "${APP_REAL}/server" ]; then
  SRC_DIR="${APP_REAL}/server"
else
  echo "server dir not found under ${APP_REAL}" > "$TRIM_TEMP_LOGFILE"
  exit 1
fi

# 运行数据放 TRIM_PKGVAR；data-share 只放用户可见文件
DATA_DIR="${TRIM_PKGVAR}"
mkdir -p "$DATA_DIR" 2>/dev/null

GATEWAY_PREFIX="/app/<appname>"
SOCKET_PATH="${APP_REAL}/app.sock"
PORT="${TRIM_SERVICE_PORT:-8787}"

log_msg() { echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"; }

check_process() { local pid="$1"; kill -0 "$pid" 2>/dev/null; }

status_app() {
  if [ -f "$PID_FILE" ]; then
    local pid; pid="$(head -n 1 "$PID_FILE" | tr -d '[:space:]')"
    if [ -n "$pid" ] && check_process "$pid"; then return 0; fi
    rm -f "$PID_FILE"
  fi
  return 1
}

start_app() {
  if status_app; then return 0; fi
  log_msg "Starting <appname>..."
  cd "$SRC_DIR" || { echo "cd $SRC_DIR failed" > "$TRIM_TEMP_LOGFILE"; exit 1; }
  DATA_DIR="$DATA_DIR" GATEWAY_PREFIX="$GATEWAY_PREFIX" SOCKET_PATH="$SOCKET_PATH" \
    nohup node server.js >> "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  # 健康检查（可选）：curl 端口或 socket 5s 轮询，失败写 TRIM_TEMP_LOGFILE 并 exit 1
}

stop_app() {
  log_msg "Stopping <appname>..."
  [ -f "$PID_FILE" ] || return 0
  local pid; pid="$(head -n 1 "$PID_FILE" | tr -d '[:space:]')"
  if [ -z "$pid" ] || ! check_process "$pid"; then rm -f "$PID_FILE"; return 0; fi
  kill -TERM "$pid" 2>/dev/null
  local i=0
  while check_process "$pid" && [ $i -lt 10 ]; do sleep 1; i=$((i+1)); done
  check_process "$pid" && kill -KILL "$pid" 2>/dev/null
  rm -f "$PID_FILE" "$SOCKET_PATH"
  # 兜底清理残留（pkill 模式必须匹配真实 cmdline）
  pkill -f "node .*${SRC_DIR}/server.js" 2>/dev/null
}

case "$1" in
  start)  start_app ;;
  stop)   stop_app ;;
  status) if status_app; then exit 0; else exit 3; fi ;;
  *) echo "Unknown command: $1" > "$TRIM_TEMP_LOGFILE"; exit 1 ;;
esac
```

## 附录 B：构建脚本要点（Node.js monorepo）

```javascript
// scripts/build-combined.js（伪代码摘要）
run('npm run build', frontendDir);                    // vite build
emptyDir(outDir);
fs.cpSync(backendDir, outDir, { recursive: true, filter: s => !s.endsWith('node_modules') });
fs.cpSync(path.join(frontendDir, 'dist'), path.join(outDir, 'public'), { recursive: true });
// 写合并 package.json（main=server.js，dependencies 取 backend）
run('npm install --omit=dev', outDir);                 // 依赖随包携带（离线可装）
emptyDir(packServerDir);                                // <appname>/app/server
fs.cpSync(outDir, packServerDir, { recursive: true });
run(`fnpack build --directory ${packDir}`);
// CI 末尾：权限归一（§13.2）→ 校验 fpk 存在 → 上传 Release
```

前端资源用**相对路径**（Vite `base: './'`），由服务端按入口注入 `<base>`（§9.4 ①）——这样同一份构建既能直连 `/` 也能走 `/app/<appname>/`。若把 `base` 写死成 `'/app/<appname>/'`，直连调试会全部 404，只能维护两套构建。dev server 用 proxy 把 `/app/<appname>` 转到本地后端端口，模拟网关路径。

## 附录 C：文件最小集（新应用脚手架 checklist）

```
manifest（§4）          必填，KEY=VALUE
ICON.PNG / ICON_256.PNG  64/256，§13.3
app/ui/config（§9）     顶层 .url，入口 ID = manifest 的 desktop_applaunchname
app/ui/images/icon_*.png
cmd/（官方 9 个脚本）    main 按附录 A；install_callback 按场景；其余可 no-op
config/privilege（§5）  合法 JSON（run-as=package）
config/resource（§6）   合法 JSON（无资源共享时可写 {}）
wizard/                 目录必须存在，可为空；需要用户输入时按 §10
```

---

## 附：与官方文档的对应关系

| 本文章节 | 官方文档（2026-10-26 核对） |
|----------|----------|
| §1/§3 架构与目录 | https://developer.fnnas.com/docs/core-concepts/framework/ |
| §4 manifest | https://developer.fnnas.com/docs/core-concepts/manifest/ |
| §5 权限 | https://developer.fnnas.com/docs/core-concepts/privilege/ |
| §6 资源 | https://developer.fnnas.com/docs/core-concepts/resource/ |
| §9 入口 / 网关 / CGI | https://developer.fnnas.com/docs/core-concepts/app-entry/ ・ .../gateway-registration/ ・ .../index-cgi/ |
| §10 向导 | https://developer.fnnas.com/docs/core-concepts/wizard/ |
| §13 打包 | https://developer.fnnas.com/docs/cli/fnpack/ |
| §13/§14 安装测试 | https://developer.fnnas.com/docs/cli/appcentercli/ |
| §8 环境变量 | https://developer.fnnas.com/docs/core-concepts/environment-variables/ |
| §12 本地开发 | 官方 Notepad Native 案例（本文主要蓝本）＋ 本项目实机经验 |

> 官方文档站为 SPA 渲染，静态抓取有时只拿到导航骨架；本文已把关键内容固化。**官方与实机冲突时以实机为准，并在此标注**；后续仍以 `fnpack create` 生成的最新模板为最终基准。
