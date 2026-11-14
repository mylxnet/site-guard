# 文档框架（SDD + API 合同）

本目录是开发过程文档区，**不是**面向使用者的交付文档；交付文档仍在根目录 `doc/`。

## 目录

| 路径 | 用途 |
| --- | --- |
| `SDD_WORKFLOW.md` | 规格驱动开发流程（No Spec, No Code） |
| `templates/` | spec / plan / PRD / ADR / 架构 / 测试策略模板 |
| `specs/api/api.yaml` | OpenAPI 3.1 合同，前后端唯一接口真理源 |
| `specs/functional/` | 已归档的功能规格 |
| `changes/<功能名>/` | 进行中的变更（spec.md + plan.md） |

## 常用命令

```bash
./scripts/sdd new <功能名>                 # 新建变更
./scripts/sdd check <功能名> plan          # 校验 spec，生成计划
./scripts/sdd check <功能名> implement     # 校验 spec + plan
./scripts/sdd list                        # 列出活跃变更
./scripts/sdd archive <功能名>             # 归档到 specs/functional
```

## 与交付文档的关系

变更归档后，必须同步更新根目录 `doc/` 下的 `DESIGN.md`、`PROJECT_STATE.md` 与 `CHANGELOG.md`。

> 说明：`SDD_WORKFLOW.md` 中提到的 Git pre-commit 钩子当前**未安装**（0.8.7 按约定不装钩子），阶段校验请手动执行 `./scripts/sdd check <功能名> implement`。
