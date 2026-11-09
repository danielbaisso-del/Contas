import { Cell, Pie, PieChart, Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBRL } from "@/lib/money";

function axis(value: number) {
  const amount = value / 100;
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return amount.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)" };
const palette = ["#3ecf8e", "#f07178", "#e6b450", "#7aa7ff", "#c084fc", "#fb923c", "#22d3ee", "#f472b6"];

function shareLabel(partCents: number, incomeCents: number): string {
  if (incomeCents <= 0) return "sem ganhos para comparar";
  return `${Math.round((partCents / incomeCents) * 100)}% dos ganhos`;
}

function PieBlock({ data, keepZeros = false, baseCents, centerLabel = "Total", centerCents }: { data: Array<{ name: string; totalCents: number; color?: string }>; emptyNames?: string[]; keepZeros?: boolean; baseCents?: number; centerLabel?: string; centerCents?: number }) {
  const total = data.reduce((sum, item) => sum + item.totalCents, 0);
  const real = data.filter((item) => item.totalCents > 0);
  const pie = real.length ? real : [{ name: data[0]?.name || "Ganhos do mês", totalCents: 1, color: "#3ecf8e" }];
  const legend = real.length ? (keepZeros ? data : real) : data.length ? data : [{ name: pie[0].name, totalCents: 0, color: pie[0].color }];
  const base = baseCents ?? total;
  const shown = centerCents ?? total;
  return (
    <div className="grid items-center gap-4 md:grid-cols-[240px_1fr]">
      <div className="relative h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pie} dataKey="totalCents" nameKey="name" innerRadius={68} outerRadius={96} paddingAngle={pie.length > 1 ? 3 : 0} stroke="transparent">
              {pie.map((item, index) => <Cell key={item.name} fill={item.color || palette[index % palette.length]} />)}
            </Pie>
            <Tooltip formatter={(value: number) => formatBRL(real.length ? Number(value) : 0)} contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-xs text-muted">{centerLabel}</p>
            <p className="text-base font-semibold tabular-nums">{formatBRL(shown)}</p>
          </div>
        </div>
      </div>
      <ul className="space-y-2">
        {legend.map((item, index) => (
          <li key={item.name} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="flex min-w-0 items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: item.color || palette[index % palette.length] }} />{item.name}</span>
            <span className="font-semibold tabular-nums sm:text-right">{formatBRL(item.totalCents)}{base > 0 ? ` · ${Math.round((item.totalCents / base) * 100)}%` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnswerChart({ title, kind, points }: { title: string; kind: "pie" | "bars"; points: Array<{ name: string; totalCents: number }> }) {
  return (
    <div className="mt-3">
      <p className="mb-2 text-sm font-medium text-ink">{title}</p>
      {kind === "bars" ? (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points.length ? points : [{ name: "—", totalCents: 0 }]}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} interval={0} />
              <YAxis stroke="var(--muted)" fontSize={11} tickFormatter={axis} tickLine={false} axisLine={false} width={52} domain={[0, Math.max(1, ...points.map((item) => item.totalCents))]} />
              <Tooltip formatter={(value: number) => formatBRL(Number(value))} contentStyle={tooltipStyle} />
              <Bar dataKey="totalCents" radius={[6, 6, 0, 0]} minPointSize={8}>
                {(points.length ? points : [{ name: "—", totalCents: 0 }]).map((item, index) => <Cell key={item.name} fill={palette[index % palette.length]} />)}
                <LabelList dataKey="totalCents" position="top" formatter={(value: number) => formatBRL(Number(value))} style={{ fill: "var(--ink)", fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <PieBlock data={points.length ? points : [{ name: "Sem despesas", totalCents: 0 }]} />}
    </div>
  );
}

export function MonthPie({ receivedCents, spentCents, futureCents }: { receivedCents: number; spentCents: number; futureCents: number }) {
  const data = [
    { name: "Já recebi", totalCents: receivedCents },
    { name: "Já paguei", totalCents: spentCents },
    { name: "Ainda vou pagar", totalCents: futureCents },
  ];
  return <PieBlock data={data} keepZeros />;
}

export function FlowChart({ data }: { data: Array<{ label: string; incomeCents: number; expenseCents: number }> }) {
  const rows = data.length ? data : [{ label: "—", incomeCents: 0, expenseCents: 0 }];
  const latest = rows[rows.length - 1];
  const peak = Math.max(1, ...rows.flatMap((item) => [item.incomeCents, item.expenseCents]));
  return (
    <div>
    <div className="h-64 min-w-0 sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis stroke="var(--muted)" fontSize={10} tickFormatter={axis} tickLine={false} axisLine={false} width={40} domain={[0, peak]} />
          <Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "incomeCents" ? "Ganhos do mês" : "Gastos"]} contentStyle={tooltipStyle} />
          <Legend formatter={(value) => (value === "incomeCents" ? "Ganhos do mês" : "Gastos")} />
          <Bar dataKey="incomeCents" fill="var(--income)" radius={[6, 6, 0, 0]} />
          <Bar dataKey="expenseCents" fill="var(--expense)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
      <p className="mt-3 text-sm">No mês mais recente, {latest?.label}: <strong className="text-income">{formatBRL(latest?.incomeCents ?? 0)}</strong> entraram e <strong className="text-expense">{formatBRL(latest?.expenseCents ?? 0)}</strong> saíram ({shareLabel(latest?.expenseCents ?? 0, latest?.incomeCents ?? 0)}).</p>
      <div className="mt-2 divide-y divide-line text-sm">
        {rows.map((item) => (
          <p key={item.label} className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:justify-between sm:gap-3"><span>{item.label}</span><span>{formatBRL(item.incomeCents)} entrou · {formatBRL(item.expenseCents)} saiu · {shareLabel(item.expenseCents, item.incomeCents)}</span></p>
        ))}
      </div>
    </div>
  );
}

export function SeriesChart({ data, dataKey, color, caption }: { data: Array<{ label: string; incomeCents: number; expenseCents: number }>; dataKey: "incomeCents" | "expenseCents"; color: string; caption: string }) {
  const rows = data.length ? data : [{ label: "—", incomeCents: 0, expenseCents: 0 }];
  const latest = rows[rows.length - 1];
  const peak = Math.max(1, ...rows.flatMap((item) => [Number(item[dataKey]), dataKey === "expenseCents" ? item.incomeCents : 0]));
  return (
    <div>
      <div className="h-64 min-w-0 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis stroke="var(--muted)" fontSize={10} tickFormatter={axis} tickLine={false} axisLine={false} width={40} domain={[0, peak]} />
            <Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "incomeCents" ? "Ganhos do mês" : "Valor"]} contentStyle={tooltipStyle} />
            {dataKey === "expenseCents" ? <Bar dataKey="incomeCents" fill="var(--income)" radius={[6, 6, 0, 0]} /> : null}
            <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]}>
              <LabelList dataKey={dataKey} position="top" formatter={(value: number) => formatBRL(Number(value))} style={{ fill: "var(--ink)", fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-sm">{caption} <strong>{formatBRL(Number(latest?.[dataKey] ?? 0))}</strong>{dataKey === "expenseCents" ? `, ${shareLabel(Number(latest?.expenseCents ?? 0), Number(latest?.incomeCents ?? 0))}.` : ". Este valor é o total de ganhos do mês, a medida dos gastos."}</p>
    </div>
  );
}

export function CategoryChart({ data, incomeCents = 0 }: { data: Array<{ name: string; totalCents: number; color: string }>; incomeCents?: number }) {
  const slices = data.filter((item) => item.totalCents > 0);
  const spent = slices.reduce((sum, item) => sum + item.totalCents, 0);
  const left = Math.max(0, incomeCents - spent);
  const compared = incomeCents > 0
    ? [...slices, { name: "Sobrou dos ganhos", totalCents: left, color: "#3ecf8e" }]
    : slices.length
      ? slices
      : [{ name: "Ganhos do mês", totalCents: 0, color: "#3ecf8e" }, { name: "Gastos do mês", totalCents: 0, color: "#f07178" }];
  return <PieBlock data={compared} baseCents={incomeCents > 0 ? incomeCents : undefined} centerLabel="Ganhos" centerCents={incomeCents} keepZeros={incomeCents <= 0 && slices.length === 0} />;
}

export function BalanceChart({ data }: { data: Array<{ label: string; balanceCents: number; projectedCents: number; incomeCents?: number; expenseCents?: number }> }) {
  const rows = data.length ? data : [{ label: "—", balanceCents: 0, projectedCents: 0 }];
  const latest = rows[rows.length - 1];
  return (
    <div>
    <div className="h-64 min-w-0 sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis stroke="var(--muted)" fontSize={10} tickFormatter={axis} tickLine={false} axisLine={false} width={40} />
          <Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "balanceCents" ? "Saldo realizado" : "Saldo projetado"]} contentStyle={tooltipStyle} />
          <Legend formatter={(value) => (value === "balanceCents" ? "Realizado" : "Projetado")} />
          <Line type="monotone" dataKey="balanceCents" stroke="var(--accent)" strokeWidth={2.4} dot={{ r: 3, fill: "var(--accent)" }} />
          <Line type="monotone" dataKey="projectedCents" stroke="var(--warning)" strokeWidth={2.4} strokeDasharray="5 5" dot={{ r: 3, fill: "var(--warning)" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
      <p className="mt-3 text-sm">Saldo realizado mais recente: <strong>{formatBRL(latest?.balanceCents ?? 0)}</strong>. Projeção: <strong>{formatBRL(latest?.projectedCents ?? 0)}</strong>. Gastos frente aos ganhos: {shareLabel(latest?.expenseCents ?? 0, latest?.incomeCents ?? 0)}.</p>
    </div>
  );
}
