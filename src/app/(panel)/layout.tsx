import type { ReactNode } from "react";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireAuth();
  return <>{children}</>;
}
