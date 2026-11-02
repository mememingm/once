import { QueryClient } from "@tanstack/react-query";
import { localDemo, type RequestOptions } from "./models";
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 60_000,
      gcTime: 300_000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "",
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const authEvents = new EventTarget();
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (localDemo()) {
    options.signal?.throwIfAborted();
    const result = await window.OnceMock!.request(path, options);
    options.signal?.throwIfAborted();
    return result as T;
  }
  const headers = new Headers(options.headers);
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => null)) as {
    message?: string | string[];
    code?: string;
  } | null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      authEvents.dispatchEvent(new Event("expired"));
    throw new ApiError(
      payload?.message
        ? [payload.message].flat().join("；")
        : `请求失败（${response.status}）`,
      response.status,
      typeof payload?.code === "string" ? payload.code : "",
    );
  }
  if (payload === null) throw new Error("服务返回了无法读取的数据，请重试。");
  return payload as T;
}
function newOperationId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const operationKeys = new Map<string, string>();
const operationPayloads = new Map<string, object>();
const operationStorageKey = (owner: string, signature: string) =>
  `once-operation:${owner}:${signature}`;
export function operationKey(owner: string, signature: string) {
  const key = operationStorageKey(owner, signature);
  let result = operationKeys.get(key);
  if (!result) {
    let saved = "";
    try {
      saved = sessionStorage.getItem(key) || "";
    } catch {
      /* In-memory retries remain available. */
    }
    result = /^[A-Za-z0-9_-]{16,128}$/.test(saved)
      ? saved
      : newOperationId();
    operationKeys.set(key, result);
    try {
      sessionStorage.setItem(key, result);
    } catch {
      /* Keep the same key until this operation completes. */
    }
  }
  return result;
}
export function operationPayload<T extends object>(
  owner: string,
  signature: string,
  create: (eventId: string) => T,
): T {
  const key = operationStorageKey(owner, signature) + ":payload";
  const eventId = operationKey(owner, signature);
  if (!operationPayloads.has(key)) {
    let saved: (T & { eventId?: string }) | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      /* Fall back to the stable in-memory event. */
    }
    const payload = saved?.eventId === eventId ? saved : create(eventId);
    operationPayloads.set(key, payload);
    try {
      sessionStorage.setItem(key, JSON.stringify(payload));
    } catch {
      /* Retain the in-memory payload. */
    }
  }
  return operationPayloads.get(key) as T;
}
export function completeOperation(owner: string, signature: string) {
  const key = operationStorageKey(owner, signature);
  operationKeys.delete(key);
  operationPayloads.delete(key + ":payload");
  try {
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(key + ":payload");
  } catch {
    /* No credentials are stored here. */
  }
}
