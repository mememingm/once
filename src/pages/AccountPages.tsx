import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/ui/field";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApp } from "../app/AppProvider";
import { useWorkspace } from "../app/WorkspaceProvider";
import { useUIStore } from "../stores/ui-store";
import {
  formatDate,
  formatMoney,
  leasePath,
  localDemo,
} from "../lib/models";
import {
  CommunicationNav,
  Heading,
  Icon,
} from "../components/ui";
import { PasswordSettings } from "../components/PasswordSettings";
export { SubscriptionPage } from "./SubscriptionPage";
export function BillingPage() {
  const { data, busy, reconcile } = useWorkspace();
  const [params] = useSearchParams();
  const scope = params.get("leaseId");
  const lease = data!.leases.find((item) => item.id === scope),
    bills = data!.bills.filter((bill) => !scope || bill.leaseId === scope);
  const recordsViewport = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(6);
  const [pagination, setPagination] = useState({ scope, index: 0 });
  const pageCount = Math.max(1, Math.ceil(bills.length / pageSize));
  const pageIndex = pagination.scope === scope ? Math.min(pagination.index, pageCount - 1) : 0;
  const pageStart = pageIndex * pageSize;
  useLayoutEffect(() => {
    const node = recordsViewport.current;
    if (!node) return;
    const resize = () => {
      const desktop = window.matchMedia("(min-width:768px) and (min-height:680px)").matches;
      const headerHeight = node.querySelector("thead")?.getBoundingClientRect().height || 40;
      const rowHeight = Math.max(72, ...Array.from(node.querySelectorAll("tbody tr"), row => row.getBoundingClientRect().height));
      // Use rendered row sizes so fonts and status controls cannot push the pager off screen.
      setPageSize(desktop ? Math.max(1, Math.min(12, Math.floor((node.clientHeight - headerHeight - 2) / rowHeight))) : 5);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <main className="content billing-content">
      <Heading title="订单与账单" />
      <div className="billing-toolbar">
        <strong>{lease?.number || "全部号码"}</strong>
        {scope && (
          <Button asChild variant="outline"><Link className="secondary-btn" to="/app/billing">
            查看全部订单
          </Link></Button>
        )}
        <span>
          {scope
            ? `${bills.length} 笔已载入记录`
            : `${data!.billsCount} 笔账户订单`}
        </span>
      </div>
      <div className="billing-records" ref={recordsViewport}>
      {bills.length ? (
        <div className="billing-surface"><Table aria-label="订单与账单">
          <TableHeader><TableRow><TableHead>订单与租期</TableHead><TableHead>关联号码</TableHead><TableHead>时间 / 金额</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
          <TableBody>{bills.slice(pageStart, pageStart + pageSize).map(bill => {
            const label = bill.status === "演示已确认" ? "已确认" : ({PENDING:"待交付",PROCESSING:"处理中",UNCERTAIN:"结果待核对",FAILED:"交付失败"} as Record<string,string>)[bill.status] || bill.status;
            return <TableRow key={bill.id}>
              <TableCell><Sheet><SheetTrigger asChild><Button variant="link" className="order-link" aria-label={`查看订单 ${bill.id}`}><strong>{bill.kind} · {bill.term} 天</strong></Button></SheetTrigger>
                <SheetContent className="order-sheet"><SheetHeader><SheetTitle>订单详情</SheetTitle><SheetDescription>{bill.kind} · {label}</SheetDescription></SheetHeader>
                  <dl><div><dt>订单编号</dt><dd>{bill.id}</dd></div><div><dt>关联号码</dt><dd>{bill.leaseId ? <Button asChild variant="link"><Link to={leasePath("numbers",bill.leaseId)}>{bill.number}</Link></Button> : bill.number || "暂未分配"}</dd></div><div><dt>租期</dt><dd>{bill.term} 天</dd></div><div><dt>创建日期</dt><dd>{formatDate(bill.createdAt)}</dd></div><div><dt>金额</dt><dd>{formatMoney(bill.amount,bill.currency)}</dd></div><div><dt>状态</dt><dd><Badge variant="outline">{label}</Badge></dd></div></dl>
                </SheetContent></Sheet><small title={bill.id}>{bill.id.slice(0, 8)}</small></TableCell>
              <TableCell>{bill.leaseId ? <Button asChild variant="link"><Link to={leasePath("numbers",bill.leaseId)}>{bill.number}</Link></Button> : bill.number || "暂未分配"}</TableCell>
              <TableCell><strong>{formatMoney(bill.amount,bill.currency)}</strong><small>{formatDate(bill.createdAt)}</small></TableCell>
              <TableCell><Badge variant="outline" className={`bill-status-badge ${bill.status === "FAILED" ? "danger" : ""}`}>{label}</Badge>
                {!localDemo() && data!.demo && ["PENDING","PROCESSING","UNCERTAIN"].includes(bill.status) && <Button variant="link" className="link-btn" disabled={busy} onClick={() => {void reconcile(bill.id);}}>核对交付</Button>}
              </TableCell>
            </TableRow>;
          })}</TableBody>
        </Table></div>
      ) : (
        <Empty className="empty-state compact"><h2>暂无订单记录</h2><p>租用号码后，可在这里查看订购与续费记录。</p><Button asChild><Link to="/numbers/new">去租用号码</Link></Button></Empty>
      )}
      </div>
      {bills.length > 0 && <nav className="billing-pagination" aria-label="订单分页">
        <span role="status" aria-live="polite">第 {bills.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageSize, bills.length)} 条，共 {bills.length} 条已载入订单</span>
        <div>
          <Button variant="outline" size="sm" aria-label="上一页订单" disabled={pageIndex === 0} onClick={() => setPagination({ scope, index: pageIndex - 1 })}><ChevronLeft aria-hidden="true" />上一页</Button>
          <span aria-label={`第 ${pageIndex + 1} 页，共 ${pageCount} 页`}>{pageIndex + 1} / {pageCount}</span>
          <Button variant="outline" size="sm" aria-label="下一页订单" disabled={pageIndex >= pageCount - 1} onClick={() => setPagination({ scope, index: pageIndex + 1 })}>下一页<ChevronRight aria-hidden="true" /></Button>
        </div>
      </nav>}
      {data!.truncated.bills && (
        <p className="card-muted">
          仅展示最近 200 笔账户订单，不代表完整历史。
        </p>
      )}
    </main>
  );
}
export function SettingsPage() {
  const { account, logout } = useApp();
  const [loggingOut, setLoggingOut] = useState(false);
  const theme = useUIStore((state) => state.theme);
  const toggleTheme = useUIStore((state) => state.toggleTheme);
  const { setScenesOpen } = useWorkspace();
  return (
    <main className="content">
      <Heading title="账户设置" />
      <section className="settings-section">
        <h2>账户信息</h2>
        <Field><Label htmlFor="account-email">邮箱</Label><Input id="account-email" value={account!.email} readOnly autoComplete="email" /></Field>
      </section>
      <section className="settings-section">
        <h2>显示偏好</h2>
        <Button variant="outline" className="secondary-btn" onClick={toggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
          {theme === "dark" ? "切换浅色" : "切换深色"}
        </Button>
      </section>
      <section className="settings-section">
        <h2>账户安全</h2>
        <PasswordSettings />
      </section>
      <section className="settings-section">
        <h2>账户操作</h2>
        <Button variant="outline" disabled={loggingOut} onClick={() => { setLoggingOut(true); void logout().finally(() => setLoggingOut(false)); }}>{loggingOut ? "正在退出…" : "退出账户"}</Button>
      </section>
      {localDemo() && (
        <section className="settings-section">
          <h2>场景设置</h2>
          <Button variant="outline" className="secondary-btn" onClick={() => setScenesOpen(true)}>
            切换或重置场景
          </Button>
        </section>
      )}
    </main>
  );
}
export function VoicePage() {
  const { data } = useWorkspace();
  const lease = data?.lease;
  const keys = [
    ["1", ""],
    ["2", "ABC"],
    ["3", "DEF"],
    ["4", "GHI"],
    ["5", "JKL"],
    ["6", "MNO"],
    ["7", "PQRS"],
    ["8", "TUV"],
    ["9", "WXYZ"],
    ["*", ""],
    ["0", "+"],
    ["#", ""],
  ];
  return (
    <main className="content voice-content">
      <header className="voice-heading">
        <h1>语音通话</h1>
        <Badge variant="outline">功能开发中</Badge>
      </header>
      <CommunicationNav value="voice" leaseId={lease?.id} />
      <div className="voice-layout">
        <section
          className="voice-preview"
          aria-labelledby="voice-preview-title"
        >
          <div className="voice-preview-top">
            <span>
              <Icon name="phone" />
              拨号盘
            </span>
            <span>未开放</span>
          </div>
          <h2 id="voice-preview-title" className="visually-hidden">
            不可交互的语音拨号盘
          </h2>
          <div className="voice-source">
            {lease?.number || "尚未选择号码"}
          </div>
          <div className="voice-number-placeholder">输入电话号码</div>
          <div className="voice-dialpad" aria-hidden="true">
            {keys.map(([key, letters]) => (
              <span key={key}>
                <strong>{key}</strong>
                <small>{letters || "\u00a0"}</small>
              </span>
            ))}
          </div>
          <Button variant="ghost"
            className="voice-call-button"
            disabled
            aria-label="语音通话未开放，无法拨打"
          >
            <Icon name="phone" />
          </Button>
        </section>
        <section
          className="voice-roadmap"
          aria-labelledby="voice-roadmap-title"
        >
          <h2 id="voice-roadmap-title">语音功能</h2>
          <div className="voice-features">
            {[
              ["phone", "拨打与接听"],
              ["receipt-text", "通话记录"],
              ["message-square-text", "语音信箱"],
            ].map(([symbol, title]) => (
              <article key={title}>
                <span className="overview-feature-icon">
                  <Icon name={symbol} />
                </span>
                <div>
                  <h3>{title}</h3>
                </div>
                <span className="voice-feature-state">尚未开放</span>
              </article>
            ))}
          </div>
          <div className="voice-availability">
            <span className="overview-feature-icon">
              <Icon name="clock-3" />
            </span>
            <div>
              <h3>敬请期待</h3>
              <Button asChild variant="link"><Link className="link-btn" to={leasePath("inbox", lease?.id)}>
                先查看接收的短信
                <Icon name="arrow-right" />
              </Link></Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
