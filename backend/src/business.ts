import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const plans: Record<number, number> = { 7: 1200, 30: 3500 };
export const day = 86400000;
export const transactionOptions = { maxWait: 10000, timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
export function idempotencyKey(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(value)) throw new BadRequestException('A 16-128 character Idempotency-Key header is required');
  return value;
}
export function fingerprint(value: unknown): string {
  // Sorted object keys make event and request fingerprints independent of JSON key order.
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,entry]) => [key,canonical(entry)])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
}
export async function lockPhone(tx: Prisma.TransactionClient, phoneNumberId: string) {
  await tx.$queryRaw`SELECT "id" FROM "PhoneNumber" WHERE "id" = ${phoneNumberId}::uuid FOR UPDATE`;
}

type Position = { v: 1; scope: string; time: string; id: string };
export function cursorPosition(cursor: string | undefined, scope: string) {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Position;
    if (value.v !== 1 || value.scope !== scope || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) || !Number.isFinite(Date.parse(value.time)) || new Date(value.time).toISOString() !== value.time) throw new Error();
    return { time: new Date(value.time), id: value.id };
  } catch { throw new BadRequestException('Invalid cursor for this history'); }
}
export function pageResult<T extends { id: string }>(rows: T[], limit: number, scope: string, date: (row: T) => Date) {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({v:1,scope,time:date(last).toISOString(),id:last.id})).toString('base64url') : null;
  return { items, nextCursor, hasMore };
}
