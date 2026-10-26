# 网站哨兵 Site Guard · 部署手册

> 版本：0.8.4 ｜ 日期：2026-10-26 ｜ 作者：by Mr lin

---

## 0. 当前可用性说明（先读）

| 版本 | 状态 | 能做什么 |
| --- | --- | --- |
| 0.6.0 | 后端 + 检测引擎 + 邮件告警 | 可在电脑上用 `npm start` 跑通全链路（站点/页面、真实抓取、四档判定、基线差异、汇总邮件、事件流与设置）；界面只有状态页 |
| 0.7.3 | 飞牛原生应用（.fpk）已实机验证 | 出 x86/arm 两个安装包，走统一网关 + Unix Socket，包内自带 Node 运行时；实机安装通过 |
| 0.8.1 | 正式前端面板 + 飞牛安装包 | 四页签面板接入真实 API；修复飞牛桌面入口（`/app/siteguard` 无尾斜杠）下 CSS/JS 404（服务端注入 `<base>`）；实机已确认样式正常 |
| 0.8.2 | 同源校验修复 | 飞牛网关反代改写 `Host` 导致初始化/登录 403「跨站请求被拒绝」；前端请求带 `x-siteguard-client: 1`，服务端视为同源并跳过 `Origin`/`Host` 比对，缺头仍严格校验；`node scripts/build-fnos.mjs` 出 x86/arm 两个包；fnOS 实机已验证（初始化/登录正常） |
| 0.8.3 | 忽略规则即时生效 | 比对前用当前忽略规则重新过滤基线正文（`baselineText`），哈希、差异与 R-08/R-14 基线字数都按过滤后计算；改忽略规则立即生效，不再需要「设为新基线」；`npm test` 115 条全绿 |
| 0.8.4（当前） | **手机端可用性修复** | 页签加 `flex: none` 不再被压成 1px；`max-width:720px` 下页面表格改卡片，操作按钮换行到底部、不再跑出屏幕；390×844 设备模拟与 1280×800 桌面复核通过；本次为纯前端样式改动，`npm test` 115 条仍全绿 |
| Docker 镜像（0.7.2 起） | 备用路径，已可用 | `docker buildx build --provenance=false --sbom=false -f deploy/Dockerfile ...`；镜像已推阿里云 ACR（`0.8.4` / `latest`，公开可匿名拉取）；第 2 节起是这条路径 |
| 1.0.0 | 正式版 | 实机复核新面板 + 升级/卸载补测 |

> **本文档的推荐路径是第 1 节（原生应用）**；第 2 节起的 Docker 流程是备用方案，镜像已产出、可直接执行。

---

## 1. 部署（飞牛原生应用 .fpk，推荐）

> 0.7.0 起，网站哨兵以 **Native 应用**交付：不依赖 Docker、不占端口，走 fnOS 统一网关（Unix Socket 转发），桌面图标与飞牛 App 移动端都能直接打开。打包流程遵循 [FNOS_APP_DEV_GUIDE.md](FNOS_APP_DEV_GUIDE.md)。

### 1.1 构建安装包（开发机）

```bash
# 前置：Node 22+；fnpack（developer.fnnas.com 下载，Windows/Linux/macOS 均有）
export FNPACK_BIN=/path/to/fnpack     # 不设置则从 PATH 里找 fnpack

node scripts/build-fnos.mjs                 # 默认出 x86 + arm 两个包
node scripts/build-fnos.mjs --arch x64      # 只出一个架构
node scripts/build-fnos.mjs --no-runtime    # 不内置 Node（改用应用中心 nodejs_v22）
node scripts/build-fnos.mjs --no-pack       # 只组装 app/server，不调 fnpack
```

产物：

| 文件 | 说明 |
| --- | --- |
| `dist/fnos/siteguard-<版本>-x86.fpk` | Intel/AMD 机型（platform=x86），当前为 `siteguard-0.8.4-x86.fpk` |
| `dist/fnos/siteguard-<版本>-arm.fpk` | ARM 机型（platform=arm），当前为 `siteguard-0.8.4-arm.fpk` |

脚本做了四件事：组装 `fnos/siteguard/app/server/`（`src` + `public` + 生产依赖，`npm ci --omit=dev`）→ 下载官方 Node 二进制，**只取 `bin/node`** 放进 `server/runtime/<arch>/` → 权限归一（目录 755 / 文件 644，`cmd/*` 与 `runtime/<arch>/node` 为 755）→ 按架构改写 manifest 的 `platform` 后 `fnpack build`，退出时把 manifest 还原。

要点：

- 包内自带运行时，NAS 上**不用装 Node**，manifest 也不写 `install_dep_apps`（fnOS 1.1.31xx+ 会因该字段拒绝安装）。
- `fnos/siteguard/` 是包目录（进版本管理）；`fnos/siteguard/app/server/` 与 `*.fpk` 是构建产物，已在 `.gitignore` 里。
- 一个包只带一个架构的运行时，所以 x86/arm 要分别出包，别拿错。

### 1.2 安装（NAS 上）

1. 应用中心 → 本地安装/手动安装 → 选对应架构的 `.fpk` → 安装（新版 fnOS 只支持 Web UI 手动安装）。
2. 不需要申请端口：manifest 没有 `service_port`，`checkport = false`，统一网关把请求转到 `${TRIM_APPDEST}/app.sock`。
3. 桌面出现「网站哨兵」图标，点击后在 iframe 里打开 `/app/siteguard`。

### 1.3 首次使用

1. 打开应用 → 设置管理密码（至少 8 位）。
2. 添加站点与关键页面（首页/列表页/详情页），选日程（每天固定几点，或每 N 小时一次）。
3. 设置 → 填 SMTP（服务器/端口/授权码/发件人/收件人）→ 点「发送测试邮件」。
4. 点「立即巡检」建立基线，之后按日程自动巡检。

### 1.4 数据、日志与关键路径

| 位置 | 内容 |
| --- | --- |
| 数据目录 | `TRIM_DATA_SHARE_PATHS` 的第一个目录（`config/resource` 声明的 `siteguard/data` share）：`app.db`，备份这一个文件即可 |
| 应用日志 | `${TRIM_PKGVAR}/siteguard.log` |
| 生命周期日志 | `/var/log/apps/siteguard.log`（fnOS 自己记的启停） |
| Socket | `${TRIM_APPDEST}/app.sock`，网关前缀 `/app/siteguard` |

`cmd/main` 三命令：`start` 后台拉起并探活（curl 打 socket 上的 `/api/health`），`status` 未运行返回退出码 3（fnOS 靠这个决定要不要拉起），`stop` 先 TERM 等 10 秒再 KILL。Node 运行时优先级：包内 `server/runtime/<arch>/node` → 应用中心 `nodejs_v22` → 系统 `node`，内置的会先实际执行一次确认可用再用。

### 1.5 升级与卸载

- **升级**：应用中心直接装新 `.fpk`；`upgrade_init` 先清残留 pid/socket，数据在 data-share 目录里，升级不碰。
- **卸载**：默认**保留数据**；卸载向导里打开「彻底删除全部监测数据」才会清空（`wizard_purge=true` 时 `uninstall_init` 才删）。
- 重装后密码、站点、基线、事件都还在。

### 1.6 没有 NAS 时的自检（本机模拟生命周期）

```bash
FAKE=/tmp/sg-fnos && mkdir -p "$FAKE/var" "$FAKE/data"
TRIM_APPDEST="$PWD/fnos/siteguard/app" \
TRIM_PKGVAR="$FAKE/var" TRIM_DATA_SHARE_PATHS="$FAKE/data" \
TRIM_TEMP_LOGFILE="$FAKE/temp.log" TRIM_APPVER=0.8.4 \
  bash -c 'bash fnos/siteguard/cmd/main status; echo "status=$?"; \
           bash fnos/siteguard/cmd/main start;  echo "start=$?"; \
           bash fnos/siteguard/cmd/main status; echo "status=$?"; \
           bash fnos/siteguard/cmd/main stop;   echo "stop=$?"; \
           bash fnos/siteguard/cmd/main status; echo "status=$?"'
# 期望：3 → 0 → 0 → 0 → 3，数据目录里出现 app.db
```

> Windows/Git Bash 也能跑同一套脚本：socket 会映射成命名管道、健康检查退化为“进程存活”判断（fnOS 是 Linux，走严格 curl 探活）；Git Bash 传环境变量时记得加 `MSYS_NO_PATHCONV=1`，否则 `/app/siteguard` 会被改写成 Windows 路径。

---

## 2. 前置条件（Docker 备用路径）

> ⚠️ 从本节到第 10 节都是 **Docker 备用方案**；`deploy/Dockerfile` 已产出、镜像已推阿里云 ACR，日常部署请优先用第 1 节的 `.fpk`。

| 项 | 要求 | 检查方式 |
| --- | --- | --- |
| 飞牛 NAS（fnOS） | 已安装 Docker 应用 | 应用中心 → Docker |
| 网络 | NAS 能出网访问 443（目标站点） | 浏览器打开目标站点 |
| 邮箱 | 支持 SMTP 的邮箱 + **授权码** | QQ/163 在"设置 → 账户"生成 |
| 端口 | 8686 未被占用 | 见"故障排查" |
| 目录 | 想监测的页面 URL 清单 | 建议 3~8 个/站点 |

国内常见 SMTP 参数：

| 邮箱 | 服务器 | 端口 | 加密 |
| --- | --- | --- | --- |
| QQ 邮箱 | `smtp.qq.com` | 465 | SSL（最常用） |
| QQ 邮箱 | `smtp.qq.com` | 587 | STARTTLS |
| 163 邮箱 | `smtp.163.com` | 465 | SSL |
| 阿里企业邮 | `smtp.mxhichina.com` | 465 | SSL |
| Gmail | `smtp.gmail.com` | 587 | STARTTLS（需应用专用密码） |

---

## 3. 部署（Compose）

### 3.1 目录准备

在 NAS 上建一个固定目录（示例 `/vol1/1000/docker/site-guard`），结构：

```
/vol1/1000/docker/site-guard/
├── docker-compose.yml
├── .env                  # 可选，放非敏感配置
└── data/                 # 容器写入：app.db 等（备份对象）
```

> `data/` 由容器自动创建；宿主机上不要手工放文件。

### 3.2 docker-compose.yml

```yaml
services:
  site-guard:
    image: registry.cn-hangzhou.aliyuncs.com/your-ns/site-guard:1.0.0
    # 若使用本地构建，注释掉 image 并启用 build：
    # build: .
    container_name: site-guard
    restart: unless-stopped
    ports:
      - "8686:8686"
    volumes:
      - ./data:/data
    environment:
      TZ: Asia/Shanghai
      PORT: "8686"
      LOG_LEVEL: info
      # 允许抓取内网地址（监控内网站点时打开；只监控公网可设为 false）
      ALLOW_PRIVATE_TARGETS: "true"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8686/api/health"]
      interval: 60s
      timeout: 5s
      retries: 3
      start_period: 20s
    mem_limit: 256m
    security_opt:
      - no-new-privileges:true
    read_only: false
```

要点：

- `TZ` 必须是 `Asia/Shanghai`，否则"每天 09:00"会按 UTC 执行（差 8 小时）。
- `restart: unless-stopped` 保证 NAS 重启后自动拉起。
- 不要挂载 `/var/run/docker.sock`：本项目不需要容器管理权限，挂载等于把整台 NAS 交给一个 Web 应用。
- `mem_limit: 256m` 是保护，实测常驻 50~80 MB。

### 3.3 启动

在飞牛「Docker → Compose → 新增项目」中指向该目录，或在终端：

```bash
cd /vol1/1000/docker/site-guard
docker compose up -d
docker compose logs -f --tail=50
```

看到 `listening on 8686` 即启动成功；首次启动会自动建库（`/data/app.db`）。

### 3.4 首次访问与配置

1. 浏览器打开 `http://NAS内网IP:8686`。
2. 设置管理密码（≥ 8 位），系统自动登录。
3. 进入「设置」填写 SMTP，点「发送测试邮件」，手机收到即通。
4. 「监测 → 新增站点」：填名称、地址、计划（默认每天 09:00、21:00）。
5. 「＋ 页面」逐个添加关键页面，建议填写「必须包含的文字」。
6. 点「立即巡检」跑一轮建立基线，确认判定为"正常"。

---

## 4. 构建镜像（开发者）

### 4.1 Dockerfile（已落地 `deploy/Dockerfile`）

```dockerfile
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8686 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai

WORKDIR /app

# 依赖只有 nodemailer，纯 JS，无编译步骤；国内源加速
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set replace-registry-host always \
    && npm ci --omit=dev \
    && npm cache clean --force

COPY src ./src
COPY public ./public

# SQLite 数据目录（单文件），以非 root 用户运行
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node

EXPOSE 8686
CMD ["node", "src/server.js"]
```

> 上面即仓库里的 `deploy/Dockerfile` 实际内容；健康检查交由 compose 的 `healthcheck` 或外部探活，镜像本身不内置。

### 4.2 本地构建与试跑

```bash
# 在 WSL 的 site-guard 发行版里执行（推荐）
wsl -d site-guard --cd /mnt/e/work/site-guard -- bash
docker build -t site-guard:dev .
docker run --rm -p 8686:8686 -v $PWD/data:/data -e TZ=Asia/Shanghai site-guard:dev
```

> 当前 `site-guard` 发行版内**未安装 Docker**（见 `PROJECT_STATE.md` 待办）。安装前需你确认，因为会改动 WSL 环境。

### 4.3 推送到阿里云 ACR（agent.md 七.7 要求）

```bash
# 注意：需加 --provenance=false --sbom=false，否则 buildx 会生成阿里云 ACR 不支持的 OCI attestation 清单（报 unknown manifest class）
docker buildx build --provenance=false --sbom=false -f deploy/Dockerfile -t site-guard:0.8.4 .
docker tag site-guard:0.8.4 registry.cn-hangzhou.aliyuncs.com/mylxnet/site-guard:0.8.4
docker tag site-guard:0.8.4 registry.cn-hangzhou.aliyuncs.com/mylxnet/site-guard:latest
docker login registry.cn-hangzhou.aliyuncs.com
docker push registry.cn-hangzhou.aliyuncs.com/mylxnet/site-guard:0.8.4
docker push registry.cn-hangzhou.aliyuncs.com/mylxnet/site-guard:latest
```

命名空间 `mylxnet`、仓库 `site-guard` 已就绪；凭据用 `docker login` 交互输入，**不进仓库、不写在 compose 里**。

### 4.4 离线导入（无镜像仓库时的退路）

```bash
docker save site-guard:1.0.0 -o site-guard-1.0.0.tar
# 在飞牛：Docker → 镜像 → 导入 → 选择 tar
```

---

## 5. 备份与恢复

| 操作 | 步骤 |
| --- | --- |
| 备份 | 停止容器（或不停止，SQLite 用 WAL 也能安全复制）→ 打包 `data/` 目录 |
| 恢复 | 停容器 → 用备份覆盖 `data/` → 启动 |
| 迁移 | 同一套 compose + `data/` 拷到新机器即可，无外部依赖 |
| 定时备份 | 建议用飞牛的定时任务：`tar czf /vol1/1000/backup/site-guard-$(date +%F).tgz -C /vol1/1000/docker/site-guard data` |

> 备份里含 SMTP 授权码（加密存储），请与数据库同等保护。

---

## 6. 升级与回滚

```bash
# 升级
docker compose pull && docker compose up -d
# 回滚到指定版本
# 把 compose 里的 image tag 改成旧版本号，再 up -d
```

数据库变更通过 `PRAGMA user_version` 递增迁移，只向前不向后；**回滚大版本前先备份 `data/`**。

---

## 7. 外网访问（可选）

优先方案：**VPN（WireGuard/Tailscale）或飞牛自带远程访问**，不要把 8686 直接映射到公网。

若必须暴露：

**Nginx 反向代理 + HTTPS**

```nginx
server {
    listen 443 ssl http2;
    server_name guard.example.com;

    ssl_certificate     /etc/nginx/cert/guard.pem;
    ssl_certificate_key /etc/nginx/cert/guard.key;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8686;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Caddy（自动证书）**

```
guard.example.com {
    reverse_proxy 127.0.0.1:8686
}
```

安全清单：

- [ ] 已启用 HTTPS（否则密码明文过网）
- [ ] 管理密码 ≥ 12 位且不与其他站点复用
- [ ] 反向代理上限制来源 IP 或加一层认证
- [ ] 不在公网暴露 `/api/health` 之外的调试信息（本应用不提供调试端点）
- [ ] 定期查看「事件」页是否有陌生登录失败

---

## 8. 故障排查

| 症状 | 可能原因 | 处理 |
| --- | --- | --- |
| 打不开页面 | 端口冲突 / 容器未起 | `docker compose ps`、`docker compose logs --tail=100`；改 `ports` 左侧端口 |
| 页面能开但点登录无反应 | 反向代理未传 `Host` | 补 `proxy_set_header Host $host` |
| 时间不对 | `TZ` 未设 | compose 里加 `TZ: Asia/Shanghai` 并重建 |
| 测试邮件失败：535 / EAUTH | 用了登录密码而非授权码 | 去邮箱后台生成授权码 |
| 测试邮件失败：超时 | 端口/加密方式不匹配 | 465 用 SSL，587 用 STARTTLS |
| 所有页面判"无法确认" | 目标站反爬或 NAS 出口 IP 被限 | 降低频率、查看判定理由、必要时抓取频率改为每 6 小时 |
| 每天收到"内容变更"邮件 | 页面有动态内容 | 在页面里补忽略规则（日期、访问量、随机 token） |
| 巡检时间不准 | 容器时区 / 计划配置 | 检查 `TZ` 与站点的 `daily` 时刻 |
| 邮件进垃圾箱 | 发件域名无 SPF | 用常用邮箱、把发件人加入白名单、避免标题含过多符号 |
| 内存持续上涨 | 版本问题 | `docker stats site-guard`，反馈日志 |

日志速查：

```bash
docker logs site-guard --tail=200 | grep -E 'error|mail.fail|check.page'
```

---

## 9. 运行维护

| 周期 | 事项 |
| --- | --- |
| 每周 | 瞄一眼概览页红色数字；确认"下一轮巡检"时间正常 |
| 每月 | 检查一次备份是否可恢复；清理无关事件 |
| 变更站点后 | 点「立即巡检」确认判定正常，再依赖定时任务 |
| 邮箱改密码后 | 立即更新「设置 → 邮件通知」并发送测试邮件 |

---

## 10. 资源与限制

| 项 | 实测/预期 |
| --- | --- |
| 镜像 | 90~120 MB |
| 常驻内存 | 50~80 MB（10 站点 × 5 页） |
| CPU | 空闲接近 0；巡检时瞬时几十毫秒/页 |
| 磁盘 | 数据库每年 < 200 MB |
| 出网 | 仅 443（目标站点）与 SMTP 端口 |
| 不支持 | JS 渲染页（判"无法确认"）、需登录页面、目录文件监测（需授权） |
