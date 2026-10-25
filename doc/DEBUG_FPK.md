# .fpk 安装报错排查记录（DEBUG）

## 一、现象

| 项 | 值 |
|----|----|
| 应用 | 网站哨兵 Site Guard（Node.js 22 + SQLite + nodemailer 邮件告警） |
| 交付形态 | 飞牛 fnOS 原生应用 `.fpk` |
| 问题版本 | 0.7.0 / 0.7.1 |
| 系统环境 | fnOS 1.2.08（x86 Intel/AMD） |
| 打包工具 | fnpack 1.2.3（Windows 与 WSL/Linux 各一） |
| 报错 | 应用中心安装时提示「应用包格式不符合系统版本要求」 |

## 二、排查时间线

| # | 尝试 | 结果 | 结论 |
|---|------|------|------|
| 1 | 0.7.0 原始包（manifest 含 `os_min_version=1.1.3100`、`checkport=false`，含 wizard 文件，ui/config 为统一网关 iframe） | 报「包格式不符合系统版本要求」 | 起点 |
| 2 | 假设 `os_min_version`/`checkport`：删除两字段 → 0.7.1 重打包 | 同样的报错 | 这两个字段非单独根因 |
| 3 | 假设 Windows 打包 CRLF/丢可执行位：改 WSL 打包（LF + -rwxr-xr-x） | 还是同样的报错 | CRLF/权限非根因 |
| 4 | 官方裸模板 `fnpack create testapp` | 能安装（空壳无服务，打开即停用，属预期） | 排除 fnpack 版本/格式本身 |
| 5 | 裸模板 + 中文 desc/display_name | 能安装 | 排除中文 |
| 6 | 裸模板 + `version=0.7.1` | 能安装 | 排除 version 值 |
| 7 | 裸模板 + 项目 manifest + 项目 ui/config | fnpack 报 entry name 与 appname 不一致 | 构造 bug，作废 |
| 8 | 裸模板 + 单 share（diag-resource-1share） | 对照官方文档确认 resource 格式合法 | 弱化，见 §三 |
| 9 | 裸模板 + username/groupname（diag-privilege-user） | 对照官方文档确认 privilege 合法 | 弱化，见 §三 |
| 10 | 抽包核对 manifest/resource/privilege/framework 官方规范 | 均符合；`checksum` 字段为 fnpack 自动加（两包都有） | 排除 checksum |
| 11 | 逐文件 diff 裸模板 vs 0.7.1 | 唯一结构性差异：裸模板 `wizard/` 为空目录，项目包多了 `wizard/install`、`wizard/uninstall` | 锁定 wizard |
| 12 | 裸模板 + 我的两个 wizard 文件（diag-wizard） | 报「应用包不符合要求，安装不了」 | 确认 wizard 是根因之一 |

## 三、已排除项

- 中文 `desc`、中文 `display_name`
- `version` 值（0.7.1）
- `os_min_version`、`checkport`（单独删除不影响结果，说明非单独根因）
- Windows 打包导致的 CRLF / 丢失可执行位
- `checksum` 字段（fnpack 自动生成，裸模板与项目包均有）
- `config/resource` 单 share 格式（`siteguard/data` 合法）
- `config/privilege` 的 username/groupname（合法）

## 四、已确认根因

`wizard/install`（空数组 `[]`）与 `wizard/uninstall`（卸载开关）两个文件的存在即触发校验器拦截。
fnOS 1.x 校验器对 wizard 内容敏感（本地手册 §10 已预警）。此处可解释 0.7.0 / 0.7.1 无论是否删除 `os_min_version` 都报同样错误——只要 wizard 文件仍在。

## 五、待测项（若去 wizard 后仍报错，依次二分）

1. `app/ui/config` 统一网关入口（iframe / gatewaySocket / gatewayPrefix）
2. `maintainer` / `distributor` = `Mr lin`（含空格）
3. `app/server`（43MB Node 二进制）

## 六、修复方案

- 删除 `fnos/siteguard/wizard/install` 与 `fnos/siteguard/wizard/uninstall`（回归空目录）
- 卸载「保留/清除数据」逻辑**无需改动**：`cmd/uninstall_init` 早已用 `${wizard_purge:-}` 默认值判断，删掉 wizard 表单后该变量恒为空 → 默认保留数据（安全方向）；`cmd/uninstall_callback` 只做幂等兜底 `rm -f app.sock`
- 版本号 0.7.2 多处同步（manifest / package.json / package-lock.json / 界面页脚 / 文档）
- WSL 内重新打包，产出 `siteguard-0.7.2-x86.fpk` / `-arm.fpk`

## 七、教训

- fnOS 应用中心的 `.fpk` 校验比 fnpack 更严格，且报错信息泛化——多个不同格式问题都用同一句「包格式不符合系统版本要求」。
- 定位此类问题应优先用「裸模板 + 单变量」二分，而不是整包盲改。
- 若可 SSH 到 fnOS，`appcenter-cli install-fpk` 能输出更详细的错误，比反复试装高效。
- 生成/打包动作一律在 WSL 内完成。

## 八、当前状态（0.7.2）

- `0.7.2` 已删除 `wizard/install` 与 `wizard/uninstall`，并在 WSL 内重新出包：
  - `dist/fnos/siteguard-0.7.2-x86.fpk`
  - `dist/fnos/siteguard-0.7.2-arm.fpk`
- **待实机试装验证**：若 0.7.2 仍报「包格式不符合系统版本要求」，说明除 wizard 外还有其它变量，按 §五「待测项」顺序继续二分（下一个为 `app/ui/config` 统一网关入口）。