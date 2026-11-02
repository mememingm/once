import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowUpRight, Check, ClipboardList, Clock3, KeyRound, MessageSquareWarning, PackageCheck, ShieldCheck, Users, Webhook } from "lucide-react";
import { listOptions, summaryOptions } from "../api";
import { adminHref, auditLabels } from "../navigation";
import { useAdminPage } from "../context";
import { Badge, DateText, ShortId, State, Table, daysLeft, money } from "../primitives";
import { OrderTable } from "../tables";

export function OverviewPage() {
  const { openDetail } = useAdminPage();
  const result = useQuery(summaryOptions());
  const audit = useQuery(listOptions("audit", { pageSize: 10 }));
  const s = result.data;
  if (!s) return <State query={result} columns={4} />;
  const metrics = [
    { label: "使用中的租约", value: s.activeLeases.toLocaleString(), hint: "正在使用的号码", to: adminHref("leases", { status: "ACTIVE" }), icon: KeyRound },
    { label: "可售号码", value: s.availableNumbers.toLocaleString(), hint: `另有 ${s.heldNumbers} 个已暂停`, to: adminHref("numbers", { status: "AVAILABLE" }), icon: PackageCheck },
    { label: "今日订单", value: s.todayOrders.toLocaleString(), hint: `金额 ${money(s.todayRevenueMinor, s.currency)}`, to: adminHref("orders", { status: "TODAY" }), icon: ClipboardList },
    { label: "用户总数", value: s.users.toLocaleString(), hint: "所有注册账号", to: adminHref("users"), icon: Users },
  ];
  const todos = [
    { count: s.uncertainOrders, label: "笔订单需要核对", empty: "订单都正常", to: adminHref("orders", { status: "ATTENTION" }), icon: AlertCircle },
    { count: s.expiringLeases, label: "条租约 3 天内到期", empty: "近 3 天没有到期的租约", to: adminHref("leases", { status: "EXPIRING" }), icon: Clock3 },
    { count: s.failedOutbound, label: "条短信发送失败或待核对", empty: "短信发送都正常", to: adminHref("messages", { status: "FAILED" }), icon: MessageSquareWarning },
    { count: s.failedWebhooks, label: "个上游事件没处理成功", empty: "上游事件都已处理", to: adminHref("webhooks", { status: "FAILED" }), icon: Webhook },
  ];
  const pending = todos.filter(item => item.count > 0).length;
  const integrations = [
    ["PingCode 号码与发送", s.integrations.pingcodeConfigured], ["PingCode 收信推送", s.integrations.receiveWebhookConfigured], ["在线支付", s.integrations.paymentsConnected],
  ] as const;
  return <>
    <State query={result} />
    <section className="oa-todo" data-attention={pending > 0} aria-label="待处理事项">
      <div className="oa-todo-title">{pending ? <AlertCircle size={20} /> : <Check size={20} />}<div><h2>{pending ? `有 ${pending} 类事情需要你看一下` : "一切正常，暂时没有要处理的事"}</h2><p>点击条目直接跳到对应列表。</p></div></div>
      <div className="oa-todo-items">{todos.map(item => { const Icon = item.icon; return <Link key={item.label} className="oa-todo-item" data-attention={item.count > 0} to={item.to}>
        <Icon size={18} aria-hidden="true" /><span>{item.count > 0 ? <><strong>{item.count}</strong> {item.label}</> : item.empty}</span><ArrowUpRight size={15} aria-hidden="true" /></Link>; })}</div>
    </section>
    <div className="oa-metrics">{metrics.map(metric => { const Icon = metric.icon; return <Link className="oa-metric" key={metric.label} to={metric.to}>
      <span>{metric.label}</span><Icon size={18} className="oa-metric-icon" aria-hidden="true" /><strong>{metric.value}</strong><small>{metric.hint}</small></Link>; })}</div>
    <section className="oa-card"><div className="oa-card-heading"><h2>最近订单</h2><Link to={adminHref("orders")}>全部订单 <ArrowUpRight size={14} /></Link></div>
      {s.recentOrders.length ? <OrderTable orders={s.recentOrders} onDetail={id => openDetail({ section: "orders", id })} /> : <p className="oa-context oa-pad">还没有订单。</p>}</section>
    <div className="oa-two-column">
      <section className="oa-card"><div className="oa-card-heading"><h2>即将到期的租约</h2><Link to={adminHref("leases", { status: "EXPIRING" })}>查看全部 <ArrowUpRight size={14} /></Link></div>
        {s.expiring.length ? <Table label="即将到期" columns={["号码 / 用户", "到期时间"]}>{s.expiring.map(lease => <tr key={lease.id}>
          <td><button type="button" className="oa-text-button oa-mono" onClick={() => openDetail({ section: "leases", id: lease.id })}>{lease.number}</button><small>{lease.email}</small></td>
          <td><DateText value={lease.expiresAt} /><small>{daysLeft(lease.expiresAt)}</small></td></tr>)}</Table> : <p className="oa-context oa-pad">近 3 天没有到期的租约。</p>}</section>
      <section className="oa-card"><div className="oa-card-heading"><h2>系统接入状态</h2><span>技术人员关注</span></div>
        {integrations.map(([label, ready]) => <div className="oa-task" key={label}><span>{label}</span><Badge value={ready ? "COMPLETED" : "NOT_CONNECTED"} /></div>)}
        <p className="oa-context oa-pad oa-note"><ShieldCheck size={15} />{s.integrations.demoMode ? "当前为演示模式：租赁和续费不产生真实付款。" : "演示模式已关闭。"}</p></section>
    </div>
    <section className="oa-card"><div className="oa-card-heading"><h2>最近操作</h2><Link to={adminHref("audit")}>全部操作日志 <ArrowUpRight size={14} /></Link></div>
      <State query={audit} columns={4} empty={audit.data?.items.length === 0} />
      {audit.data && audit.data.items.length > 0 && <Table label="最近操作" columns={["时间", "管理员", "操作", "对象", "原因"]}>{audit.data.items.map(entry => <tr key={entry.id}>
        <td><DateText value={entry.createdAt} /></td><td>{entry.actorEmail}</td><td>{auditLabels[entry.action] ?? entry.action}</td><td><ShortId value={entry.targetId} /></td><td>{entry.reason}</td></tr>)}</Table>}</section>
  </>;
}
