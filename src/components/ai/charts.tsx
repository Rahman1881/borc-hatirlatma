"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { weeklySales, fuelMix } from "@/lib/ai-mock";

const axisStyle = { fontSize: 11, fill: "var(--muted-foreground)" };

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}:{" "}
          <span className="font-medium text-foreground">{p.value}K ₺</span>
        </p>
      ))}
    </div>
  );
}

export function WeeklyAreaChart() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={weeklySales} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="g-motorin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="g-benzin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="g-market" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="gun" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
        <Tooltip content={<TooltipBox />} />
        <Area type="monotone" dataKey="motorin" name="Motorin" stroke="#2563eb" strokeWidth={2} fill="url(#g-motorin)" />
        <Area type="monotone" dataKey="benzin" name="Benzin" stroke="#f97316" strokeWidth={2} fill="url(#g-benzin)" />
        <Area type="monotone" dataKey="market" name="Market" stroke="#16a34a" strokeWidth={2} fill="url(#g-market)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function FuelMixChart() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={fuelMix}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={95}
          paddingAngle={3}
          stroke="none"
        >
          {fuelMix.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="circle"
          formatter={(v) => (
            <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{v}</span>
          )}
        />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-xl">
                <span className="font-medium text-foreground">
                  {payload[0].name}: %{payload[0].value}
                </span>
              </div>
            ) : null
          }
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
