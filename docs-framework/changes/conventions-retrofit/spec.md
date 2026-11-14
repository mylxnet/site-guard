# Feature Specification: 开发约定基础合规

## 1. Overview
**Summary**: 按《开发约定》A 档范围补齐项目根级合规文件、源码 SPDX 头、SDD 文档骨架与统一服务脚本，不改变现有 API 路径与业务行为。
**Rationale**: 项目已发布到 0.8.6，但缺少版本单一来源、许可证文件、源码版权头、SDD 规格目录与统一启停入口，长期维护容易出现版本不一致与流程缺失。

## 2. User Scenarios (User Stories)

- **Scenario 1**: 维护者查看版本
  - **Input**: 打开仓库根目录
  - **Output**: `VERSION` 单行给出当前版本，且与 `package.json`、界面页脚、文档一致
  - **Constraint**: 不引入额外运行时依赖

- **Scenario 2**: 提交前自检
  - **Input**: 执行 `npm run preflight`
  - **Output**: 先校验全部源码 SPDX 头，再跑完整测试；任一失败返回非 0
  - **Constraint**: Windows 与 WSL 均可执行

- **Scenario 3**: 启停本地服务
  - **Input**: 执行 `./scripts/service.sh start|stop|status|health|logs`
  - **Output**: 服务在后台运行、PID 可追踪、日志落 `logs/`、健康检查返回版本
  - **Constraint**: 重复 start 不产生第二个实例

- **Scenario 4**: 新功能立项
  - **Input**: 执行 `./scripts/sdd new <功能名>`
  - **Output**: 生成 `docs-framework/changes/<功能名>/spec.md`，且 `check` 能识别模板未填写
  - **Constraint**: 不改变现有 `doc/` 交付文档结构

## 3. Interface Contract (OpenAPI Changes)
本变更不新增或修改 HTTP 接口；`docs-framework/specs/api/api.yaml` 仅以 OpenAPI 3.1 描述现有 `/api/*` 接口，作为后续变更的合同基线。

## 4. Acceptance Criteria
- [ ] `VERSION`、`package.json`、`package-lock.json`、`fnos/siteguard/manifest`、界面页脚、文档版本一致。
- [ ] `LICENSE`（MIT）、`NOTICE`、`.env.example` 存在且内容可用。
- [ ] `.trae/rules/name_rules.md` 与 `.trae/rules/project_rules.md` 存在。
- [ ] `npm run license:check` 对 `src/`、`scripts/`、`public/`、`test/` 下全部 `.js`/`.mjs` 通过。
- [ ] `npm run preflight` 通过，测试仍为 124/124。
- [ ] `scripts/service.sh` 五个子命令可用，重复 start 被拦截。
- [ ] `docs-framework/` 含 README、SDD_WORKFLOW、templates、specs/api、specs/functional、changes。
- [ ] `./scripts/sdd list` 能列出本轮变更。
