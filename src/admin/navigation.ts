import {
  ClipboardList, KeyRound, LayoutDashboard, MessageSquareText, ScrollText, Smartphone, Users, Webhook,
  type LucideIcon,
} from "lucide-react";

export const adminPages = ["overview", "users", "numbers", "leases", "orders", "messages", "webhooks", "audit"] as const;
export type AdminPage = (typeof adminPages)[number];
export const adminTitles: Record<AdminPage, string> = {
  overview: "管理概览", users: "用户管理", numbers: "号码库存", leases: "租约管理",
  orders: "订单管理", messages: "短信记录", webhooks: "Webhook 事件", audit: "操作日志",
};
/** One plain-language line under each page title, written for operators rather than engineers. */
export const adminDescriptions: Record<AdminPage, string> = {
  overview: "今天的经营情况，以及需要你处理的事情。",
  users: "查看注册用户和他们的号码、订单；必要时重置密码或禁用账号。",
  numbers: "号码池里的全部号码。可以手动分配给用户，或暂停 / 恢复售卖。",
  leases: "用户租用号码的记录。可以给租约延期补偿，或提前回收号码。",
  orders: "租赁、续费和管理员手动开通产生的订单。",
  messages: "所有号码收到和发出的短信，用来排查用户反馈的收发问题。",
  webhooks: "上游 PingCode 推送的短信事件，以及没能处理成功的记录。",
  audit: "管理员做过的每一次修改：谁、什么时候、为什么。",
};
export const adminIcons: Record<AdminPage, LucideIcon> = {
  overview: LayoutDashboard, users: Users, numbers: Smartphone, leases: KeyRound, orders: ClipboardList,
  messages: MessageSquareText, webhooks: Webhook, audit: ScrollText,
};
export const adminNavGroups: { label: string; pages: AdminPage[] }[] = [
  { label: "日常运营", pages: ["overview", "users", "leases", "orders"] },
  { label: "号码与通信", pages: ["numbers", "messages"] },
  { label: "技术与审计", pages: ["webhooks", "audit"] },
];
export function adminHref(page: AdminPage, filters: Record<string, string> = {}) {
  const query = new URLSearchParams(filters).toString();
  return `/admin/${page}${query ? `?${query}` : ""}`;
}
export const auditLabels: Record<string, string> = {
  ADMIN_BOOTSTRAP: "授予管理员权限",
  USER_STATUS: "修改用户状态", USER_PASSWORD_RESET: "重置用户密码", NUMBER_ASSIGN: "手动分配号码",
  NUMBER_HOLD: "暂停 / 恢复号码", LEASE_END: "回收租约", LEASE_EXTEND: "租约延期", WEBHOOK_RETRY: "重新处理事件",
};
