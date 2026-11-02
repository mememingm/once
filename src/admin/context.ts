import { useOutletContext } from "react-router-dom";
import type { ActionTarget } from "./actions";
import type { DetailTarget } from "./details";
import type { AdminQuery } from "./types";

/** What the admin layout hands each page: URL filters plus the shared drawer and dialog. */
export interface AdminPageContext {
  input: AdminQuery;
  update: (key: string, value: string) => void;
  openDetail: (target: DetailTarget) => void;
  openAction: (target: ActionTarget) => void;
}
export const useAdminPage = () => useOutletContext<AdminPageContext>();
