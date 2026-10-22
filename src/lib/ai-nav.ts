import {
  LayoutDashboard,
  MessageSquareText,
  Target,
  FileBarChart,
  Settings,
  Fuel,
  BarChart3,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export type AiNavItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const aiNavItems: AiNavItem[] = [
  {
    href: "/ai",
    label: "Gösterge Paneli",
    description: "Günlük satış, ciro ve uyarılar",
    icon: LayoutDashboard,
  },
  {
    href: "/ai/sohbet",
    label: "AI Asistan",
    description: "İşletmene doğal dilde soru sor",
    icon: MessageSquareText,
  },
  {
    href: "/ai/musteri-bulucu",
    label: "Müşteri Bulucu",
    description: "Bölge ve ihale bazlı potansiyel müşteri",
    icon: Target,
  },
  {
    href: "/ai/rekabet-analizi",
    label: "Rekabet Analizi",
    description: "Çevredeki istasyon fiyatları ve kıyas",
    icon: Fuel,
  },
  {
    href: "/ai/zam-tahmini",
    label: "Zam Tahmini",
    description: "Akdeniz fiyatına göre zam/indirim uyarısı",
    icon: TrendingUp,
  },
  {
    href: "/ai/satis-raporu",
    label: "Satış Raporu",
    description: "Vardiya bazlı pompa satışları",
    icon: BarChart3,
  },
  {
    href: "/ai/raporlar",
    label: "Raporlar & Telegram",
    description: "Otomatik günlük raporlar",
    icon: FileBarChart,
  },
  {
    href: "/ai/ayarlar",
    label: "Ayarlar",
    description: "Entegrasyonlar ve bağlantılar",
    icon: Settings,
  },
];
