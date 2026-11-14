# Feature Specification: [Feature Name]

## 1. Overview
**Summary**: [简要描述此功能做什么]
**Rationale**: [为什么要构建这个功能？例如用户请求、技术债务、性能问题等]

## 2. User Scenarios (User Stories)
> 描述用户如何与功能交互。

- **Scenario 1**: [描述]
  - **Input**: [用户提供什么]
  - **Output**: [系统返回什么]
  - **Constraint**: [任何限制条件]

- **Scenario 2**: [描述]
  ...

## 3. Interface Contract (OpenAPI Changes)
> 定义所需的 API 变更。这是"技术规格"。

### Endpoints
- `METHOD /api/v1/resource`
  - **Request Body**: [链接到 schema 或描述]
  - **Response**: [链接到 schema 或描述]

### Schemas
```yaml
# 可选：新 schema 的内联 YAML 片段
NewResource:
  type: object
  properties:
    id:
      type: string
```

## 4. Acceptance Criteria
- [ ] UI 正确显示 X。
- [ ] API 对有效输入返回 200 OK。
- [ ] API 对无效输入返回 400 Bad Request。
- [ ] 性能：响应时间 < 200ms。
