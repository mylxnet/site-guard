# SDD (Spec-Driven Development) Workflow & Rules

本项目强制执行 Spec-Driven Development 工作流。没有规格文档，不写代码。

## 1. 黄金原则
> **"No Spec, No Code."**
> 你不能提交 `.ts`、`.py`、`.tsx` 等功能代码，除非在 `docs-framework/changes/` 中有活跃的功能规格文档。

## 2. 工作流阶段

### Phase 1: Propose（提案）
- **命令**：`./scripts/sdd new <feature-name>`
- **动作**：从模板创建 `docs-framework/changes/<feature-name>/spec.md`
- **门禁**：必须填写 `spec.md`，默认模板内容无效。

### Phase 2: Plan（计划）
- **命令**：`./scripts/sdd check <feature-name> plan`
- **动作**：验证 `spec.md` 是否完整。
- **产出**：你（或 AI）生成 `docs-framework/changes/<feature-name>/plan.md`。

### Phase 3: Implement（实现）
- **命令**：`./scripts/sdd check <feature-name> implement`
- **动作**：验证 `plan.md` 是否存在且完整。
- **产出**：你编写代码。
- **强制**：Git pre-commit 钩子会验证你是否处于此阶段。

### Phase 4: Archive（归档）
- **命令**：`./scripts/sdd archive <feature-name>`
- **动作**：
  1. 运行测试（可选但推荐）。
  2. 将 `spec.md` 内容合并到主 `docs-framework/specs/`（真理源）。
  3. 删除 `docs-framework/changes/<feature-name>` 目录。

## 3. 目录结构
- `docs-framework/specs/`：永久真理源。
- `docs-framework/changes/`：进行中的功能临时工作区。
- `docs-framework/templates/`：spec 和 plan 模板。

## 4. API 合同同步
- 任何变更 API 接口的功能，必须先更新 `docs-framework/specs/api/api.yaml`
- OpenAPI 合同是前后端唯一的接口契约
