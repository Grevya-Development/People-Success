"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { Info, Table2 } from "lucide-react";
import { cn } from "cn";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

/**
 * Dashboard charts. Specs follow the data-viz guidance used across the app:
 * thin marks (bars ≤ 24px, 4px rounded data-ends, 2px lines), recessive
 * hairline grid, one y-axis, legend only for ≥ 2 series, sparing direct
 * labels, text in text tokens, a hover tooltip and a table view on every chart.
 * Colours come from the validated --chart-* tokens (categorical order:
 * green, orange, blue, amber); single-series magnitude uses --chart-seq.
 */

const compact = (v: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short" });
};

type Row = Record<string, string | number>;

/** Named, serializable formats (functions cannot cross the server → client boundary). */
export type ValueFormat = "number" | "inr";
const inrCompact = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(paise / 100);
const formatValue = (f: ValueFormat | undefined, v: number | string) => (f === "inr" ? inrCompact(Number(v)) : typeof v === "number" ? v.toLocaleString("en-IN") : String(v ?? ""));

export function ChartCard({
  title,
  description,
  definition,
  columns,
  rows,
  children,
  className,
}: {
  title: string;
  description?: string;
  definition?: string;
  columns: { key: string; label: string; format?: ValueFormat }[];
  rows: Row[];
  children: React.ReactNode;
  className?: string;
}) {
  const [table, setTable] = useState(false);
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      <header className="flex items-start justify-between gap-2 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            {title}
            {definition ? (
              <Tooltip>
                <TooltipTrigger className="text-muted-foreground" aria-label={`Definition: ${title}`}>
                  <Info className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-72">{definition}</TooltipContent>
              </Tooltip>
            ) : null}
          </h3>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <Button variant="ghost" size="xs" onClick={() => setTable((t) => !t)} aria-pressed={table} className="text-muted-foreground">
          <Table2 /> {table ? "Chart" : "Table"}
        </Button>
      </header>
      <div className="px-3 pt-2 pb-4">
        {rows.length === 0 ? (
          <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No data for this period.</p>
        ) : table ? (
          <div className="max-h-[260px] overflow-auto px-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  {columns.map((c) => (
                    <th key={c.key} className={cn("py-1.5 font-medium", c.key !== columns[0].key && "text-right")}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    {columns.map((c) => (
                      <td key={c.key} className={cn("py-1.5", c.key !== columns[0].key && "text-right tabular")}>
                        {formatValue(c.format, r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

const axisProps = { tickLine: false, axisLine: false, tick: { fill: "var(--muted-foreground)", fontSize: 11 } } as const;

/** Single-series trend: 10% area wash + 2px line, end value labelled. */
export function TrendArea({ data, valueKey, label }: { data: Row[]; valueKey: string; label: string }) {
  const config = { [valueKey]: { label, color: "var(--chart-seq)" } } satisfies ChartConfig;
  const last = data.length - 1;
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <AreaChart data={data} margin={{ top: 18, right: 28, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} minTickGap={12} />
        <YAxis {...axisProps} width={36} allowDecimals={false} tickFormatter={compact} />
        <ChartTooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent labelFormatter={(v) => monthLabel(String(v))} />} />
        <Area
          dataKey={valueKey}
          type="monotone"
          stroke={`var(--color-${valueKey})`}
          strokeWidth={2}
          fill={`var(--color-${valueKey})`}
          fillOpacity={0.1}
          dot={(p: { cx?: number; cy?: number; index?: number }) =>
            p.index === last && p.cx != null && p.cy != null ? (
              <circle key="end" cx={p.cx} cy={p.cy} r={4} fill={`var(--color-${valueKey})`} stroke="var(--card)" strokeWidth={2} />
            ) : (
              <g key={`d${p.index}`} />
            )
          }
          activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey={valueKey}
            content={(props) => {
              const p = props as { x?: number | string; y?: number | string; value?: number | string; index?: number };
              return p.index === last ? (
                <text x={Number(p.x) + 8} y={Number(p.y) - 8} fill="var(--foreground)" fontSize={11} fontWeight={600}>
                  {String(p.value)}
                </text>
              ) : null;
            }}
          />
        </Area>
      </AreaChart>
    </ChartContainer>
  );
}

/** Two-series grouped columns with legend (e.g. hires vs exits). */
export function GroupedColumns({ data, series }: { data: Row[]; series: { key: string; label: string; color: string }[] }) {
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} minTickGap={8} />
        <YAxis {...axisProps} width={32} allowDecimals={false} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent labelFormatter={(v) => monthLabel(String(v))} />} />
        <ChartLegend
          content={<ChartLegendContent />}
          verticalAlign="top"
          align="right"
          // Keep the declared series order (Recharts sorts by name by default).
          itemSorter={(item) => series.findIndex((s) => s.key === (item as { dataKey?: unknown }).dataKey)}
        />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** Single-series vertical columns (e.g. payroll cost by month). */
export function Columns({ data, valueKey, label, valueFormat = "number" }: { data: Row[]; valueKey: string; label: string; valueFormat?: ValueFormat }) {
  const format = (v: number) => formatValue(valueFormat, v);
  const config = { [valueKey]: { label, color: "var(--chart-seq)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
        <YAxis {...axisProps} width={44} tickFormatter={(v: number) => format(v)} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent formatter={(v) => format(Number(v))} labelFormatter={(v) => monthLabel(String(v))} />} />
        <Bar dataKey={valueKey} fill={`var(--color-${valueKey})`} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

/** Single-series horizontal bars with the value at the tip (distribution, funnel). */
export function HorizontalBars({ data, categoryKey, valueKey, label }: { data: Row[]; categoryKey: string; valueKey: string; label: string }) {
  const config = { [valueKey]: { label, color: "var(--chart-seq)" } } satisfies ChartConfig;
  const height = Math.max(160, data.length * 30 + 16);
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 4 }} barCategoryGap={6}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey={categoryKey} {...axisProps} width={120} tick={{ fill: "var(--foreground)", fontSize: 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent hideLabel={false} />} />
        <Bar dataKey={valueKey} fill={`var(--color-${valueKey})`} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
          <LabelList dataKey={valueKey} position="right" fill="var(--foreground)" fontSize={11} formatter={(v: unknown) => compact(Number(v))} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
