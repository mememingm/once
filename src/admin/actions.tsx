import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApp } from "../app/AppProvider";
import { adminApi, adminError, adminKeys, listOptions } from "./api";
import { ConfirmDialog, ReasonField, daysLeft, useOperationKey } from "./primitives";
import type { AdminLease, AdminNumber, AdminUser, AdminWebhook } from "./types";

export type ActionTarget =
  | { kind: "user-status"; user: AdminUser }
  | { kind: "password"; user: AdminUser }
  | { kind: "assign"; number: AdminNumber }
  | { kind: "hold"; number: AdminNumber }
  | { kind: "end"; lease: AdminLease }
  | { kind: "extend"; lease: AdminLease }
  | { kind: "retry"; event: AdminWebhook };

function title(target: ActionTarget) {
  switch (target.kind) {
    case "user-status": return target.user.status === "ACTIVE" ? "禁用账号" : "启用账号";
    case "password": return "重置密码";
    case "assign": return "手动分配号码";
    case "hold": return target.number.saleStatus === "HELD" ? "恢复售卖" : "暂停售卖";
    case "end": return "回收号码";
    case "extend": return "租约延期";
    case "retry": return "重新处理事件";
  }
}
const suggestions: Record<ActionTarget["kind"], string[]> = {
  "user-status": ["违规使用", "用户申请注销", "申诉通过，恢复使用"],
  password: ["用户忘记密码", "用户申请重置"],
  assign: ["客户补发号码", "线下付款开通", "测试使用"],
  hold: ["号码异常暂停售卖", "上游号码离线", "复核完成，恢复售卖"],
  end: ["客户退订", "违规使用回收", "分配错误"],
  extend: ["补偿服务中断", "客服补偿", "线下续费"],
  retry: ["已修复号码映射，重新匹配", "上游已恢复，重试"],
};
function subject(target: ActionTarget) {
  if ("user" in target) return target.user.email;
  if ("number" in target) return `${target.number.number} · ${target.number.countryName}${target.number.regionName ? ` ${target.number.regionName}` : ""}`;
  if ("lease" in target) return `${target.lease.number} · ${target.lease.email}`;
  return `${target.event.eventId} · ${target.event.provider}`;
}

function UserPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const users = useQuery(listOptions("users", { status: "ACTIVE", search: term, pageSize: 20 }));
  const options = (users.data?.items ?? []).filter(user => user.role === "USER");
  const onlyUserId = !users.isPlaceholderData && !users.isFetching && !users.isError && users.data?.totalItems === 1 && options.length === 1 ? options[0]!.id : "";
  useEffect(() => {
    if (onlyUserId && !disabled && value !== onlyUserId) onChange(onlyUserId);
  }, [onlyUserId, disabled, value, onChange]);
  const searchUsers = () => { onChange(""); setTerm(search.trim()); };
  return <><label>查找用户<div className="oa-inline-search">
    <Input value={search} disabled={disabled} placeholder="邮箱或用户 ID" onChange={event => setSearch(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); searchUsers(); } }} />
    <Button type="button" variant="outline" disabled={disabled} onClick={searchUsers}>查找</Button></div></label>
    <label>目标用户<Select value={value} onValueChange={onChange} disabled={disabled || users.isFetching}>
      <SelectTrigger className="oa-select"><SelectValue placeholder={users.isPending ? "正在加载用户…" : options.length ? "请选择用户" : "没有匹配的正常用户"} /></SelectTrigger>
      <SelectContent className="once-admin-portal">{options.map(user => <SelectItem key={user.id} value={user.id}>{user.email}</SelectItem>)}</SelectContent>
    </Select>{users.isError && <small className="oa-error">{adminError(users.error)}</small>}</label></>;
}

/** All admin writes go through this dialog: one reason, one idempotency key, then a full admin refresh. */
export function ActionDialog({ target, onClose }: { target: ActionTarget; onClose: () => void }) {
  const client = useQueryClient();
  const { notify } = useApp();
  const key = useOperationKey();
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [userId, setUserId] = useState("");
  const [days, setDays] = useState<"7" | "30">("30");
  const [error, setError] = useState("");
  const name = title(target);
  const mutation = useMutation({
    mutationFn: (): Promise<unknown> => {
      switch (target.kind) {
        case "user-status": return adminApi.userStatus(target.user.id, { status: target.user.status === "ACTIVE" ? "DISABLED" : "ACTIVE", reason }, key);
        case "password": return adminApi.resetPassword(target.user.id, { newPassword: password, reason }, key);
        case "assign": return adminApi.assignNumber(target.number.id, { userId, term: days === "7" ? 7 : 30, reason }, key);
        case "hold": return adminApi.holdNumber(target.number.id, { hold: target.number.saleStatus !== "HELD", reason }, key);
        case "end": return adminApi.endLease(target.lease.id, { reason }, key);
        case "extend": return adminApi.extendLease(target.lease.id, { days: days === "7" ? 7 : 30, reason }, key);
        case "retry": return adminApi.retryWebhook(target.event.id, { reason }, key);
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: adminKeys.all });
      notify(`${name}已完成，操作已记入日志。`, "success");
      onClose();
    },
    onError: cause => setError(adminError(cause)),
  });
  const busy = mutation.isPending;
  function submit() {
    setError("");
    if (target.kind === "password") {
      if (password.length < 12) return setError("新密码至少 12 个字符。");
      if (password !== confirmation) return setError("两次输入的新密码不一致。");
    }
    if (reason.trim().length < 3) return setError("请填写至少 3 个字的操作原因。");
    mutation.mutate();
  }
  const danger = (target.kind === "user-status" && target.user.status === "ACTIVE") || target.kind === "end";
  return <ConfirmDialog title={name} busy={busy} onClose={onClose} footer={<>
    <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
    <Button type="submit" form="oa-action-form" variant={danger ? "destructive" : "default"} disabled={busy || (target.kind === "assign" && !userId)}>
      {busy ? <RefreshCw className="oa-spin" /> : <Check />}确认{name}</Button></>}>
    <form id="oa-action-form" onSubmit={event => { event.preventDefault(); submit(); }}><fieldset disabled={busy}>
      <p className="oa-confirm-target">{subject(target)}</p>
      {target.kind === "user-status" && target.user.status === "ACTIVE" && <p className="oa-warning">禁用后该用户的登录会话立即失效；号码、租约和订单记录保留。</p>}
      {target.kind === "password" && <><p className="oa-warning">重置后，该用户在所有设备上的登录都会失效。请通过安全渠道把新密码告诉用户。</p>
        <label>新密码（至少 12 位）<Input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} aria-describedby="admin-password-hint" onChange={event => setPassword(event.target.value)} /></label>
        <p id="admin-password-hint" className="oa-context">密码长度为 12–128 个字符。</p>
        <label>确认新密码<Input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label></>}
      {target.kind === "assign" && <><p className="oa-context">手动分配不收费，会生成一笔金额为 0 的「管理员开通」订单。</p>
        <UserPicker value={userId} onChange={setUserId} disabled={busy} /></>}
      {(target.kind === "assign" || target.kind === "extend") && <label>{target.kind === "assign" ? "租期" : "延长天数"}
        <Select value={days} onValueChange={value => setDays(value === "7" ? "7" : "30")} disabled={busy}>
          <SelectTrigger className="oa-select"><SelectValue /></SelectTrigger>
          <SelectContent className="once-admin-portal"><SelectItem value="7">7 天</SelectItem><SelectItem value="30">30 天</SelectItem></SelectContent>
        </Select>{target.kind === "extend" && <small>当前到期：{daysLeft(target.lease.expiresAt)}；延期不收费。</small>}</label>}
      {target.kind === "hold" && target.number.saleStatus !== "HELD" && <p className="oa-context">暂停后用户在选号页看不到这个号码；不影响已有租约。</p>}
      {target.kind === "hold" && target.number.saleStatus === "HELD" && <p className="oa-warning">恢复后号码会重新出现在可售库存中。请先确认上一位用户的保留期已结束。</p>}
      {target.kind === "end" && <p className="oa-warning">立即结束这条租约，用户将不能再用这个号码收发短信。历史短信和订单保留；号码回收后保持「已暂停」，不会自动重新上架。</p>}
      {target.kind === "retry" && <p className="oa-context">只重新匹配这条已保存的事件，不会向 PingCode 发起新请求。</p>}
      <ReasonField value={reason} onChange={setReason} disabled={busy} suggestions={suggestions[target.kind]} />
      {error && <p role="alert" className="oa-error">{error}</p>}
    </fieldset></form>
  </ConfirmDialog>;
}
