"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Yakıt Ofisi listelerinin ortak tablosu: arama, açılır filtreler, onay kutusu filtreleri,
// başlığa tıklayarak sıralama ve satıra tıklayınca müşteri penceresi.

type SortValue = number | string | null | undefined;

export type Column<T> = {
  key: string;
  label: string;
  align?: "right";
  sort?: (r: T) => SortValue;
  render: (r: T) => ReactNode;
  className?: string;
};

export type SelectFilter<T> = { key: string; label: string; value: (r: T) => string | null | undefined };
export type ToggleFilter<T> = { key: string; label: string; test: (r: T) => boolean };
// Birden çok değer seçilebilen filtre (ör. filo grubu); satırın değerlerinden biri seçiliyse geçer.
export type MultiFilter<T> = { key: string; label: string; values: (r: T) => string[] };

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: [string, number][];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const text = selected.length === 0 ? "Tümü" : selected.length === 1 ? selected[0] : `${selected.length} grup seçili`;

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 max-w-64 items-center gap-2 rounded-lg border bg-background px-2 text-sm outline-none focus:border-primary",
          selected.length > 0 && "border-primary",
        )}
      >
        <span className="truncate">{text}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border bg-background p-1 shadow-lg">
          {options.map(([v, n]) => (
            <label key={v} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} />
              <span className="flex-1">{v}</span>
              <span className="text-xs text-muted-foreground">{n}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
              Seçimi temizle
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const STEP = 100;
const tr = (s: string) => s.toLocaleLowerCase("tr");

function compare(a: SortValue, b: SortValue) {
  const an = a == null || a === "";
  const bn = b == null || b === "";
  if (an || bn) return an && bn ? 0 : an ? 1 : -1; // boşlar her zaman sonda
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "tr");
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = "Ara",
  filters = [],
  multiFilters = [],
  toggles = [],
  defaultSort,
  onRowClick,
  summary,
  emptyText = "Kayıt yok.",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string | number;
  searchText?: (r: T) => (string | null | undefined)[];
  searchPlaceholder?: string;
  filters?: SelectFilter<T>[];
  multiFilters?: MultiFilter<T>[];
  toggles?: ToggleFilter<T>[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  onRowClick?: (r: T) => void;
  summary?: (rows: T[]) => ReactNode;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [multi, setMulti] = useState<Record<string, string[]>>({});
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState(defaultSort ?? null);
  const [limit, setLimit] = useState(STEP);

  const options = useMemo(
    () =>
      Object.fromEntries(
        filters.map((f) => {
          const counts = new Map<string, number>();
          for (const r of rows) {
            const v = f.value(r) || "—";
            counts.set(v, (counts.get(v) ?? 0) + 1);
          }
          return [f.key, [...counts.entries()].sort((a, b) => b[1] - a[1])];
        }),
      ),
    [rows, filters],
  );

  const multiOptions = useMemo(
    () =>
      Object.fromEntries(
        multiFilters.map((f) => {
          const counts = new Map<string, number>();
          for (const r of rows) for (const v of f.values(r)) counts.set(v, (counts.get(v) ?? 0) + 1);
          return [f.key, [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr", { numeric: true }))];
        }),
      ),
    [rows, multiFilters],
  );

  const visible = useMemo(() => {
    const term = tr(q.trim());
    let list = rows.filter((r) => {
      if (term && searchText && !searchText(r).some((v) => v && tr(String(v)).includes(term))) return false;
      for (const f of filters) {
        const want = selected[f.key];
        if (want && (f.value(r) || "—") !== want) return false;
      }
      for (const f of multiFilters) {
        const want = multi[f.key];
        if (want?.length && !f.values(r).some((v) => want.includes(v))) return false;
      }
      for (const t of toggles) if (toggled[t.key] && !t.test(r)) return false;
      return true;
    });
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.sort) {
      const get = col.sort;
      const dir = sort?.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        if (va == null || va === "" || vb == null || vb === "") return compare(va, vb);
        return compare(va, vb) * dir;
      });
    }
    return list;
  }, [rows, q, searchText, filters, selected, multiFilters, multi, toggles, toggled, sort, columns]);

  const clickSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  };

  const anyFilter =
    q ||
    Object.values(selected).some(Boolean) ||
    Object.values(multi).some((v) => v.length > 0) ||
    Object.values(toggled).some(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {searchText && (
          <Input
            placeholder={searchPlaceholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(STEP);
            }}
            className="w-72"
          />
        )}
        {filters.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{f.label}</span>
            <select
              value={selected[f.key] ?? ""}
              onChange={(e) => {
                setSelected((s) => ({ ...s, [f.key]: e.target.value }));
                setLimit(STEP);
              }}
              className="h-8 max-w-56 rounded-lg border bg-background px-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Tümü</option>
              {(options[f.key] ?? []).map(([v, n]) => (
                <option key={v} value={v}>
                  {v} ({n})
                </option>
              ))}
            </select>
          </label>
        ))}
        {multiFilters.map((f) =>
          (multiOptions[f.key] ?? []).length > 0 ? (
            <MultiSelect
              key={f.key}
              label={f.label}
              options={multiOptions[f.key]}
              selected={multi[f.key] ?? []}
              onChange={(v) => {
                setMulti((m) => ({ ...m, [f.key]: v }));
                setLimit(STEP);
              }}
            />
          ) : null,
        )}
        {toggles.map((t) => (
          <label key={t.key} className="flex h-8 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(toggled[t.key])}
              onChange={(e) => {
                setToggled((s) => ({ ...s, [t.key]: e.target.checked }));
                setLimit(STEP);
              }}
            />
            {t.label}
          </label>
        ))}
        {anyFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setSelected({});
              setMulti({});
              setToggled({});
            }}
          >
            Filtreleri temizle
          </Button>
        )}
        <div className="ml-auto text-sm text-muted-foreground">
          {summary ? summary(visible) : `${visible.length} kayıt`}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <TableHead key={c.key} className={cn(c.align === "right" && "text-right")}>
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => clickSort(c.key)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-foreground",
                        active && "text-foreground",
                        c.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {c.label}
                      <Icon className={cn("h-3.5 w-3.5", !active && "opacity-40")} />
                    </button>
                  ) : (
                    c.label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.slice(0, limit).map((r) => (
            <TableRow
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn(onRowClick && "cursor-pointer")}
            >
              {columns.map((c) => (
                <TableCell key={c.key} className={cn(c.align === "right" && "text-right", c.className)}>
                  {c.render(r)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                {anyFilter ? "Filtreye uyan kayıt yok." : emptyText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {visible.length > limit && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((l) => l + STEP)}>
            Daha fazla göster ({visible.length - limit} kaldı)
          </Button>
        </div>
      )}
    </div>
  );
}
