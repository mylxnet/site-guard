# 实施计划：开发约定基础合规

## 1. 根级文件
- 新增 `VERSION`（`v0.8.7`）、`LICENSE`（MIT，2026 by Mr lin）、`NOTICE`、`.env.example`。
- 新增 `.trae/rules/name_rules.md`（约定原文）与 `.trae/rules/project_rules.md`（本项目规则，内容取自原根目录 `agent.md`）。
- 删除根目录重复的 `agent.md`（与 `.trae/rules/project_rules.md` 内容完全一致，经确认后移除，规则入口统一为 `.trae/rules/`）。

## 2. License 头
- 新增 `scripts/license.mjs`：检查 `src/`、`scripts/`、`public/`、`test/` 下 `.js`/`.mjs` 是否含 `SPDX-License-Identifier: MIT`；`--fix` 模式在文件头（shebang 之后）插入两行头。
- 运行 `--fix` 补齐 35 个源码文件，再跑检查确认。

## 3. 脚本
- `scripts/service.sh`：`start|stop|restart|status|health|logs`，PID 写 `.service.pid`，日志写 `logs/dev-yyyymmdd.log`。
- `scripts/sdd`：沿用约定脚本，确认 `new|check|archive|list|check-active` 可用。
- `package.json`：新增 `license:check`、`license:fix`、`preflight`（`license:check && npm test`）。
- `.gitignore`：补 `logs/`、`.service.pid`。

## 4. API 合同
- 新增 `docs-framework/specs/api/api.yaml`，覆盖现有公开接口与鉴权接口，响应统一为 `{ ok, data }` / `{ ok, error }`。
- 不修改任何路由路径。

## 5. 版本与文档
- 版本升到 `0.8.7`：`package.json`、`package-lock.json`（两处）、`fnos/siteguard/manifest`、`public/index.html`、`public/app.js`。
- 文档同步：README（badge/阶段/结构树/命令）、CHANGELOG（0.8.7）、DESIGN、PROJECT、PROJECT_STATE、TEST、DEPLOY。
- 重新出 x86/arm `.fpk`，不推送 ACR、不发 Release（另行确认）。

## 6. 验证
- `npm run preflight` 全绿（license + 124 测试）。
- `./scripts/service.sh start|status|health|stop` 实测。
- `./scripts/sdd list` / `check conventions-retrofit implement` 实测。
- 浏览器复核登录页与面板无变化（版本号显示 0.8.7）。
