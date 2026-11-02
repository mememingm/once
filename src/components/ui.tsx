import { Button } from "@/components/ui/button";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Copy, Plus, RefreshCw, Smartphone, MessageSquareText, Phone, ReceiptText, ShieldQuestion, CircleHelp, Clock3, Image, Moon, Sun, TriangleAlert, Search, type LucideIcon } from "lucide-react";
import { Badge } from "./ui/badge";
import { Empty } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { Combobox } from "./ui/combobox";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { motion, useReducedMotion } from "motion/react";
import { useApp } from "../app/AppProvider";
import { useWorkspace } from "../app/WorkspaceProvider";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  leaseModel,
  leasePath,
  sortedLeases,
  type Lease,
  type Message,
  type Order,
} from "../lib/models";
const icons: Record<string, LucideIcon> = { "arrow-right": ArrowRight, copy: Copy, plus: Plus, "refresh-cw": RefreshCw, smartphone: Smartphone, "message-square-text": MessageSquareText, phone: Phone, "receipt-text": ReceiptText, "shield-question": ShieldQuestion, "circle-help": CircleHelp, i: CircleHelp, "clock-3": Clock3, image: Image, moon: Moon, sun: Sun, "triangle-alert": TriangleAlert, search: Search };
export function Icon({ name }: { name: string }) {
  const Symbol = icons[name] || CircleHelp;
  return <Symbol className="ui-icon" size={18} strokeWidth={1.75} aria-hidden="true" />;
}
export function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link className="brand" to={to}>
      <span className="brand-mark">O</span>
      <span>ONCE</span>
    </Link>
  );
}
export function RentNumberAction() {
  return <Button asChild variant="default"><Link className="primary-btn" to="/numbers/new"><Icon name="plus" />租用新号码</Link></Button>;
}
export function Heading({
  title,
  action = false,
}: {
  title: string;
  action?: boolean;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
      </div>
      {action && <RentNumberAction />}
    </div>
  );
}
export function LeaseBadge({ lease }: { lease: Lease }) {
  const model = leaseModel(lease);
  return <Badge variant="outline" className={`status-tag ${model.status}`}>{model.label}</Badge>;
}
export function EmptyNumbers() {
  return (
    <Empty className="empty-state asset-empty">
      <div className="empty-mark">
        <Icon name="smartphone" />
      </div>
      <h2>暂无号码</h2>
      <Button asChild variant="default"><Link className="primary-btn" to="/numbers/new">
        <Icon name="plus" />
        租用第一个号码
      </Link></Button>
    </Empty>
  );
}
export function DataState({
  title,
  description,
  retry,
}: {
  title: string;
  description: string;
  retry?: () => void;
}) {
  return (
    <div className="data-state">
      <div className="data-state-mark">
        <Icon name="refresh-cw" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {retry && (
        <Button variant="outline" className="secondary-btn" onClick={retry}>
          <Icon name="refresh-cw" />
          重试
        </Button>
      )}
    </div>
  );
}
export function WorkspaceBoundary({ children }: { children: ReactNode }) {
  const { data, error, refresh } = useWorkspace();
  if (!data)
    return (
      <main className="content">
        {error ? (
          <DataState
            title="暂时无法读取数据"
            description={error}
            retry={() => {
              void refresh();
            }}
          />
        ) : (
          <>
            <Skeleton className="skeleton skeleton-title" />
            <Skeleton
              className="skeleton skeleton-panel"
              role="status"
              aria-label="正在加载账户数据"
            />
          </>
        )}
      </main>
    );
  return <>{children}</>;
}
export function SelectionGuard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { switching, error, requestedId, data, refresh } = useWorkspace();
  const reduce = useReducedMotion();
  return (
    <div
      className={`react-selection ${className}`}
      aria-busy={switching}
      style={{ position: "relative", minWidth: 0 }}
    >
      <motion.div
        inert={switching}
        animate={{ opacity: switching ? 0.3 : 1 }}
        transition={{ duration: reduce ? 0 : 0.16 }}
      >
        {children}
      </motion.div>
      {switching && (
        <section className="context-state" role={error ? "alert" : "status"}>
          <span className="context-number">
            {data?.leases.find((lease) => lease.id === requestedId)?.number ||
              "所选号码"}
          </span>
          <h2>{error ? "号码详情读取失败" : "正在读取号码详情"}</h2>
          <p>{error || "正在同步该号码的租期和消息…"}</p>
          {error ? (
            <Button variant="outline"
              className="secondary-btn"
              onClick={() => {
                void refresh();
              }}
            >
              重新读取
            </Button>
          ) : (
            <div className="context-skeleton" aria-hidden="true">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
export function CopyButton({
  value,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const { notify } = useApp();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement("textarea");
        input.value = value;
        input.readOnly = true;
        input.style.cssText = "position:fixed;opacity:0";
        document.body.append(input);
        input.select();
        try {
          if (!document.execCommand("copy")) throw new Error("Copy failed");
        } finally {
          input.remove();
        }
      }
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 380);
      notify("已复制选中内容。");
    } catch {
      setCopied(false);
      notify("浏览器未允许复制，请手动选择。", "error");
    }
  };
  return (
    <Button variant="ghost"
      {...props}
      data-action="copy"
      className={`${props.className || "icon-btn"}${copied ? " copy-confirmed" : ""}`}
      aria-label={copied ? "已复制" : props["aria-label"]}
      onClick={() => {
        void copy();
      }}
    >
      <Icon name="copy" />
      {children}
    </Button>
  );
}
export function LeaseSwitcher() {
  const { data, selectLease, busy, requestedId } = useWorkspace();
  if (!data?.lease) return null;
  if (data.leases.length <= 1) return <strong>{data.lease.number}</strong>;
  return <Combobox label="号码" value={requestedId || data.lease.id} disabled={busy}
    onValueChange={selectLease} options={sortedLeases(data.leases).map(lease => ({
      value: lease.id, label: lease.number, description: `${lease.countryName} · ${lease.regionName} · ${leaseModel(lease).label}`,
    }))} />;
}
export function FilterTabs({ value, onValueChange, options, label, className = "" }: {
  value: string; onValueChange: (value: string) => void; options: { value: string; label: ReactNode }[]; label: string; className?: string;
}) {
  return <Tabs value={value} onValueChange={onValueChange} className={className}>
    <TabsList aria-label={label}>{options.map(option => <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>)}</TabsList>
  </Tabs>;
}
export function LeaseCountdown({ lease }: { lease: Lease }) {
  const model = leaseModel(lease),
    remaining = model.progress === null ? null : 100 - model.progress,
    reduce = useReducedMotion();
  return (
    <div className="overview-countdown">
      <div
        className={`overview-ring ${model.status}`}
        data-lease-ring={lease.id}
        data-ring-value={remaining ?? undefined}
      >
        {remaining !== null && (
          <svg viewBox="0 0 180 180" aria-hidden="true">
            <circle className="ring-track" cx="90" cy="90" r="78" />
            {remaining > 0 && (
              <motion.circle
                className="ring-value"
                cx="90"
                cy="90"
                r="78"
                pathLength="100"
                initial={false}
                animate={{ strokeDasharray: `${remaining} 100` }}
                transition={{ duration: reduce ? 0 : 0.45 }}
              />
            )}
          </svg>
        )}
        <div>
          <span>剩余租期</span>
          <strong>{model.remaining ?? "未知"}</strong>
          <small>
            {model.remaining === null
              ? "租期待确认"
              : model.status === "expired"
                ? "已到期"
                : "天"}
          </small>
        </div>
      </div>
      <p>
        到期日期{" "}
        <time dateTime={lease.expiresAt}>{formatDate(lease.expiresAt)}</time>
      </p>
    </div>
  );
}
export function Usage() {
  return (
    <section className="overview-usage" aria-labelledby="overview-usage-title">
      <div className="overview-section-head">
        <h2 id="overview-usage-title">套餐使用情况</h2>
      </div>
      <div className="overview-usage-grid">
        {[
          ["smartphone", "流量", "DATA"],
          ["message-square-text", "发短信", "SMS"],
          ["phone", "语音分钟", "VOICE"],
        ].map(([symbol, title, label]) => (
          <div className="overview-meter" key={label}>
            <div className="overview-meter-label">
              <span className="overview-feature-icon">
                <Icon name={symbol} />
              </span>
              <span>
                {title}
                <small>{label}</small>
              </span>
            </div>
            <strong>暂未提供</strong>
            <div className="overview-meter-unavailable" aria-hidden="true" />
          </div>
        ))}
      </div>
    </section>
  );
}
export function MessageRow({ message }: { message: Message }) {
  const { selectedId } = useWorkspace();
  return (
    <Link
      className="message-card"
      to={leasePath("inbox", message.leaseId || selectedId, {
        messageId: message.id,
      })}
    >
      <div className="message-card-main">
        <div className="message-card-meta">
          <span>{message.sender}</span>
          <time>{formatDateTime(message.receivedAt)}</time>
          {message.isRead === false && <b className="unread-label">未读</b>}
        </div>
        <strong>{message.title}</strong>
        <p>{message.body}</p>
      </div>
      <Icon name="arrow-right" />
    </Link>
  );
}
export function OrderSummary({ order }: { order: Order }) {
  return (
    <Link className="order-summary" to={leasePath("billing", order.leaseId)}>
      <span>
        <strong>
          {order.kind} · {order.term} 天
        </strong>
        <small>
          {order.number} · {formatDate(order.createdAt)}
        </small>
      </span>
      <span>
        {formatMoney(order.amount, order.currency)}
        <small>
          {order.status === "演示已确认" ? "已确认" : order.status}
        </small>
      </span>
    </Link>
  );
}
export function CommunicationNav({ value, leaseId }: { value: "inbox" | "sms" | "mms" | "voice"; leaseId?: string }) {
  const navigate = useNavigate();
  return <FilterTabs className="communication-nav" label="通信功能" value={value === "inbox" ? "sms" : value} onValueChange={next => navigate(leasePath(next === "sms" ? "messages" : next === "mms" ? "send" : next, leaseId, next === "mms" ? { compose: "mms" } : undefined))} options={[{value: "sms", label: "短信"}, {value: "mms", label: "彩信"}, {value: "voice", label: "语音"}]} />;
}
export function Footer() {
  return (
    <footer className="section ux-footer">
      <div className="container">
        <span>ONCE</span>
        <span>彩信与语音暂未开放。</span>
      </div>
    </footer>
  );
}
