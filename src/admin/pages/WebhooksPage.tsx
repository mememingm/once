import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listOptions } from "../api";
import { useAdminPage } from "../context";
import { Badge, DateText, Drawer, Facts, IconAction, Pager, State, Table, rowClick } from "../primitives";
import type { AdminWebhook } from "../types";

const errors: Record<string, string> = {
  INBOUND_PROCESSING_FAILED: "处理时出错，系统会自动重试。",
  NO_LEASE_AT_RECEIVE_TIME: "收到短信时这个号码没有对应的有效租约，短信没有进入任何用户的收件箱。",
};
export function WebhooksPage() {
  const { input, update, openAction } = useAdminPage();
  const result = useQuery(listOptions("webhooks", input));
  const [selected, setSelected] = useState<AdminWebhook | null>(null);
  return <section className="oa-card">
    <p className="oa-context oa-pad">「失败」和「已隔离」的事件没有进入任何用户的收件箱，点开可以查看原因并重新处理。</p>
    <State query={result} columns={6} empty={result.data?.items.length === 0} />
    {result.data && result.data.items.length > 0 && <Table label="Webhook 事件" columns={["收到时间", "事件 ID", "上游号码 / 短信", "状态", "处理次数", ""]}>
      {result.data.items.map(event => <tr key={event.id} className="oa-clickable" onClick={rowClick(() => setSelected(event))}>
        <td><DateText value={event.receivedAt} /></td><td className="oa-mono">{event.eventId}{event.conflictCount > 0 && <small className="oa-error-text">内容冲突 {event.conflictCount} 次</small>}</td>
        <td className="oa-mono">{event.providerNumberId ?? "—"}<small>{event.providerMessageId ?? "—"}</small></td>
        <td><Badge value={event.status} /></td><td className="oa-numeric">{event.attempts}</td>
        <td><IconAction label="查看事件详情" onClick={() => setSelected(event)}><Eye /></IconAction></td>
      </tr>)}
    </Table>}
    <Pager data={result.data} onPage={page => update("page", String(page))} />
    {selected && <Drawer title="事件详情" onClose={() => setSelected(null)}>
      <div className="oa-detail-hero"><strong className="oa-mono">{selected.eventId}</strong><span>{selected.provider}</span><div><Badge value={selected.status} /></div></div>
      {selected.lastError && <p className="oa-warning">{errors[selected.lastError] ?? selected.lastError}</p>}
      <Facts rows={[["上游号码 ID", selected.providerNumberId ?? "—"], ["上游短信 ID", selected.providerMessageId ?? "—"], ["归属租约", selected.leaseId ?? "未匹配"],
        ["事件发生", <DateText value={selected.occurredAt} />], ["收到时间", <DateText value={selected.receivedAt} />], ["处理时间", <DateText value={selected.processedAt} />],
        ["下次自动重试", <DateText value={selected.nextAttemptAt} />], ["处理次数", selected.attempts], ["内容冲突", `${selected.conflictCount} 次`]]} />
      {selected.status !== "PROCESSED" && <div className="oa-detail-actions"><Button onClick={() => { setSelected(null); openAction({ kind: "retry", event: selected }); }}><RefreshCw />重新处理</Button></div>}
      <details className="oa-tech"><summary>原始推送内容</summary><pre className="oa-json">{JSON.stringify(selected.payload, null, 2)}</pre></details>
    </Drawer>}
  </section>;
}
