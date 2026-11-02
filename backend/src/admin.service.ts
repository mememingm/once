import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { EventsService } from './events.service';
import { IncomingService } from './incoming.service';
import { OutboundService } from './outbound.service';
import { passwordHash } from './auth';
import { day, fingerprint, lockPhone, lockUser, transactionOptions } from './business';
import { pcConfigured } from './pingcode.client';
import { settings } from './config';

type QueryInput = Record<string, unknown>;
type WriteInput = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

type UserWithCounts = Prisma.UserGetPayload<{ include: { _count: { select: { leases: true; orders: true } }; leases: { select: { status: true; expiresAt: true } } } }>;
type LeaseWithRelations = Prisma.LeaseGetPayload<{ include: { user: true; phoneNumber: true; _count: { select: { messages: true; outbound: true } } } }>;
type NumberWithLeases = Prisma.PhoneNumberGetPayload<{ include: { leases: { include: { user: true } } } }>;
type OrderWithRelations = Prisma.OrderGetPayload<{ include: { user: true; lease: { include: { phoneNumber: true } }; phoneNumber: true } }>;
type MessageWithRelations = Prisma.MessageGetPayload<{ include: { lease: { include: { user: true; phoneNumber: true } } } }>;
type OutboundWithRelations = Prisma.OutboundMessageGetPayload<{ include: { lease: { include: { user: true; phoneNumber: true } } } }>;

type Mutation<T> = { value: T; targetType: string; targetId: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
const errorWithCode = (message: string, code: string, status = 409) => new (status === 400 ? BadRequestException : ConflictException)({ message, code });
const notFound = (message = '记录不存在或已变化。') => new NotFoundException({ message, code: 'NOT_FOUND' });

function validateReason(body: WriteInput) {
  const reason = text(body.reason);
  if (reason.length < 3 || reason.length > 500) throw errorWithCode('操作原因需要 3–500 个字符。', 'VALIDATION_ERROR', 400);
  return reason;
}
function validateKey(key: unknown) {
  if (typeof key !== 'string' || !uuid.test(key)) throw errorWithCode('Idempotency-Key 必须是 UUID。', 'VALIDATION_ERROR', 400);
  return key;
}
function page<T>(rows: T[], query: QueryInput) {
  const requested = Number(query.page);
  const requestedSize = Number(query.pageSize);
  const pageSize = [10, 20, 50].includes(requestedSize) ? requestedSize : 20;
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(1, Number.isInteger(requested) && requested > 0 ? requested : 1), totalPages);
  return { items: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pageSize, totalItems, totalPages };
}
function includeSearch(query: QueryInput) {
  const search = text(query.search);
  return search.length > 200 ? search.slice(0, 200) : search;
}
function adminLeaseStatus(row: { status: string; expiresAt: Date }) {
  if (row.status === 'ENDED') return 'ENDED' as const;
  if (row.status === 'EXPIRED_HELD' || (row.status === 'ACTIVE' && row.expiresAt.getTime() <= Date.now())) return 'EXPIRED_HELD' as const;
  return 'ACTIVE' as const;
}

@Injectable()
export class AdminService {
  constructor(private readonly db: DbService, private readonly incoming: IncomingService,
    private readonly outbound: OutboundService, private readonly events: EventsService) {}

  private async mutate<T>(actorId: string, keyInput: unknown, body: WriteInput,
    operation: (tx: Tx, reason: string, key: string) => Promise<Mutation<T>>) {
    const key = validateKey(keyInput);
    const reason = validateReason(body);
    const requestHash = fingerprint(body);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin:idempotency:' + key},0))`;
      const previous = await tx.adminIdempotency.findUnique({ where: { key } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw errorWithCode('该操作已用不同内容提交过，请关闭弹窗重新操作。', 'IDEMPOTENCY_CONFLICT');
        if (previous.result === null) throw errorWithCode('该操作正在处理中，请稍后刷新核对结果。', 'IDEMPOTENCY_IN_PROGRESS');
        return previous.result as T;
      }
      const mutation = await operation(tx, reason, key);
      await tx.adminIdempotency.create({ data: {
        id: randomUUID(), key, actorId, requestHash, result: mutation.value as unknown as Prisma.InputJsonValue,
      } });
      await tx.auditLog.create({ data: {
        userId: actorId, action: mutation.targetType === 'user' ? 'USER_STATUS' : '', resourceId: mutation.targetId,
        targetType: mutation.targetType, reason,
      } });
      return mutation.value;
    }, transactionOptions);
  }

  private async recordMutation<T>(actorId: string, keyInput: unknown, body: WriteInput, action: string,
    operation: (tx: Tx, reason: string, key: string) => Promise<{ value: T; targetId: string }>) {
    const key = validateKey(keyInput);
    const reason = validateReason(body);
    const requestHash = fingerprint(body);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin:idempotency:' + key},0))`;
      const previous = await tx.adminIdempotency.findUnique({ where: { key } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw errorWithCode('该操作已用不同内容提交过，请关闭弹窗重新操作。', 'IDEMPOTENCY_CONFLICT');
        if (previous.result === null) throw errorWithCode('该操作正在处理中，请稍后刷新核对结果。', 'IDEMPOTENCY_IN_PROGRESS');
        return previous.result as T;
      }
      const mutation = await operation(tx, reason, key);
      await tx.adminIdempotency.create({ data: { id: randomUUID(), key, actorId, requestHash, result: mutation.value as unknown as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { userId: actorId, action, resourceId: mutation.targetId, targetType: actionTarget(action), reason } });
      return mutation.value;
    }, transactionOptions);
  }

  private async userView(tx: Tx, id: string) {
    const user = await tx.user.findUnique({ where: { id }, include: { _count: { select: { leases: true, orders: true } }, leases: { select: { status: true, expiresAt: true } } } });
    if (!user) throw notFound();
    return this.mapUser(user);
  }
  private mapUser(user: UserWithCounts) {
    return { id: user.id, email: user.email, role: user.role === 'ADMIN' ? 'ADMIN' as const : 'USER' as const,
      status: user.status === 'DISABLED' ? 'DISABLED' as const : 'ACTIVE' as const, createdAt: user.createdAt.toISOString(),
      lastLoginAt: iso(user.lastLoginAt), activeLeaseCount: user.leases.filter(l => l.status === 'ACTIVE' && l.expiresAt.getTime() > Date.now()).length,
      leaseCount: user._count.leases, orderCount: user._count.orders };
  }
  private mapLease(row: LeaseWithRelations | (Prisma.LeaseGetPayload<{ include: { user: true; phoneNumber: true } }>)) {
    const counts = '_count' in row && row._count ? row._count : { messages: 0, outbound: 0 };
    return { id: row.id, userId: row.userId, email: row.user.email, phoneNumberId: row.phoneNumberId, number: row.phoneNumber.number,
      countryName: row.phoneNumber.countryName, regionName: row.phoneNumber.regionName, provider: row.phoneNumber.provider,
      term: row.termDays, priceMinor: row.priceMinor, currency: row.currency, status: adminLeaseStatus(row), startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(), endedAt: iso(row.endedAt), messageCount: counts.messages, outboundCount: counts.outbound };
  }
  private mapNumber(row: NumberWithLeases) {
    const current = row.leases.find(lease => lease.status === 'ACTIVE' && lease.expiresAt.getTime() > Date.now());
    return { id: row.id, number: row.number, countryCode: row.countryCode, countryName: row.countryName, regionName: row.regionName,
      provider: row.provider, providerNumberId: row.providerNumberId, providerStatus: row.providerStatus, resourceExpiresAt: iso(row.resourceExpiresAt),
      lastSyncedAt: iso(row.lastSyncedAt), smsEnabled: row.smsEnabled,
      saleStatus: row.occupied ? 'OCCUPIED' as const : row.holdReason ? 'HELD' as const : 'AVAILABLE' as const,
      holdReason: row.holdReason, currentLease: current ? { id: current.id, userId: current.userId, email: current.user.email, expiresAt: current.expiresAt.toISOString() } : null,
      createdAt: row.createdAt.toISOString() };
  }
  private mapOrder(row: OrderWithRelations) {
    return { id: row.id, userId: row.userId, email: row.user.email, leaseId: row.leaseId, number: row.numberSnapshot || row.phoneNumber?.number || row.lease?.phoneNumber.number || null,
      kind: row.kind, termDays: row.termDays, amountMinor: row.amountMinor, currency: row.currency, status: row.status, attempts: row.attempts,
      lastError: row.lastError, providerOrderId: row.providerOrderId, createdAt: row.createdAt.toISOString(), completedAt: iso(row.completedAt) };
  }
  private mapInbound(row: MessageWithRelations) {
    return { id: row.id, direction: 'INBOUND' as const, leaseId: row.leaseId, userId: row.lease.userId, email: row.lease.user.email,
      number: row.lease.phoneNumber.number, peer: row.sender, body: row.body, code: row.code, status: null, readAt: iso(row.readAt),
      provider: row.provider, providerMessageId: row.providerMessageId, lastError: null, at: row.receivedAt.toISOString() };
  }
  private mapOutbound(row: OutboundWithRelations) {
    return { id: row.id, direction: 'OUTBOUND' as const, leaseId: row.leaseId, userId: row.lease.userId, email: row.lease.user.email,
      number: row.lease.phoneNumber.number, peer: row.to, body: row.content, code: null, status: row.status, readAt: null,
      provider: row.provider, providerMessageId: row.providerMessageId, lastError: row.lastError, at: row.createdAt.toISOString() };
  }
  private mapWebhook(row: Prisma.WebhookEventGetPayload<{}>) {
    return { id: row.id, provider: row.provider, eventId: row.eventId, status: row.status, attempts: row.attempts, lastError: row.lastError,
      conflictCount: row.conflictCount, leaseId: row.leaseId, outboundMessageId: row.outboundMessageId, providerNumberId: row.providerNumberId,
      providerMessageId: row.providerMessageId, occurredAt: iso(row.occurredAt), receivedAt: row.receivedAt.toISOString(),
      processedAt: iso(row.processedAt), nextAttemptAt: iso(row.nextAttemptAt), payload: row.payload };
  }

  async list(section: string, query: QueryInput) {
    const search = includeSearch(query), status = text(query.status), userId = text(query.userId);
    if (section === 'users') {
      const where: Prisma.UserWhereInput = search ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, ...(uuid.test(search) ? [{ id: { equals: search } }] : [])] } : {};
      if (status === 'ADMIN') where.role = 'ADMIN'; else if (status === 'ACTIVE' || status === 'DISABLED') where.status = status;
      const rows = await this.db.user.findMany({ where, include: { _count: { select: { leases: true, orders: true } }, leases: { select: { status: true, expiresAt: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      return page(rows.map(row => this.mapUser(row)), query);
    }
    if (section === 'numbers') {
      const where: Prisma.PhoneNumberWhereInput = search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }, { providerNumberId: { contains: search, mode: 'insensitive' } }, { leases: { some: { user: { email: { contains: search, mode: 'insensitive' } } } } }] } : {};
      if (text(query.provider)) where.provider = text(query.provider);
      const rows = await this.db.phoneNumber.findMany({ where, include: { leases: { include: { user: true }, orderBy: { startedAt: 'desc' } } }, orderBy: [{ number: 'asc' }, { id: 'asc' }] });
      return page(rows.map(row => this.mapNumber(row)).filter(row => !status || row.saleStatus === status), query);
    }
    if (section === 'leases') {
      const where: Prisma.LeaseWhereInput = { ...(userId ? { userId } : {}), ...(search ? { OR: [...(uuid.test(search) ? [{ id: { equals: search } }] : []), { phoneNumber: { number: { contains: search, mode: 'insensitive' } } }, { user: { email: { contains: search, mode: 'insensitive' } } }] } : {}) };
      const rows = await this.db.lease.findMany({ where, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } }, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }] });
      const mapped = rows.map(row => this.mapLease(row)).filter(row => !status || (status === 'EXPIRING' ? row.status === 'ACTIVE' && Date.parse(row.expiresAt) > Date.now() && Date.parse(row.expiresAt) - Date.now() <= 3 * day : row.status === status));
      return page(mapped, query);
    }
    if (section === 'orders') {
      const where: Prisma.OrderWhereInput = { ...(userId ? { userId } : {}), ...(search ? { OR: [...(uuid.test(search) ? [{ id: { equals: search } }] : []), { numberSnapshot: { contains: search, mode: 'insensitive' } }, { user: { email: { contains: search, mode: 'insensitive' } } }] } : {}) };
      const rows = await this.db.order.findMany({ where, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      const mapped = rows.map(row => this.mapOrder(row)).filter(row => !status || (status === 'TODAY' ? Date.now() - Date.parse(row.createdAt) < day : status === 'ATTENTION' ? ['PENDING', 'PROCESSING', 'UNCERTAIN', 'FAILED'].includes(row.status) : row.status === status));
      return page(mapped, query);
    }
    if (section === 'messages') {
      const inboundWhere: Prisma.MessageWhereInput = { ...(text(query.leaseId) ? { leaseId: text(query.leaseId) } : {}), ...(search ? { OR: [{ sender: { contains: search, mode: 'insensitive' } }, { body: { contains: search, mode: 'insensitive' } }, { lease: { user: { email: { contains: search, mode: 'insensitive' } } } }] } : {}) };
      const outboundWhere: Prisma.OutboundMessageWhereInput = { ...(text(query.leaseId) ? { leaseId: text(query.leaseId) } : {}), ...(search ? { OR: [{ to: { contains: search, mode: 'insensitive' } }, { content: { contains: search, mode: 'insensitive' } }, { lease: { user: { email: { contains: search, mode: 'insensitive' } } } }] } : {}) };
      const [inbound, outbound] = await Promise.all([
        this.db.message.findMany({ where: inboundWhere, include: { lease: { include: { user: true, phoneNumber: true } } } }),
        this.db.outboundMessage.findMany({ where: outboundWhere, include: { lease: { include: { user: true, phoneNumber: true } } } }),
      ]);
      const mapped = [...inbound.map(row => this.mapInbound(row)), ...outbound.map(row => this.mapOutbound(row))].filter(row => (!text(query.direction) || row.direction === query.direction) && (!status || row.direction === 'OUTBOUND' && row.status === status)).sort((a, b) => b.at.localeCompare(a.at));
      return page(mapped, query);
    }
    if (section === 'webhooks') {
      const where: Prisma.WebhookEventWhereInput = search ? { OR: [{ eventId: { contains: search, mode: 'insensitive' } }, { providerNumberId: { contains: search, mode: 'insensitive' } }, { providerMessageId: { contains: search, mode: 'insensitive' } }] } : {};
      const rows = await this.db.webhookEvent.findMany({ where, orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }] });
      return page(rows.map(row => this.mapWebhook(row)).filter(row => !status || row.status === status), query);
    }
    if (section === 'audit') {
      const where: Prisma.AuditLogWhereInput = search ? { OR: [{ resourceId: { contains: search, mode: 'insensitive' } }, { reason: { contains: search, mode: 'insensitive' } }, { user: { email: { contains: search, mode: 'insensitive' } } }] } : {};
      where.action = { in: ['USER_STATUS', 'USER_PASSWORD_RESET', 'NUMBER_ASSIGN', 'NUMBER_HOLD', 'LEASE_END', 'LEASE_EXTEND', 'WEBHOOK_RETRY', 'ADMIN_BOOTSTRAP'], ...(status ? { equals: status } : {}) };
      const rows = await this.db.auditLog.findMany({ where, include: { user: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      return page(rows.map(row => ({ id: row.id, actorEmail: row.user.email, action: row.action, targetType: row.targetType || actionTarget(row.action), targetId: row.resourceId, reason: row.reason || '', createdAt: row.createdAt.toISOString() })), query);
    }
    throw notFound('管理列表不存在。');
  }

  async summary() {
    const now = new Date(), today = new Date(now.getTime() - day), soon = new Date(now.getTime() + 3 * day);
    const [users, activeLeases, availableNumbers, heldNumbers, todayOrders, failedOutbound, failedWebhooks, uncertainOrders, recent, expiring] = await Promise.all([
      this.db.user.count(), this.db.lease.count({ where: { status: 'ACTIVE', expiresAt: { gt: now } } }),
      this.db.phoneNumber.count({ where: { occupied: false, holdReason: null } }), this.db.phoneNumber.count({ where: { occupied: false, holdReason: { not: null } } }),
      this.db.order.findMany({ where: { createdAt: { gte: today } }, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: { createdAt: 'desc' } }),
      this.db.outboundMessage.count({ where: { status: { in: ['FAILED', 'UNCERTAIN'] } } }), this.db.webhookEvent.count({ where: { status: { in: ['FAILED', 'QUARANTINED'] } } }),
      this.db.order.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'UNCERTAIN', 'FAILED'] } } }),
      this.db.order.findMany({ include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 6 }),
      this.db.lease.findMany({ where: { status: 'ACTIVE', expiresAt: { gt: now, lte: soon } }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } }, orderBy: { expiresAt: 'asc' }, take: 6 }),
    ]);
    const revenue = todayOrders.filter(row => ['COMPLETED', 'DEMO_CONFIRMED'].includes(row.status)).reduce((sum, row) => sum + row.amountMinor, 0);
    return { users, activeLeases, availableNumbers, heldNumbers, todayOrders: todayOrders.length, todayRevenueMinor: revenue, currency: 'USD',
      expiringLeases: await this.db.lease.count({ where: { status: 'ACTIVE', expiresAt: { gt: now, lte: soon } } }), failedOutbound, failedWebhooks, uncertainOrders,
      recentOrders: recent.map(row => this.mapOrder(row)), expiring: expiring.map(row => this.mapLease(row)),
      integrations: { demoMode: settings.demo, pingcodeConfigured: pcConfigured(), receiveWebhookConfigured: Boolean(settings.pingcode.accountId && settings.pingcode.receiveWebhookSecret), paymentsConnected: false } };
  }

  async detail(section: 'users' | 'numbers' | 'leases' | 'orders', id: string) {
    if (section === 'users') {
      const user = await this.db.user.findUnique({ where: { id }, include: { _count: { select: { leases: true, orders: true } }, leases: { select: { status: true, expiresAt: true } } } });
      if (!user) throw notFound();
      const [leases, orders] = await Promise.all([
        this.db.lease.findMany({ where: { userId: id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } }, orderBy: { startedAt: 'desc' } }),
        this.db.order.findMany({ where: { userId: id }, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      ]);
      return { user: this.mapUser(user), leases: leases.map(row => this.mapLease(row)), orders: orders.map(row => this.mapOrder(row)) };
    }
    if (section === 'numbers') {
      const row = await this.db.phoneNumber.findUnique({ where: { id }, include: { leases: { include: { user: true }, orderBy: { startedAt: 'desc' } } } });
      if (!row) throw notFound();
      return { number: this.mapNumber(row), leases: row.leases.map(lease => this.mapLease({ ...lease, phoneNumber: row, _count: { messages: 0, outbound: 0 } })) };
    }
    if (section === 'leases') {
      const lease = await this.db.lease.findUnique({ where: { id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      if (!lease) throw notFound();
      const [orders, inbound, outbound] = await Promise.all([
        this.db.order.findMany({ where: { leaseId: id }, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true }, orderBy: { createdAt: 'desc' } }),
        this.db.message.findMany({ where: { leaseId: id }, include: { lease: { include: { user: true, phoneNumber: true } } } }),
        this.db.outboundMessage.findMany({ where: { leaseId: id }, include: { lease: { include: { user: true, phoneNumber: true } } } }),
      ]);
      const messages = [...inbound.map(row => this.mapInbound(row)), ...outbound.map(row => this.mapOutbound(row))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
      return { lease: this.mapLease(lease), orders: orders.map(row => this.mapOrder(row)), messages };
    }
    const order = await this.db.order.findUnique({ where: { id }, include: { user: true, lease: { include: { phoneNumber: true } }, phoneNumber: true } });
    if (!order) throw notFound();
    return this.mapOrder(order);
  }

  async userStatus(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'USER_STATUS', async (tx, reason) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw notFound();
      if (user.role === 'ADMIN') throw errorWithCode('不能对管理员账号执行此操作。', 'ADMIN_PROTECTED');
      const status = body.status === 'ACTIVE' || body.status === 'DISABLED' ? body.status : '';
      if (!status) throw errorWithCode('用户状态无效。', 'VALIDATION_ERROR', 400);
      await tx.user.update({ where: { id }, data: { status } });
      if (status === 'DISABLED') await tx.session.deleteMany({ where: { userId: id } });
      return { value: await this.userView(tx, id), targetId: id };
    });
  }
  async resetPassword(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'USER_PASSWORD_RESET', async tx => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw notFound();
      if (user.role === 'ADMIN') throw errorWithCode('不能对管理员账号执行此操作。', 'ADMIN_PROTECTED');
      const next = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (next.length < 12 || next.length > 128) throw errorWithCode('新密码需要 12–128 个字符。', 'VALIDATION_ERROR', 400);
      await tx.user.update({ where: { id }, data: { passwordHash: await passwordHash(next) } });
      await tx.session.deleteMany({ where: { userId: id } });
      return { value: { ok: true } as const, targetId: id };
    });
  }
  async assignNumber(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'NUMBER_ASSIGN', async (tx, reason, operationKey) => {
      await lockPhone(tx, id);
      const userId = text(body.userId);
      if (!uuid.test(userId)) throw errorWithCode('目标用户无效。', 'VALIDATION_ERROR', 400);
      await lockUser(tx, userId);
      const [number, user] = await Promise.all([tx.phoneNumber.findUnique({ where: { id } }), tx.user.findUnique({ where: { id: userId } })]);
      if (!number) throw notFound();
      if (!user || user.status !== 'ACTIVE' || user.role !== 'USER') throw errorWithCode('目标用户不存在或已禁用。', 'USER_UNAVAILABLE');
      if (number.occupied || number.holdReason) throw errorWithCode('号码已被占用或已暂停，请刷新后重试。', 'NUMBER_UNAVAILABLE');
      if (body.term !== 7 && body.term !== 30) throw errorWithCode('租期无效。', 'VALIDATION_ERROR', 400);
      const startedAt = new Date(), expiresAt = new Date(startedAt.getTime() + Number(body.term) * day);
      const lease = await tx.lease.create({ data: { userId, phoneNumberId: id, termDays: Number(body.term), priceMinor: 0, currency: 'USD', status: 'ACTIVE', startedAt, expiresAt } });
      await tx.phoneNumber.update({ where: { id }, data: { occupied: true, holdReason: null } });
      await tx.order.create({ data: { userId, leaseId: lease.id, phoneNumberId: id, numberSnapshot: number.number, kind: 'ADMIN_ASSIGN', termDays: Number(body.term), amountMinor: 0, currency: 'USD', status: 'COMPLETED', idempotencyKey: operationKey, requestHash: fingerprint({ operationKey, id, userId, term: body.term }) } });
      const result = await tx.lease.findUniqueOrThrow({ where: { id: lease.id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      return { value: this.mapLease(result), targetId: id };
    });
  }
  async holdNumber(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'NUMBER_HOLD', async tx => {
      await lockPhone(tx, id);
      const number = await tx.phoneNumber.findUnique({ where: { id }, include: { leases: { include: { user: true } } } });
      if (!number) throw notFound();
      if (number.occupied) throw errorWithCode('号码已被占用或已暂停，请刷新后重试。', 'NUMBER_UNAVAILABLE');
      if (typeof body.hold !== 'boolean') throw errorWithCode('hold 必须是布尔值。', 'VALIDATION_ERROR', 400);
      await tx.phoneNumber.update({ where: { id }, data: body.hold ? { holdReason: text(body.reason) } : { holdReason: null } });
      const current = await tx.phoneNumber.findUniqueOrThrow({ where: { id }, include: { leases: { include: { user: true } } } });
      return { value: this.mapNumber(current), targetId: id };
    });
  }
  async endLease(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'LEASE_END', async tx => {
      const current = await tx.lease.findUnique({ where: { id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      if (!current) throw notFound();
      if (current.status !== 'ACTIVE' || current.expiresAt.getTime() <= Date.now()) throw errorWithCode('租约已结束或已变化，请刷新后重试。', 'LEASE_NOT_ACTIVE');
      await lockPhone(tx, current.phoneNumberId);
      const endedAt = new Date();
      const lease = await tx.lease.update({ where: { id }, data: { status: 'ENDED', endedAt }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      await tx.phoneNumber.update({ where: { id: current.phoneNumberId }, data: { occupied: false, holdReason: '管理员回收，待人工复核' } });
      return { value: this.mapLease(lease), targetId: id };
    });
  }
  async extendLease(actorId: string, id: string, body: WriteInput, key: unknown) {
    return this.recordMutation(actorId, key, body, 'LEASE_EXTEND', async (tx, reason, operationKey) => {
      const current = await tx.lease.findUnique({ where: { id }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      if (!current) throw notFound();
      if (current.status !== 'ACTIVE' || current.expiresAt.getTime() <= Date.now()) throw errorWithCode('租约已结束或已变化，请刷新后重试。', 'LEASE_NOT_ACTIVE');
      if (body.days !== 7 && body.days !== 30) throw errorWithCode('延期天数无效。', 'VALIDATION_ERROR', 400);
      await lockPhone(tx, current.phoneNumberId);
      const expiresAt = new Date(current.expiresAt.getTime() + Number(body.days) * day);
      const lease = await tx.lease.update({ where: { id }, data: { expiresAt }, include: { user: true, phoneNumber: true, _count: { select: { messages: true, outbound: true } } } });
      await tx.order.create({ data: { userId: lease.userId, leaseId: id, phoneNumberId: lease.phoneNumberId, numberSnapshot: lease.phoneNumber.number, kind: 'ADMIN_EXTEND', termDays: Number(body.days), amountMinor: 0, currency: lease.currency, status: 'COMPLETED', idempotencyKey: operationKey, requestHash: fingerprint({ operationKey, id, days: body.days }) } });
      return { value: this.mapLease(lease), targetId: id };
    });
  }

  async retryWebhook(actorId: string, id: string, body: WriteInput, key: unknown) {
    const requestKey = validateKey(key), reason = validateReason(body), requestHash = fingerprint(body);
    const previous = await this.db.adminIdempotency.findUnique({ where: { key: requestKey } });
    if (previous) {
      if (previous.requestHash !== requestHash) throw errorWithCode('该操作已用不同内容提交过，请关闭弹窗重新操作。', 'IDEMPOTENCY_CONFLICT');
      if (previous.result === null) throw errorWithCode('该操作正在处理中，请稍后刷新核对结果。', 'IDEMPOTENCY_IN_PROGRESS');
      return previous.result;
    }
    const event = await this.db.webhookEvent.findUnique({ where: { id } });
    if (!event) throw notFound();
    if (event.status === 'PROCESSED') throw errorWithCode('该事件当前状态不能重新处理。', 'WEBHOOK_NOT_RETRYABLE');
    if (!['FAILED', 'QUARANTINED', 'RECEIVED'].includes(event.status)) throw errorWithCode('该事件当前状态不能重新处理。', 'WEBHOOK_NOT_RETRYABLE');
    await this.db.webhookEvent.update({ where: { id }, data: { status: 'RECEIVED', lastError: null, nextAttemptAt: null } });
    try {
      const payload = event.payload as { event?: string };
      if (event.provider === 'pingcode') {
        if (payload.event === 'sms.send.status_changed') await this.outbound.processReceipt(id);
        else await this.incoming.process(id);
      } else if (event.provider.startsWith('demo-inbox:') && event.leaseId) {
        const lease = await this.db.lease.findUnique({ where: { id: event.leaseId } });
        if (!lease) throw notFound();
        await this.events.process(lease.userId, id);
      } else {
        throw errorWithCode('该事件当前状态不能重新处理。', 'WEBHOOK_NOT_RETRYABLE');
      }
      const updated = await this.db.webhookEvent.findUniqueOrThrow({ where: { id } });
      const value = this.mapWebhook(updated);
      return this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admin:idempotency:' + requestKey},0))`;
        const race = await tx.adminIdempotency.findUnique({ where: { key: requestKey } });
        if (race?.result) return race.result;
        await tx.adminIdempotency.create({ data: { id: randomUUID(), key: requestKey, actorId, requestHash, result: value as unknown as Prisma.InputJsonValue } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'WEBHOOK_RETRY', resourceId: id, targetType: 'webhook', reason } });
        return value;
      }, transactionOptions);
    } catch (error) {
      await this.db.adminIdempotency.deleteMany({ where: { key: requestKey, actorId } });
      throw error;
    }
  }
}

function actionTarget(action: string) {
  if (action.startsWith('USER_') || action === 'ADMIN_BOOTSTRAP') return 'user';
  if (action.startsWith('NUMBER_')) return 'number';
  if (action.startsWith('LEASE_')) return 'lease';
  return 'webhook';
}
