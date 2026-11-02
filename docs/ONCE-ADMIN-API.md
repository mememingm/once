# ONCE 管理后台 API 契约

前端已在 `src/admin/` 完成，类型定义见 [src/admin/types.ts](../src/admin/types.ts)，演示实现见 [src/admin/mock.ts](../src/admin/mock.ts)（行为以它为参考）。后端按本文实现后，前端无需修改即可接入。

本地无后端时：`npm run dev:admin-mock`，打开 `http://127.0.0.1:5174/#/admin`。

## 通用约定

- 前缀 `/api/admin`，全部接口走 `SessionGuard` + 新增的 `AdminGuard`：每次请求从数据库读取当前用户角色，不信任缓存或前端。
  - 未登录 → `401`；已登录但非管理员 → `403`，body `{ "message": "...", "code": "ADMIN_REQUIRED" }`。
- 错误 body 统一为 `{ message, code? }`。前端按 `code` 显示中文提示（见下文各接口），没有 `code` 时显示 `message`。
- 写接口：
  - `POST` + `Content-Type: application/json`，沿用现有 Origin 校验。
  - 必须带 `Idempotency-Key`（UUID）。同一 key 重放返回首次结果；同 key 不同内容 → `409 IDEMPOTENCY_CONFLICT`。
  - body 必须含 `reason`（去首尾空格后 3–500 字符），否则 `400 VALIDATION_ERROR`。
  - 业务修改和 `AuditLog` 写入在**同一事务**内完成。
- 列表接口参数：`page`（从 1 开始）、`pageSize`（10/20/50，默认 20）、`search`、`status`，以及各接口的额外筛选。返回：
  ```json
  { "items": [], "page": 1, "pageSize": 20, "totalItems": 0, "totalPages": 1 }
  ```
  管理列表用页码分页（offset），与 C 端的游标分页不同。
- 时间一律 ISO 8601 UTC 字符串；金额为最小单位整数（`amountMinor`、`priceMinor`），并附 `currency`。

## 需要的数据库变更

| 变更 | 用途 |
|---|---|
| `User.role`：`USER` / `ADMIN`，默认 `USER` | 区分管理员 |
| `User.status`：`ACTIVE` / `DISABLED`，默认 `ACTIVE` | 禁用账号；禁用时撤销该用户的全部 `Session`，登录时拒绝 |
| `User.lastLoginAt`（可空） | 用户列表展示 |
| `AuditLog` 增加 `targetType`、`reason` | 记录操作对象类型和原因。现有 `resourceId` 作为 `targetId` 使用；`userId` 记录执行操作的管理员 |
| `Order.kind` 增加 `ADMIN_ASSIGN`、`ADMIN_EXTEND` | 管理员免费开通和延期，`amountMinor = 0` |
| `Lease.status` 增加 `ENDED`，使用已有的 `endedAt` | 管理员回收 |

另需提供一个运营 CLI，把已有账号设为管理员，例如 `npm run pc:operator -- grant-admin --email=...`。不要开放任何能把用户提升为管理员的 HTTP 接口。

`GET /api/auth/me` 需要返回 `role`。前端据此在用户工作台的账户菜单中显示「管理后台」入口。

## 只读接口

| 方法与路径 | 返回 | 说明 |
|---|---|---|
| `GET /session` | `AdminSession { id, email, role }` | 进入后台时的权限检查；窗口重新获得焦点时会再次调用 |
| `GET /summary` | `AdminSummary` | 概览页的数字、最近 6 笔订单、3 天内到期的 6 条租约、`integrations` 接入状态 |
| `GET /users` | `Page<AdminUser>` | `search` 匹配邮箱或 ID；`status` 取 `ACTIVE`、`DISABLED` 或 `ADMIN`（按角色筛选） |
| `GET /users/:id` | `{ user, leases, orders }` | 订单最多 50 条 |
| `GET /numbers` | `Page<AdminNumber>` | `status` 取 `AVAILABLE`、`OCCUPIED`、`HELD`；`provider` 取 `demo` 或 `pingcode`；`search` 匹配号码、当前用户邮箱、`providerNumberId` |
| `GET /numbers/:id` | `{ number, leases }` | `leases` 为该号码的全部租用历史 |
| `GET /leases` | `Page<AdminLease>` | `status` 取 `ACTIVE`、`EXPIRING`（ACTIVE 且 3 天内到期）、`EXPIRED_HELD`、`ENDED`；支持 `userId`；`search` 匹配号码、邮箱、租约 ID |
| `GET /leases/:id` | `{ lease, orders, messages }` | `messages` 为收发合并后最近 20 条 |
| `GET /orders` | `Page<AdminOrder>` | `status` 取具体状态，或 `TODAY`（24 小时内）、`ATTENTION`（`PENDING`/`PROCESSING`/`UNCERTAIN`/`FAILED`）；支持 `userId` |
| `GET /orders/:id` | `AdminOrder` | |
| `GET /messages` | `Page<AdminMessage>` | 入站 `Message` 与出站 `OutboundMessage` 合并，按时间倒序。`direction` 取 `INBOUND` 或 `OUTBOUND`；支持 `leaseId`；`status` 仅作用于出站记录 |
| `GET /webhooks` | `Page<AdminWebhook>` | `status` 取 `RECEIVED`、`PROCESSED`、`FAILED`、`QUARANTINED`；`payload` 原样返回 |
| `GET /audit` | `Page<AdminAudit>` | `status` 在这里表示 `action`，按操作类型筛选 |

派生字段的计算方式：
- `AdminNumber.saleStatus`：`occupied` 为真 → `OCCUPIED`；否则 `holdReason` 不为空 → `HELD`；其余为 `AVAILABLE`。
- `AdminNumber.currentLease`：当前有效租约，没有则为 `null`。
- `AdminLease.status`：与 `leaseView` 一致，`ACTIVE` 但已过期的显示为 `EXPIRED_HELD`。
- 用户的 `activeLeaseCount`、`leaseCount`、`orderCount` 以及租约的 `messageCount`、`outboundCount` 都是计数。

## 写接口

所有写接口都带 `reason` 和 `Idempotency-Key`，`action` 列为写入审计日志的操作类型。

| 方法与路径 | body | 效果 | `action` | 错误码 |
|---|---|---|---|---|
| `POST /users/:id/status` | `{ status: "ACTIVE" \| "DISABLED", reason }` | 修改用户状态；禁用时撤销该用户全部会话 | `USER_STATUS` | `ADMIN_PROTECTED`（目标是管理员） |
| `POST /users/:id/password` | `{ newPassword, reason }` | 按现有哈希方式重置密码（12–128 字符），撤销全部会话。审计日志中不得出现密码或其哈希 | `USER_PASSWORD_RESET` | `ADMIN_PROTECTED` |
| `POST /numbers/:id/assign` | `{ userId, term: 7 \| 30, reason }` | 锁住用户和号码行后：创建 ACTIVE 租约（`priceMinor = 0`），号码设为 `occupied`，并生成一笔 `ADMIN_ASSIGN` 订单（状态 `COMPLETED`，金额 0）。返回 `AdminLease` | `NUMBER_ASSIGN` | `NUMBER_UNAVAILABLE`、`USER_UNAVAILABLE`（用户不存在、已禁用或是管理员） |
| `POST /numbers/:id/hold` | `{ hold: boolean, reason }` | `hold` 为真时写入 `holdReason = reason`，号码不再出现在库存中；为假时清空 `holdReason`。号码正在被占用时拒绝 | `NUMBER_HOLD` | `NUMBER_UNAVAILABLE` |
| `POST /leases/:id/end` | `{ reason }` | 租约设为 `ENDED`、`endedAt = now`；号码 `occupied = false`，`holdReason` 设为「管理员回收，待人工复核」，**不自动重新上架**；历史短信和订单保留 | `LEASE_END` | `LEASE_NOT_ACTIVE` |
| `POST /leases/:id/extend` | `{ days: 7 \| 30, reason }` | 仅限 ACTIVE 租约：`expiresAt += days`，并生成一笔 `ADMIN_EXTEND` 订单（金额 0）。必须遵守租期不重叠的 SQL 约束 | `LEASE_EXTEND` | `LEASE_NOT_ACTIVE` |
| `POST /webhooks/:id/retry` | `{ reason }` | 对状态为 `FAILED`、`QUARANTINED`、`RECEIVED` 的事件调用 `IncomingService.process`（或对应的出站处理）重新匹配，返回更新后的 `AdminWebhook`。不向 PingCode 发起新请求 | `WEBHOOK_RETRY` | `WEBHOOK_NOT_RETRYABLE`（已处理的事件） |

所有写操作对应记录不存在时返回 `404 NOT_FOUND`。

## 不在本期范围

真实支付和退款、号码采购和同步（继续使用 operator CLI）、管理员账号的创建和降级、短信内容导出。
