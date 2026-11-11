"use client";

import type { ReactNode } from "react";
import { CarkProvider } from "./store";
import { CarkGate } from "./gate";
import CarkMobilSidebar from "./sidebar";

// Çark Mobil modülünün kabuğu: oturum + canlı veri sağlayıcısı, yan menü ve giriş kapısı.
export default function CarkMobilShell({ children }: { children: ReactNode }) {
  return (
    <CarkProvider>
      <div className="flex h-screen">
        <CarkMobilSidebar />
        <main className="flex-1 overflow-auto bg-muted/30">
          <div className="p-6">
            <CarkGate>{children}</CarkGate>
          </div>
        </main>
      </div>
    </CarkProvider>
  );
}
