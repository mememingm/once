// Admin API contract. The backend implementation is tracked in docs/ONCE-ADMIN-API.md;
// keep both in sync when a field changes.
export type AdminRole = "USER" | "ADMIN";
export type UserStatus = "ACTIVE" | "DISABLED";
export type SaleStatus = "AVAILABLE" | "OCCUPIED" | "HELD";

export interface AdminSession {
  id: string;
  email: string;
  role: AdminRole;
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
export interface AdminQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  userId?: string;
  leaseId?: string;
  provider?: string;
  direction?: string;
}
export interface AdminUser {
  id: string;
  email: string;
  role: AdminRole;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  activeLeaseCount: number;
  leaseCount: number;
  orderCount: number;
}
export interface AdminNumber {
  id: string;
  number: string;
  countryCode: string;
  countryName: string;
  regionName: string;
  provider: string;
  providerNumberId: string | null;
  providerStatus: string | null;
  resourceExpiresAt: string | null;
  lastSyncedAt: string | null;
  smsEnabled: boolean;
  saleStatus: SaleStatus;
  holdReason: string | null;
  currentLease: { id: string; userId: string; email: string; expiresAt: string } | null;
  createdAt: string;
}
export interface AdminLease {
  id: string;
  userId: string;
  email: string;
  phoneNumberId: string;
  number: string;
  countryName: string;
  regionName: string;
  provider: string;
  term: number;
  priceMinor: number;
  currency: string;
  status: "ACTIVE" | "EXPIRED_HELD" | "ENDED";
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  messageCount: number;
  outboundCount: number;
}
export interface AdminOrder {
  id: string;
  userId: string;
  email: string;
  leaseId: string | null;
  number: string | null;
  kind: "RENT" | "RENEW" | "ADMIN_ASSIGN" | "ADMIN_EXTEND";
  termDays: number;
  amountMinor: number;
  currency: string;
  status: string;
  attempts: number;
  lastError: string | null;
  providerOrderId: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface AdminMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  leaseId: string;
  userId: string;
  email: string;
  number: string;
  peer: string;
  body: string;
  code: string | null;
  status: string | null;
  readAt: string | null;
  provider: string;
  providerMessageId: string | null;
  lastError: string | null;
  at: string;
}
export interface AdminWebhook {
  id: string;
  provider: string;
  eventId: string;
  status: "RECEIVED" | "PROCESSED" | "FAILED" | "QUARANTINED";
  attempts: number;
  lastError: string | null;
  conflictCount: number;
  leaseId: string | null;
  outboundMessageId: string | null;
  providerNumberId: string | null;
  providerMessageId: string | null;
  occurredAt: string | null;
  receivedAt: string;
  processedAt: string | null;
  nextAttemptAt: string | null;
  payload: unknown;
}
export interface AdminAudit {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: string;
}
export interface AdminSummary {
  users: number;
  activeLeases: number;
  availableNumbers: number;
  heldNumbers: number;
  todayOrders: number;
  todayRevenueMinor: number;
  currency: string;
  expiringLeases: number;
  failedOutbound: number;
  failedWebhooks: number;
  uncertainOrders: number;
  recentOrders: AdminOrder[];
  expiring: AdminLease[];
  integrations: {
    demoMode: boolean;
    pingcodeConfigured: boolean;
    receiveWebhookConfigured: boolean;
    paymentsConnected: boolean;
  };
}
export interface UserDetail { user: AdminUser; leases: AdminLease[]; orders: AdminOrder[] }
export interface NumberDetail { number: AdminNumber; leases: AdminLease[] }
export interface LeaseDetail { lease: AdminLease; orders: AdminOrder[]; messages: AdminMessage[] }
