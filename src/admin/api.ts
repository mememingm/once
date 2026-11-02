import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import { ApiError, request } from "../lib/api";
import type { RequestOptions } from "../lib/models";
import type {
  AdminAudit, AdminLease, AdminMessage, AdminNumber, AdminOrder, AdminQuery, AdminSession,
  AdminSummary, AdminUser, AdminWebhook, LeaseDetail, NumberDetail, Page, UserDetail,
} from "./types";

// `npm run dev:admin-mock` serves fixtures so the admin UI works before /api/admin exists.
// The flag is replaced at build time, so production bundles never include the mock module.
export const adminMock = import.meta.env.VITE_ADMIN_MOCK === "true";

async function adminRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (adminMock) {
    const { mockAdminRequest } = await import("./mock");
    return mockAdminRequest(path, options) as Promise<T>;
  }
  return request<T>(`/admin${path}`, options);
}
function query(input: AdminQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return params.size ? `?${params}` : "";
}
// Each confirmation dialog holds one key, so a retried submit cannot apply twice.
function write<T>(path: string, body: object, key: string) {
  return adminRequest<T>(path, { method: "POST", body, headers: { "Idempotency-Key": key } });
}

export const adminKeys = {
  all: ["admin"] as const,
  session: () => ["admin", "session"] as const,
  summary: () => ["admin", "summary"] as const,
  list: (section: string, input: AdminQuery) => ["admin", section, "list", input] as const,
  detail: (section: string, id: string) => ["admin", section, "detail", id] as const,
};
export const sessionOptions = () =>
  queryOptions({
    queryKey: adminKeys.session(),
    queryFn: ({ signal }) => adminRequest<AdminSession>("/session", { signal }),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
export const summaryOptions = () =>
  queryOptions({
    queryKey: adminKeys.summary(),
    queryFn: ({ signal }) => adminRequest<AdminSummary>("/summary", { signal }),
  });

type Sections = {
  users: AdminUser; numbers: AdminNumber; leases: AdminLease; orders: AdminOrder;
  messages: AdminMessage; webhooks: AdminWebhook; audit: AdminAudit;
};
export function listOptions<S extends keyof Sections>(section: S, input: AdminQuery) {
  return queryOptions({
    queryKey: adminKeys.list(section, input),
    queryFn: ({ signal }) => adminRequest<Page<Sections[S]>>(`/${section}${query(input)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}
type Details = { users: UserDetail; numbers: NumberDetail; leases: LeaseDetail; orders: AdminOrder };
export function detailOptions<S extends keyof Details>(section: S, id: string) {
  return queryOptions({
    queryKey: adminKeys.detail(section, id),
    queryFn: ({ signal }) => adminRequest<Details[S]>(`/${section}/${encodeURIComponent(id)}`, { signal }),
  });
}

export const adminApi = {
  userStatus: (id: string, body: { status: "ACTIVE" | "DISABLED"; reason: string }, key: string) =>
    write<AdminUser>(`/users/${id}/status`, body, key),
  resetPassword: (id: string, body: { newPassword: string; reason: string }, key: string) =>
    write<{ ok: true }>(`/users/${id}/password`, body, key),
  assignNumber: (id: string, body: { userId: string; term: 7 | 30; reason: string }, key: string) =>
    write<AdminLease>(`/numbers/${id}/assign`, body, key),
  holdNumber: (id: string, body: { hold: boolean; reason: string }, key: string) =>
    write<AdminNumber>(`/numbers/${id}/hold`, body, key),
  endLease: (id: string, body: { reason: string }, key: string) =>
    write<AdminLease>(`/leases/${id}/end`, body, key),
  extendLease: (id: string, body: { days: 7 | 30; reason: string }, key: string) =>
    write<AdminLease>(`/leases/${id}/extend`, body, key),
  retryWebhook: (id: string, body: { reason: string }, key: string) =>
    write<AdminWebhook>(`/webhooks/${id}/retry`, body, key),
};

const codes: Record<string, string> = {
  ADMIN_REQUIRED: "当前账号没有管理员权限。",
  ADMIN_PROTECTED: "不能对管理员账号执行此操作。",
  USER_UNAVAILABLE: "目标用户不存在或已禁用。",
  NUMBER_UNAVAILABLE: "号码已被占用或已暂停，请刷新后重试。",
  LEASE_NOT_ACTIVE: "租约已结束或已变化，请刷新后重试。",
  WEBHOOK_NOT_RETRYABLE: "该事件当前状态不能重新处理。",
  IDEMPOTENCY_CONFLICT: "该操作已用不同内容提交过，请关闭弹窗重新操作。",
};
export function adminError(error: unknown) {
  if (!(error instanceof ApiError))
    return error instanceof DOMException && error.name === "TimeoutError"
      ? "请求超时，请刷新核对操作结果后再试。"
      : "无法连接服务，请重试。";
  if (codes[error.code]) return codes[error.code]!;
  if (error.status === 429) return "请求过于频繁，请稍后重试。";
  if (error.status >= 500) return "服务暂时不可用，请重试。";
  return error.message;
}
