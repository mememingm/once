import { ApiError } from "../lib/api";
import type { RequestOptions } from "../lib/models";
import type {
  AdminAudit, AdminLease, AdminMessage, AdminNumber, AdminOrder, AdminUser, AdminWebhook, Page,
} from "./types";

// Development-only fixtures that follow docs/ONCE-ADMIN-API.md. Nothing here reaches the real API.
const day = 86400000;
const now = Date.now();
const iso = (offsetDays: number) => new Date(now + offsetDays * day).toISOString();
const id = (prefix: string, index: number) =>
  `${prefix.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${String(index).padStart(12, "0")}`;
const places = [
  ["US", "美国", "加利福尼亚州", "415"], ["US", "美国", "纽约州", "212"],
  ["CA", "加拿大", "安大略省", "647"], ["US", "美国", "得克萨斯州", "512"],
  ["CA", "加拿大", "不列颠哥伦比亚省", "604"],
] as const;
const plans: Record<number, number> = { 7: 1200, 30: 3500 };
const senders = ["Google", "Telegram", "WhatsApp", "Apple", "Microsoft", "+14155550123", "Amazon"];
const admin = { id: id("a0000000", 1), email: "admin@once.local", role: "ADMIN" as const };

function build() {
  const users: AdminUser[] = [
    { ...admin, status: "ACTIVE", createdAt: iso(-60), lastLoginAt: iso(0), activeLeaseCount: 0, leaseCount: 0, orderCount: 0 },
    ...Array.from({ length: 36 }, (_, i): AdminUser => ({
      id: id("u0000000", i + 1), email: `user${String(i + 1).padStart(2, "0")}@example.com`, role: "USER",
      status: i % 13 === 7 ? "DISABLED" : "ACTIVE", createdAt: iso(-50 + i), lastLoginAt: i % 5 ? iso(-(i % 9)) : null,
      activeLeaseCount: 0, leaseCount: 0, orderCount: 0,
    })),
  ];
  const numbers: AdminNumber[] = Array.from({ length: 64 }, (_, i) => {
    const [countryCode, countryName, regionName, area] = places[i % places.length]!;
    const live = i % 4 === 0;
    return {
      id: id("n0000000", i + 1), number: `+1 ${area} 555 ${String(1000 + i).padStart(4, "0")}`, countryCode, countryName, regionName,
      provider: live ? "pingcode" : "demo", providerNumberId: live ? String(880000 + i) : null,
      providerStatus: live ? (i % 16 === 0 ? "OFFLINE" : "ACTIVE") : null, resourceExpiresAt: live ? iso(90 - i) : null,
      lastSyncedAt: live ? iso(-0.2) : null, smsEnabled: true, saleStatus: "AVAILABLE", holdReason: null, currentLease: null, createdAt: iso(-70),
    };
  });
  numbers[60]!.saleStatus = "HELD"; numbers[60]!.holdReason = "号码异常暂停";
  numbers[61]!.saleStatus = "HELD"; numbers[61]!.holdReason = "EXPIRY_RELEASE_RULES_UNCONFIRMED";
  const leases: AdminLease[] = [];
  const orders: AdminOrder[] = [];
  for (let i = 0; i < 44; i++) {
    const user = users[1 + (i % 34)]!, number = numbers[i]!;
    const term = i % 3 ? 30 : 7;
    const expiresIn = i < 30 ? 2 + (i % 26) : i < 36 ? (i % 3) + 0.5 : -(i % 9) - 1;
    const status: AdminLease["status"] = i >= 40 ? "ENDED" : expiresIn < 0 ? "EXPIRED_HELD" : "ACTIVE";
    const lease: AdminLease = {
      id: id("l0000000", i + 1), userId: user.id, email: user.email, phoneNumberId: number.id, number: number.number,
      countryName: number.countryName, regionName: number.regionName, provider: number.provider, term, priceMinor: plans[term]!, currency: "USD",
      status, startedAt: iso(expiresIn - term), expiresAt: iso(expiresIn), endedAt: status === "ENDED" ? iso(expiresIn) : null,
      messageCount: (i * 7) % 23, outboundCount: (i * 3) % 6,
    };
    leases.push(lease);
    if (status !== "ENDED") {
      number.saleStatus = status === "ACTIVE" ? "OCCUPIED" : "HELD";
      number.holdReason = status === "ACTIVE" ? null : "EXPIRY_RELEASE_RULES_UNCONFIRMED";
      number.currentLease = { id: lease.id, userId: user.id, email: user.email, expiresAt: lease.expiresAt };
    }
    const kinds: AdminOrder["kind"][] = i % 6 === 5 ? ["RENT", "RENEW"] : ["RENT"];
    kinds.forEach((kind, k) => orders.push({
      id: id("o0000000", orders.length + 1), userId: user.id, email: user.email, leaseId: lease.id, number: number.number, kind,
      termDays: term, amountMinor: plans[term]!, currency: "USD",
      status: i === 3 && k === 0 ? "UNCERTAIN" : i === 9 ? "FAILED" : "DEMO_CONFIRMED", attempts: 1,
      lastError: i === 9 ? "PROVIDER_REJECTED" : null, providerOrderId: null,
      createdAt: iso(expiresIn - term + k * 5 - (i < 5 ? 0 : 0)), completedAt: i === 9 ? null : iso(expiresIn - term + k * 5),
    }));
  }
  // A few orders created today so the dashboard has something to show.
  orders.slice(0, 4).forEach((order, i) => { order.createdAt = new Date(now - (i + 1) * 3600000).toISOString(); });
  const messages: AdminMessage[] = [];
  leases.slice(0, 30).forEach((lease, i) => {
    for (let m = 0; m < 3; m++) {
      const outbound = m === 2 && i % 2 === 0;
      messages.push({
        id: id("m0000000", messages.length + 1), direction: outbound ? "OUTBOUND" : "INBOUND", leaseId: lease.id, userId: lease.userId,
        email: lease.email, number: lease.number, peer: outbound ? "+1 202 555 0188" : senders[(i + m) % senders.length]!,
        body: outbound ? "好的，收到，谢谢。" : `您的验证码是 ${String(100000 + i * 37 + m * 911).slice(0, 6)}，5 分钟内有效。`,
        code: outbound ? null : String(100000 + i * 37 + m * 911).slice(0, 6),
        status: outbound ? (i % 8 === 0 ? "FAILED" : i % 8 === 2 ? "UNCERTAIN" : "DELIVERED") : null,
        readAt: !outbound && m === 0 ? iso(-0.1) : null, provider: lease.provider,
        providerMessageId: lease.provider === "pingcode" ? `pc-msg-${i}-${m}` : null,
        lastError: outbound && i % 8 === 0 ? "UNDELIVERABLE_DESTINATION" : null, at: iso(-(i % 10) - m / 10),
      });
    }
  });
  const webhooks: AdminWebhook[] = Array.from({ length: 18 }, (_, i) => {
    const status: AdminWebhook["status"] = i % 6 === 1 ? "FAILED" : i % 9 === 4 ? "QUARANTINED" : i === 0 ? "RECEIVED" : "PROCESSED";
    return {
      id: id("w0000000", i + 1), provider: "pingcode", eventId: `evt_${(9000 + i).toString(36)}`, status, attempts: status === "FAILED" ? 3 : 1,
      lastError: status === "FAILED" ? "INBOUND_PROCESSING_FAILED" : status === "QUARANTINED" ? "NO_LEASE_AT_RECEIVE_TIME" : null,
      conflictCount: i === 7 ? 1 : 0, leaseId: status === "PROCESSED" ? leases[i]!.id : null, outboundMessageId: null,
      providerNumberId: String(880000 + i * 4), providerMessageId: `pc-msg-${i}`, occurredAt: iso(-i / 3), receivedAt: iso(-i / 3),
      processedAt: status === "PROCESSED" ? iso(-i / 3) : null, nextAttemptAt: status === "FAILED" ? iso(0.01) : null,
      payload: { event: "sms.received", eventId: `evt_${(9000 + i).toString(36)}`, data: { numberId: 880000 + i * 4, from: "Google", content: "G-123456 是你的 Google 验证码。" } },
    };
  });
  const audit: AdminAudit[] = [
    { id: id("e0000000", 1), actorEmail: admin.email, action: "USER_STATUS", targetType: "user", targetId: users[8]!.id, reason: "违规使用", createdAt: iso(-2) },
    { id: id("e0000000", 2), actorEmail: admin.email, action: "NUMBER_HOLD", targetType: "number", targetId: numbers[60]!.id, reason: "号码异常暂停", createdAt: iso(-1.5) },
    { id: id("e0000000", 3), actorEmail: admin.email, action: "LEASE_EXTEND", targetType: "lease", targetId: leases[2]!.id, reason: "补偿服务中断", createdAt: iso(-1) },
  ];
  for (const user of users) {
    const own = leases.filter(l => l.userId === user.id);
    user.leaseCount = own.length;
    user.activeLeaseCount = own.filter(l => l.status === "ACTIVE").length;
    user.orderCount = orders.filter(o => o.userId === user.id).length;
  }
  return { users, numbers, leases, orders, messages, webhooks, audit };
}
const db = build();

function fail(message: string, status: number, code = ""): never {
  throw new ApiError(message, status, code);
}
function page<T>(rows: T[], params: URLSearchParams): Page<T> {
  const pageSize = [10, 20, 50].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, Number(params.get("page")) || 1), totalPages);
  return { items: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pageSize, totalItems: rows.length, totalPages };
}
const matches = (search: string, ...values: (string | null | undefined)[]) =>
  !search || values.some(value => value?.toLowerCase().includes(search.toLowerCase()));
const byNewest = <T,>(rows: T[], date: (row: T) => string) => [...rows].sort((a, b) => date(b).localeCompare(date(a)));
const expiring = (lease: AdminLease) => lease.status === "ACTIVE" && Date.parse(lease.expiresAt) - Date.now() < 3 * day;

function list(section: string, params: URLSearchParams) {
  const search = params.get("search")?.trim() ?? "", status = params.get("status") ?? "", userId = params.get("userId") ?? "";
  switch (section) {
    case "users":
      return page(db.users.filter(u => matches(search, u.email, u.id) && (!status || u.status === status || u.role === status)), params);
    case "numbers":
      return page(db.numbers.filter(n => matches(search, n.number, n.currentLease?.email, n.providerNumberId) &&
        (!status || n.saleStatus === status) && (!params.get("provider") || n.provider === params.get("provider"))), params);
    case "leases":
      return page(byNewest(db.leases.filter(l => matches(search, l.number, l.email, l.id) && (!userId || l.userId === userId) &&
        (!status || (status === "EXPIRING" ? expiring(l) : l.status === status))), l => l.startedAt), params);
    case "orders":
      return page(byNewest(db.orders.filter(o => matches(search, o.id, o.email, o.number) && (!userId || o.userId === userId) &&
        (!status || (status === "TODAY" ? Date.now() - Date.parse(o.createdAt) < day : status === "ATTENTION" ? ["UNCERTAIN", "FAILED", "PENDING", "PROCESSING"].includes(o.status) : o.status === status))), o => o.createdAt), params);
    case "messages":
      return page(byNewest(db.messages.filter(m => matches(search, m.number, m.peer, m.email, m.body) &&
        (!params.get("direction") || m.direction === params.get("direction")) && (!params.get("leaseId") || m.leaseId === params.get("leaseId")) &&
        (!status || m.status === status)), m => m.at), params);
    case "webhooks":
      return page(byNewest(db.webhooks.filter(w => matches(search, w.eventId, w.providerMessageId, w.providerNumberId) && (!status || w.status === status)), w => w.receivedAt), params);
    case "audit":
      return page(byNewest(db.audit.filter(a => matches(search, a.actorEmail, a.targetId, a.reason) && (!status || a.action === status)), a => a.createdAt), params);
  }
  return fail("Not found", 404);
}
function find<T extends { id: string }>(rows: T[], key: string) {
  return rows.find(row => row.id === key) ?? fail("记录不存在或已变化。", 404, "NOT_FOUND");
}
function reasonOf(body: Record<string, unknown>) {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 500) fail("操作原因需要 3–500 个字符。", 400, "VALIDATION_ERROR");
  return reason;
}
function record(action: string, targetType: string, targetId: string, reason: string) {
  db.audit.push({ id: crypto.randomUUID(), actorEmail: admin.email, action, targetType, targetId, reason, createdAt: new Date().toISOString() });
}
function refreshUser(userId: string) {
  const user = db.users.find(u => u.id === userId);
  if (!user) return;
  user.leaseCount = db.leases.filter(l => l.userId === userId).length;
  user.activeLeaseCount = db.leases.filter(l => l.userId === userId && l.status === "ACTIVE").length;
  user.orderCount = db.orders.filter(o => o.userId === userId).length;
}
const applied = new Map<string, unknown>();

function mutate(path: string, body: Record<string, unknown>) {
  const [, section, key, action] = path.split("/");
  const reason = reasonOf(body);
  if (section === "users" && action === "status") {
    const user = find(db.users, key!);
    if (user.role === "ADMIN") fail("Admin protected", 409, "ADMIN_PROTECTED");
    user.status = body.status === "DISABLED" ? "DISABLED" : "ACTIVE";
    record("USER_STATUS", "user", user.id, reason);
    return user;
  }
  if (section === "users" && action === "password") {
    const user = find(db.users, key!);
    if (user.role === "ADMIN") fail("Admin protected", 409, "ADMIN_PROTECTED");
    if (typeof body.newPassword !== "string" || body.newPassword.length < 12 || body.newPassword.length > 128) fail("密码需要 12–128 个字符。", 400, "VALIDATION_ERROR");
    record("USER_PASSWORD_RESET", "user", user.id, reason);
    return { ok: true };
  }
  if (section === "numbers" && action === "assign") {
    const number = find(db.numbers, key!);
    const user = db.users.find(u => u.id === body.userId && u.status === "ACTIVE" && u.role === "USER") ?? fail("User unavailable", 409, "USER_UNAVAILABLE");
    if (number.saleStatus !== "AVAILABLE") fail("Number unavailable", 409, "NUMBER_UNAVAILABLE");
    const term = body.term === 7 ? 7 : 30;
    const lease: AdminLease = {
      id: crypto.randomUUID(), userId: user.id, email: user.email, phoneNumberId: number.id, number: number.number, countryName: number.countryName,
      regionName: number.regionName, provider: number.provider, term, priceMinor: 0, currency: "USD", status: "ACTIVE",
      startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + term * day).toISOString(), endedAt: null, messageCount: 0, outboundCount: 0,
    };
    db.leases.push(lease);
    db.orders.push({ id: crypto.randomUUID(), userId: user.id, email: user.email, leaseId: lease.id, number: number.number, kind: "ADMIN_ASSIGN",
      termDays: term, amountMinor: 0, currency: "USD", status: "COMPLETED", attempts: 1, lastError: null, providerOrderId: null,
      createdAt: lease.startedAt, completedAt: lease.startedAt });
    Object.assign(number, { saleStatus: "OCCUPIED", holdReason: null, currentLease: { id: lease.id, userId: user.id, email: user.email, expiresAt: lease.expiresAt } });
    refreshUser(user.id);
    record("NUMBER_ASSIGN", "number", number.id, reason);
    return lease;
  }
  if (section === "numbers" && action === "hold") {
    const number = find(db.numbers, key!);
    if (number.saleStatus === "OCCUPIED") fail("Number unavailable", 409, "NUMBER_UNAVAILABLE");
    Object.assign(number, body.hold ? { saleStatus: "HELD", holdReason: reason } : { saleStatus: "AVAILABLE", holdReason: null, currentLease: null });
    record("NUMBER_HOLD", "number", number.id, reason);
    return number;
  }
  if (section === "leases" && (action === "end" || action === "extend")) {
    const lease = find(db.leases, key!);
    if (lease.status === "ENDED" || (action === "extend" && lease.status !== "ACTIVE")) fail("Lease not active", 409, "LEASE_NOT_ACTIVE");
    const number = db.numbers.find(n => n.id === lease.phoneNumberId);
    if (action === "end") {
      Object.assign(lease, { status: "ENDED", endedAt: new Date().toISOString() });
      // Reclaimed numbers stay held until an operator explicitly releases them.
      if (number) Object.assign(number, { saleStatus: "HELD", holdReason: "管理员回收，待人工复核", currentLease: null });
      record("LEASE_END", "lease", lease.id, reason);
    } else {
      const days = body.days === 7 ? 7 : 30;
      lease.expiresAt = new Date(Date.parse(lease.expiresAt) + days * day).toISOString();
      if (number?.currentLease) number.currentLease.expiresAt = lease.expiresAt;
      db.orders.push({ id: crypto.randomUUID(), userId: lease.userId, email: lease.email, leaseId: lease.id, number: lease.number, kind: "ADMIN_EXTEND",
        termDays: days, amountMinor: 0, currency: "USD", status: "COMPLETED", attempts: 1, lastError: null, providerOrderId: null,
        createdAt: new Date().toISOString(), completedAt: new Date().toISOString() });
      record("LEASE_EXTEND", "lease", lease.id, reason);
    }
    refreshUser(lease.userId);
    return lease;
  }
  if (section === "webhooks" && action === "retry") {
    const event = find(db.webhooks, key!);
    if (event.status === "PROCESSED") fail("Not retryable", 409, "WEBHOOK_NOT_RETRYABLE");
    Object.assign(event, { attempts: event.attempts + 1, status: event.status === "QUARANTINED" ? "QUARANTINED" : "PROCESSED",
      processedAt: event.status === "QUARANTINED" ? null : new Date().toISOString(), lastError: event.status === "QUARANTINED" ? event.lastError : null, nextAttemptAt: null });
    record("WEBHOOK_RETRY", "webhook", event.id, reason);
    return event;
  }
  return fail("Not found", 404);
}

export async function mockAdminRequest(path: string, options: RequestOptions = {}) {
  await new Promise(resolve => setTimeout(resolve, 180 + Math.random() * 220));
  options.signal?.throwIfAborted();
  const [route, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  if (options.method === "POST") {
    const key = options.headers?.["Idempotency-Key"] ?? "";
    if (applied.has(key)) return structuredClone(applied.get(key));
    const result = mutate(route!, (options.body ?? {}) as Record<string, unknown>);
    applied.set(key, result);
    return structuredClone(result);
  }
  if (route === "/session") return { ...admin };
  if (route === "/summary") {
    const today = db.orders.filter(o => Date.now() - Date.parse(o.createdAt) < day);
    return structuredClone({
      users: db.users.length, activeLeases: db.leases.filter(l => l.status === "ACTIVE").length,
      availableNumbers: db.numbers.filter(n => n.saleStatus === "AVAILABLE").length, heldNumbers: db.numbers.filter(n => n.saleStatus === "HELD").length,
      todayOrders: today.length, todayRevenueMinor: today.reduce((sum, o) => sum + o.amountMinor, 0), currency: "USD",
      expiringLeases: db.leases.filter(expiring).length, failedOutbound: db.messages.filter(m => m.status === "FAILED" || m.status === "UNCERTAIN").length,
      failedWebhooks: db.webhooks.filter(w => w.status === "FAILED" || w.status === "QUARANTINED").length,
      uncertainOrders: db.orders.filter(o => ["UNCERTAIN", "FAILED", "PENDING", "PROCESSING"].includes(o.status)).length,
      recentOrders: byNewest(db.orders, o => o.createdAt).slice(0, 6),
      expiring: db.leases.filter(expiring).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).slice(0, 6),
      integrations: { demoMode: true, pingcodeConfigured: false, receiveWebhookConfigured: false, paymentsConnected: false },
    });
  }
  const [, section, key] = route!.split("/");
  if (!key) return structuredClone(list(section!, params));
  if (section === "users") {
    const user = find(db.users, key);
    return structuredClone({ user, leases: byNewest(db.leases.filter(l => l.userId === key), l => l.startedAt), orders: byNewest(db.orders.filter(o => o.userId === key), o => o.createdAt).slice(0, 50) });
  }
  if (section === "numbers")
    return structuredClone({ number: find(db.numbers, key), leases: byNewest(db.leases.filter(l => l.phoneNumberId === key), l => l.startedAt) });
  if (section === "leases")
    return structuredClone({ lease: find(db.leases, key), orders: db.orders.filter(o => o.leaseId === key), messages: byNewest(db.messages.filter(m => m.leaseId === key), m => m.at).slice(0, 20) });
  if (section === "orders") return structuredClone(find(db.orders, key));
  return fail("Not found", 404);
}
