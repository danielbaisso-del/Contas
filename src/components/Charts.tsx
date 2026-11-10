import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";

function axis(value: number) {
  const amount = value / 100;
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return amount.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)" };
const tick = { fill: "var(--muted)", fontSize: 12 };

function Key({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export type BridgeStep = { label: string; cents: number; kind: "total" | "in" | "out" | "forecast"; date?: string | null };

const bridgeColor: Record<BridgeStep["kind"], string> = {
  total: "var(--accent)",
  in: "var(--income)",
  out: "var(--expense)",
  forecast: "var(--warning)",
};

function cascadeSteps(steps: BridgeStep[]) {
  const plotted: BridgeStep[] = [];
  for (const step of steps) {
    if ((step.kind === "in" || step.kind === "out") && step.cents <= 0) continue;
    if (step.kind === "total" && step.cents === 0) continue;
    if (step.kind === "total" || step.kind === "forecast") {
      const previous = [...plotted].reverse().find((item) => item.kind === "total" || item.kind === "forecast");
      if (previous && previous.cents === step.cents) continue;
    }
    plotted.push(step);
  }
  return plotted;
}

function CascadeChart({ steps }: { steps: BridgeStep[] }) {
  const plotted = cascadeSteps(steps);
  let level = 0;
  const bars = plotted.map((step) => {
    if (step.kind === "total" || step.kind === "forecast") {
      level = step.cents;
      return { ...step, from: Math.min(0, step.cents), to: Math.max(0, step.cents), end: step.cents, caption: formatBRL(step.cents) };
    }
    const delta = step.kind === "out" ? -step.cents : step.cents;
    const end = level + delta;
    level = end;
    return { ...step, from: Math.min(end - delta, end), to: Math.max(end - delta, end), end, caption: `${delta > 0 ? "+" : "−"} ${formatBRL(Math.abs(delta))}` };
  });
  if (!bars.length) return null;
  const min = Math.min(0, ...bars.flatMap((bar) => [bar.from, bar.to]));
  const max = Math.max(1, ...bars.flatMap((bar) => [bar.from, bar.to]));
  const width = 640;
  const height = 268;
  const pad = { top: 28, right: 8, bottom: 48, left: 56 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const y = (value: number) => pad.top + ((max - value) / (max - min)) * plotHeight;
  const slot = plotWidth / bars.length;
  const barWidth = Math.min(48, slot * 0.42);
  const guides = [0, 0.5, 1].map((part) => min + (max - min) * part);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-64 w-full sm:h-72" role="img" aria-label="Cascata do saldo">
      {guides.map((guide) => (
        <g key={guide}>
          <line x1={pad.left} x2={width - pad.right} y1={y(guide)} y2={y(guide)} stroke="var(--line)" strokeDasharray="3 3" />
          <text x={pad.left - 8} y={y(guide) + 4} textAnchor="end" fill="var(--muted)" fontSize="12">{axis(guide)}</text>
        </g>
      ))}
      {bars.map((bar, index) => {
        const center = pad.left + slot * index + slot / 2;
        const top = y(bar.to);
        const barHeight = Math.max(bar.to === bar.from ? 2 : 0, y(bar.from) - y(bar.to));
        const previous = bars[index - 1];
        return (
          <g key={`${bar.kind}-${bar.label}`}>
            {previous ? <line x1={pad.left + slot * (index - 1) + slot / 2 + barWidth / 2} x2={center - barWidth / 2} y1={y(previous.end)} y2={y(previous.end)} stroke="var(--muted)" strokeDasharray="4 3" /> : null}
            <rect x={center - barWidth / 2} y={top} width={barWidth} height={barHeight} rx="6" fill={bridgeColor[bar.kind]} />
            <text x={center} y={Math.max(14, top - 8)} textAnchor="middle" fill="var(--ink)" fontSize="12" fontWeight="600">{bar.caption}</text>
            <text x={center} y={height - 24} textAnchor="middle" fill="var(--muted)" fontSize="12">{bar.label}</text>
            {bar.date ? <text x={center} y={height - 8} textAnchor="middle" fill="var(--muted)" fontSize="11">{formatDateBR(bar.date)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function BridgeChart({ steps }: { steps: BridgeStep[] }) {
  return (
    <div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {steps.map((step) => {
          const signed = step.kind === "in" ? `+ ${formatBRL(step.cents)}` : step.kind === "out" ? `− ${formatBRL(step.cents)}` : formatBRL(step.cents);
          return (
            <li key={`${step.kind}-${step.label}`} className="rounded-2xl border border-line bg-canvas px-3 py-3">
              <p className="truncate text-xs text-muted">{step.label}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums" style={{ color: bridgeColor[step.kind] }}>{signed}</p>
              {step.date ? <p className="mt-1 text-xs text-muted">{formatDateBR(step.date)}</p> : null}
            </li>
          );
        })}
      </ol>
      <CascadeChart steps={steps} />
    </div>
  );
}

const sliceColors = ["#1d4ed8", "#be123c", "#047857", "#b45309", "#7c3aed", "#0f766e", "#c2410c", "#0369a1"];

function sharePercents(rows: Array<{ totalCents: number }>) {
  const total = rows.reduce((sum, row) => sum + row.totalCents, 0);
  let used = 0;
  return rows.map((row, index) => {
    if (total <= 0) return 0;
    if (index === rows.length - 1) return 100 - used;
    const percent = Math.round((row.totalCents / total) * 100);
    used += percent;
    return percent;
  });
}

function SpendDonut({ rows, centerLabel, centerCents, centerDate, percentOf = "do total" }: { rows: Array<{ name: string; totalCents: number; color?: string; status?: string; date?: string | null }>; centerLabel: string; centerCents?: number; centerDate?: string | null; percentOf?: string }) {
  const visible = rows.filter((row) => row.totalCents > 0);
  const total = visible.reduce((sum, row) => sum + row.totalCents, 0);
  const shown = centerCents ?? total;
  const percents = sharePercents(visible);
  if (!visible.length) {
    return (
      <div>
        <div className="relative mx-auto grid h-56 w-full max-w-[16rem] place-items-center">
          <div className="h-40 w-40 rounded-full border-[18px] border-line" />
          <div className="absolute text-center">
            <p className="text-xs text-muted">{centerLabel}</p>
            <p className="text-lg font-semibold tabular-nums">{formatBRL(shown)}</p>
            {centerDate ? <p className="text-xs text-muted">{centerDate}</p> : null}
          </div>
        </div>
        <p className="text-center text-sm text-muted">Nenhum gasto neste período.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="relative mx-auto h-56 w-full max-w-[16rem]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={visible} dataKey="totalCents" nameKey="name" innerRadius={68} outerRadius={96} startAngle={90} endAngle={-270} paddingAngle={visible.length > 1 ? 2 : 0} stroke="var(--surface)" strokeWidth={visible.length > 1 ? 3 : 0}>
              {visible.map((row, index) => <Cell key={row.name} fill={row.color || sliceColors[index % sliceColors.length]} />)}
            </Pie>
            <Tooltip formatter={(value: number, _name: string, item: { payload?: { name?: string } }) => [formatBRL(Number(value)), item?.payload?.name ?? ""]} contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-xs text-muted">{centerLabel}</p>
            <p className="text-lg font-semibold tabular-nums">{formatBRL(shown)}</p>
            {centerDate ? <p className="text-xs text-muted">{centerDate}</p> : null}
          </div>
        </div>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {visible.map((row, index) => (
          <li key={`${row.status ?? ""}-${row.name}`} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color || sliceColors[index % sliceColors.length] }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{row.name}</span>
                {row.status || row.date ? <span className="block text-xs text-muted">{[row.status, row.date ? formatDateBR(row.date) : ""].filter(Boolean).join(" · ")}</span> : null}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums">{formatBRL(row.totalCents)}</span>
              <span className="block text-xs text-muted">{percents[index]}% {percentOf}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnswerChart({ title, kind = "bars", points }: { title: string; kind?: "pie" | "bars"; points: Array<{ name: string; totalCents: number }> }) {
  const rows = points.length ? points : [{ name: "Sem lançamento", totalCents: 0 }];
  return (
    <div className="mt-3">
      <p className="mb-3 text-sm font-medium text-ink">{title}</p>
      {kind === "pie" ? <SpendDonut rows={rows} centerLabel="Total" /> : <SpendBars rows={rows} />}
    </div>
  );
}

function SpendBars({ rows }: { rows: Array<{ name: string; totalCents: number }> }) {
  const peak = Math.max(1, ...rows.map((row) => row.totalCents));
  return (
    <ul className="space-y-3">
      {rows.map((row, index) => (
        <li key={row.name}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0">{row.name}</span>
            <span className="shrink-0 font-semibold tabular-nums">{formatBRL(row.totalCents)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
            <div className="h-2 rounded-full" style={{ width: `${Math.max(row.totalCents > 0 ? 4 : 0, Math.round((row.totalCents / peak) * 100))}%`, background: sliceColors[index % sliceColors.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MonthPie({ receivedCents, spentCents, futureCents }: { receivedCents: number; spentCents: number; futureCents: number }) {
  return <AnswerChart title="O mês" points={[{ name: "Já recebi", totalCents: receivedCents }, { name: "Já paguei", totalCents: spentCents }, { name: "Ainda vou pagar", totalCents: futureCents }]} />;
}

export function FlowChart({ data }: { data: Array<{ label: string; incomeCents: number; expenseCents: number }> }) {
  const rows = data.length ? data : [{ label: "—", incomeCents: 0, expenseCents: 0 }];
  const peak = Math.max(1, ...rows.flatMap((item) => [item.incomeCents, item.expenseCents]));
  return (
    <div>
      <Key items={[{ color: "var(--income)", label: "Entrou no mês" }, { color: "var(--expense)", label: "Comprometido no mês" }]} />
      <div className="h-64 min-w-0 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={4} barCategoryGap="22%">
            <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval={rows.length > 8 ? "preserveStartEnd" : 0} />
            <YAxis tick={tick} tickFormatter={axis} tickLine={false} axisLine={false} width={56} domain={[0, Math.round(peak * 1.12)]} />
            <Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "incomeCents" ? "Entrou" : "Comprometido"]} contentStyle={tooltipStyle} cursor={{ fill: "var(--line)", opacity: 0.35 }} />
            <Bar dataKey="incomeCents" fill="var(--income)" radius={[6, 6, 0, 0]} maxBarSize={22} />
            <Bar dataKey="expenseCents" fill="var(--expense)" radius={[6, 6, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function SeriesChart({ data, dataKey, color, caption }: { data: Array<{ label: string; incomeCents: number; expenseCents: number }>; dataKey: "incomeCents" | "expenseCents"; color: string; caption: string }) {
  const rows = data.length ? data : [{ label: "—", incomeCents: 0, expenseCents: 0 }];
  const latest = rows[rows.length - 1];
  const peak = Math.max(1, ...rows.map((item) => Number(item[dataKey])));
  return (
    <div>
      <div className="h-64 min-w-0 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 22, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval={rows.length > 8 ? "preserveStartEnd" : 0} />
            <YAxis tick={tick} tickFormatter={axis} tickLine={false} axisLine={false} width={56} domain={[0, Math.round(peak * 1.18)]} />
            <Tooltip formatter={(value: number) => [formatBRL(Number(value)), dataKey === "incomeCents" ? "Entrou" : "Comprometido"]} contentStyle={tooltipStyle} cursor={{ fill: "var(--line)", opacity: 0.35 }} />
            <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} maxBarSize={28}>
              <LabelList dataKey={dataKey} position="top" formatter={(value: number) => (Number(value) > 0 ? formatBRL(Number(value)) : "")} style={{ fill: "var(--ink)", fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-sm text-muted">{caption} <strong className="text-ink">{formatBRL(Number(latest?.[dataKey] ?? 0))}</strong>.</p>
    </div>
  );
}

export function CategoryChart({ receivedCents, receivedOn, slices }: { receivedCents: number; receivedOn?: string | null; slices: Array<{ name: string; totalCents: number; color?: string; status?: string; date?: string | null }> }) {
  const gastos = slices.filter((item) => item.totalCents > 0);
  const spent = gastos.reduce((sum, item) => sum + item.totalCents, 0);
  const left = Math.max(0, receivedCents - spent);
  const insideIncome = receivedCents > 0 && spent <= receivedCents;
  const rows = insideIncome
    ? [...gastos, ...(left > 0 ? [{ name: "Sobrou", totalCents: left, color: "#047857", status: "Do que entrou", date: null }] : [])]
    : gastos;
  return <SpendDonut rows={rows} centerLabel="Recebi" centerCents={receivedCents} centerDate={receivedOn} percentOf={insideIncome ? "do que entrou" : "dos gastos"} />;
}

export function BalanceChart({ data }: { data: Array<{ label: string; balanceCents: number; projectedCents: number; incomeCents?: number; expenseCents?: number }> }) {
  const rows = data.length ? data : [{ label: "—", balanceCents: 0, projectedCents: 0 }];
  const latest = rows[rows.length - 1];
  const values = rows.flatMap((row) => [row.balanceCents, row.projectedCents]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.45, Math.abs(high) * 0.08, 1);
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line px-3 py-3">
          <p className="text-xs text-muted">Realizado</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-accent">{formatBRL(latest?.balanceCents ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-line px-3 py-3">
          <p className="text-xs text-muted">Projetado</p>
          <p className="mt-1 text-lg font-semibold tabular-nums" style={{ color: "var(--warning)" }}>{formatBRL(latest?.projectedCents ?? 0)}</p>
        </div>
      </div>
      <Key items={[{ color: "var(--accent)", label: "Já aconteceu" }, { color: "var(--warning)", label: "Projeção" }]} />
      <div className="h-64 min-w-0 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval={rows.length > 8 ? "preserveStartEnd" : 0} />
            <YAxis tick={tick} tickFormatter={axis} tickLine={false} axisLine={false} width={56} domain={[low - pad, high + pad]} />
            <Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "balanceCents" ? "Realizado" : "Projetado"]} contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="projectedCents" stroke="var(--warning)" fill="var(--warning)" fillOpacity={0.12} strokeDasharray="5 5" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="balanceCents" stroke="var(--accent)" strokeWidth={2.6} dot={{ r: 3.5, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
