import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-card p-5 text-card-foreground ring-1 ring-foreground/10",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {action}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "warning" | "primary";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    positive: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    negative: "bg-red-500/12 text-red-600 dark:text-red-400",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    primary: "bg-primary/12 text-primary",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}
