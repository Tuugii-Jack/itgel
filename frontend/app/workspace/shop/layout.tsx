import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/admin/WorkspaceShell";
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell portal="shop">{children}</WorkspaceShell>;
}
