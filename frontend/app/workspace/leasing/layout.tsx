import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/admin/WorkspaceShell";
export default function LeasingLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell portal="leasing">{children}</WorkspaceShell>;
}
