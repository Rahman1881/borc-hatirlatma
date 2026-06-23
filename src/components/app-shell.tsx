"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/sidebar";
import UttsSidebar from "@/components/utts-sidebar";
import AiSidebar from "@/components/ai/ai-sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/") {
    return (
      <main className="min-h-screen overflow-auto bg-muted/30">
        <div className="p-6">{children}</div>
      </main>
    );
  }

  const isUttsPanel = pathname.startsWith("/utts");
  const isAiPanel = pathname.startsWith("/ai");

  return (
    <div className="flex h-screen">
      {isAiPanel ? <AiSidebar /> : isUttsPanel ? <UttsSidebar /> : <Sidebar />}
      <main className="flex-1 overflow-auto bg-muted/30">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
