import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsFetching, useMutation, useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  completeOperation,
  operationKey,
  operationPayload,
  queryClient,
  request,
} from "../lib/api";
import {
  markCachedMessagesRead,
  queryKeys,
  seedResolvedLease,
  workspaceOptions,
  workspaceScope,
} from "../lib/queries";
import {
  canRenew,
  errorMessage,
  localDemo,
  messagesForView,
  savedSelection,
  selectionKey,
  terms,
  type MutationResult,
  type Snapshot,
} from "../lib/models";
import {
  createWorkspaceStore,
  type WorkspaceUIState,
} from "../stores/workspace-store";
import { useApp } from "./AppProvider";
interface WorkspaceValue {
  data?: Snapshot;
  selectedId: string;
  requestedId: string;
  messages: ReturnType<typeof messagesForView>;
  loading: boolean;
  switching: boolean;
  error: string;
  refresh: () => Promise<void>;
  selectLease: (id: string) => void;
  readMessages: (id?: string) => Promise<void>;
  simulate: () => Promise<void>;
  reconcile: (id: string) => Promise<void>;
  busy: boolean;
  openRenew: (days?: number) => void;
  closeRenew: () => void;
  confirmRenew: () => Promise<void>;
  setScenesOpen: (open: boolean) => void;
  resetDemo: (scene: string) => void;
}
const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const WorkspaceUIContext = createContext<ReturnType<
  typeof createWorkspaceStore
> | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { account, notify } = useApp();
  const owner = account!.id,
    scope = workspaceScope(owner);
  const location = useLocation(),
    navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedId = params.get("leaseId") || savedSelection(owner);
  const [uiStore] = useState(createWorkspaceStore);
  const { closeRenew, setScenesOpen, reset } = uiStore.getState();
  const dialogOpen = useStore(
    uiStore,
    (state) => state.renewOpen || state.scenesOpen,
  );
  const lastGood = useRef<Snapshot | undefined>(undefined);
  const { mutateAsync, isPending: busy } = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onError: (error) => notify(errorMessage(error), "error"),
  });
  const snapshot = useQuery({
    ...workspaceOptions(scope, requestedId),
    refetchInterval: (query) =>
      !busy && !dialogOpen && query.state.data?.bills.some(order => ["PENDING", "PROCESSING", "UNCERTAIN"].includes(order.status))
        ? 30_000
        : false,
    refetchIntervalInBackground: false,
  });
  const data = snapshot.data || lastGood.current;
  useEffect(() => {
    if (!snapshot.data) return;
    lastGood.current = snapshot.data;
    const id = snapshot.data.lease?.id || "";
    if (!requestedId)
      seedResolvedLease(
        queryClient,
        scope,
        snapshot.data,
        snapshot.dataUpdatedAt,
      );
    try {
      localStorage.setItem(selectionKey(owner), id);
    } catch {
      /* Keep the route selection when storage is unavailable. */
    }
    if (
      id &&
      !params.has("leaseId") &&
      ["/app/numbers", "/app/inbox", "/app/send", "/app/messages"].includes(location.pathname)
    ) {
      setParams(
        (previous) => {
          previous.set("leaseId", id);
          return previous;
        },
        { replace: true },
      );
    }
  }, [
    snapshot.data,
    snapshot.dataUpdatedAt,
    requestedId,
    scope,
    owner,
    location.pathname,
    params,
    setParams,
  ]);
  useEffect(() => {
    reset();
  }, [location.pathname, requestedId, reset]);
  const selectedId = data?.lease?.id || "";
  const switching = Boolean(requestedId && data && requestedId !== selectedId);
  const messages = useMemo(
    () => (data ? messagesForView(data, owner) : []),
    [data, owner],
  );
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.workspaces(scope),
      refetchType: "active",
    });
    await queryClient.invalidateQueries({queryKey: ["sms-chat", scope]});
  }, [scope]);
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) return;
      await mutateAsync(action).catch(() => undefined);
    },
    [busy, mutateAsync],
  );
  const selectLease = useCallback(
    (id: string) => {
      if (busy) return;
      const next = new URLSearchParams();
      next.set("leaseId", id);
      if (location.pathname === "/app/send" || params.has("compose"))
        next.set("compose", params.get("compose") === "mms" ? "mms" : "sms");
      navigate(`${location.pathname}?${next}`);
    },
    [busy, location.pathname, params, navigate],
  );
  const readMessages = useCallback(
    async (messageId = "") => {
      if (!data?.lease || switching) return;
      const leaseId = data.lease.id;
      try {
        if (localDemo()) await window.OnceMock!.markRead(leaseId, messageId);
        else {
          const ids = messages.filter(message => !messageId || message.id === messageId).map(message => message.id);
          for (let index = 0; index < ids.length; index += 200)
            await request(`/leases/${leaseId}/chat/read`, {method: "POST", body: {ids: ids.slice(index, index + 200)}});
          await queryClient.invalidateQueries({queryKey: ["sms-chat", scope, leaseId]});
        }
        markCachedMessagesRead(queryClient, scope, leaseId, messageId);
      } catch (error) {
        notify(errorMessage(error, "已读状态保存失败。"), "error");
      }
    },
    [data, switching, owner, messages, scope, notify],
  );
  const openRenew = useCallback(
    (days?: number) => {
      if (!data || !canRenew(data) || switching || busy) return;
      uiStore
        .getState()
        .openRenew(days ?? data.lease!.term, new Date(data.lease!.expiresAt).getTime());
    },
    [data, switching, busy, uiStore],
  );
  const confirmRenew = useCallback(
    () =>
      run(async () => {
        const { renewDays, renewBase, setRenewError } = uiStore.getState();
        setRenewError("");
        try {
          if (!data || !canRenew(data) || switching)
            throw new Error("当前号码已到期或租期待确认，暂不能续费。");
          if (!terms.some(term => term.days === renewDays) || !Number.isFinite(renewBase) || renewBase <= 0)
            throw new Error("请选择有效的续费套餐，并确认当前到期日期。");
          const signature = `renew:${data.lease!.id}:${renewDays}`;
          await request<MutationResult>(
            `/leases/${encodeURIComponent(data.lease!.id)}/renew`,
            {
              method: "POST",
              headers: { "Idempotency-Key": operationKey(owner, signature) },
              body: { term: renewDays },
            },
          );
          completeOperation(owner, signature);
          closeRenew();
          await refresh();
          notify(`同号续费已记录，租期延长 ${renewDays} 天。`);
        } catch (error) {
          setRenewError(errorMessage(error));
          throw error;
        }
      }),
    [run, data, switching, closeRenew, uiStore, owner, refresh, notify],
  );
  const simulate = useCallback(
    () =>
      run(async () => {
        if (!data || !canRenew(data) || switching) return;
        const leaseId = data.lease!.id;
        if (localDemo())
          await request(`/leases/${encodeURIComponent(leaseId)}/demo-message`, {
            method: "POST",
            body: {},
          });
        else {
          const signature = `incoming:${leaseId}`;
          const body = operationPayload(owner, signature, (eventId) => ({
            eventId,
            leaseId,
            providerMessageId: eventId,
            sender: "ONCE service",
            title: "新短信",
            body: "这是一条演示短信。",
            receivedAt: new Date().toISOString(),
          }));
          const result = await request<{ status: string }>("/demo/events", {
            method: "POST",
            body,
          });
          if (result.status !== "PROCESSED")
            throw new Error("收件结果尚未确认，请刷新或核对事件后重试。");
          completeOperation(owner, signature);
        }
        await refresh();
        notify("收到一条新短信。");
      }),
    [run, data, switching, owner, refresh, notify],
  );
  const reconcile = useCallback(
    (id: string) =>
      run(async () => {
        if (localDemo() || !data?.demo) return;
        const path = `/demo/orders/${encodeURIComponent(id)}`;
        let result = await request<{ status: string; leaseId?: string }>(path);
        if (["PENDING", "UNCERTAIN"].includes(result.status))
          result = await request(
            `${path}/${result.status === "PENDING" ? "process" : "reconcile"}`,
            { method: "POST", body: {} },
          );
        await refresh();
        notify(
          result.status === "DEMO_CONFIRMED"
            ? "交付已确认，租约已保存。"
            : result.status === "FAILED"
              ? "交付失败，请稍后重试。"
              : "结果尚未确认，请稍后核对。",
        );
      }),
    [run, data, refresh, notify],
  );
  const resetDemo = useCallback(
    (scene: string) => {
      if (!localDemo() || busy) return;
      try {
        window.OnceMock!.reset(scene);
        const url = new URL(window.location.href);
        url.searchParams.set("scenario", scene);
        url.hash = "/app/numbers";
        window.location.assign(url.href);
        window.location.reload();
      } catch (error) {
        notify(errorMessage(error), "error");
      }
    },
    [busy, notify],
  );
  const loading = !data && snapshot.isPending;
  const error = snapshot.isError ? errorMessage(snapshot.error) : "";
  const value = useMemo<WorkspaceValue>(
    () => ({
      data,
      selectedId,
      requestedId,
      messages,
      loading,
      switching,
      error,
      refresh,
      selectLease,
      readMessages,
      simulate,
      reconcile,
      busy,
      openRenew,
      closeRenew,
      confirmRenew,
      setScenesOpen,
      resetDemo,
    }),
    [
      data,
      selectedId,
      requestedId,
      messages,
      loading,
      switching,
      error,
      refresh,
      selectLease,
      readMessages,
      simulate,
      reconcile,
      busy,
      openRenew,
      closeRenew,
      confirmRenew,
      setScenesOpen,
      resetDemo,
    ],
  );
  return (
    <WorkspaceUIContext.Provider value={uiStore}>
      <WorkspaceContext.Provider value={value}>
        {children}
      </WorkspaceContext.Provider>
    </WorkspaceUIContext.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("WorkspaceProvider missing");
  return value;
}
export function useWorkspaceUI<T>(selector: (state: WorkspaceUIState) => T) {
  const store = useContext(WorkspaceUIContext);
  if (!store) throw new Error("WorkspaceProvider missing");
  return useStore(store, selector);
}
export function useWorkspaceRefreshing() {
  const { account } = useApp();
  const { requestedId } = useWorkspace();
  return (
    useIsFetching({
      queryKey: queryKeys.workspace(workspaceScope(account!.id), requestedId),
      exact: true,
    }) > 0
  );
}
