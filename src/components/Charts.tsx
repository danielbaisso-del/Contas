import { Cell, Pie, PieChart, Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBRL } from "@/lib/money";

function axis(value: number) {
  const amount = value / 100;
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return amount.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)" };
const palette = ["#3ecf8e", "#f07178", "#e6b450", "#7aa7ff", "#c084fc", "#fb923c", "#22d3ee", "#f472b6"];

function ColorPreview({ names }: { names: string[] }) {
  const slices = names.length ? names : ["Já recebi", "Já paguei", "Ainda vou pagar", "Categorias"];
  const radius = 42;
  const turn = 2 * Math.PI * radius;
  const slice = turn / slices.length;
  return (
    <div className="grid items-center gap-4 md:grid-cols-[220px_1fr]">
      <svg viewBox="0 0 120 120" className="chart-spin mx-auto h-56 w-56" aria-hidden="true">
        <circle cx="60" cy="60" r="28" fill="var(--surface)" />
        {slices.map((name, index) => (
          <circle key={name} cx="60" cy="60" r={radius} fill="none" stroke={palette[index % palette.length]} strokeWidth="18" strokeDasharray={`${slice - 4} ${turn}`} strokeDashoffset={-index * slice} strokeLinecap="butt" />
        ))}
      </svg>
      <div>
        <ul className="space-y-2">
          {slices.map((name, index) => (
            <li key={name} className="flex items-center gap-2 text-sm">
              <span className="h-3 w-3 rounded-full" style={{ background: palette[index % palette.length] }} />
              {name}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-5 text-muted">As cores se movem enquanto ainda não há valor. O seu número entra no lugar desta animação.</p>
      </div>
    </div>
  );
}

function BarPreview() {
  const months = [
    ["Mês 1", 55, 35],
    ["Mês 2", 70, 48],
    ["Mês 3", 46, 62],
    ["Mês 4", 80, 40],
  ];
  return (
    <div>
      <div className="flex h-56 items-end gap-3">
        {months.map(([label, income, expense], index) => (
          <div key={String(label)} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-48 w-full items-end justify-center gap-1">
              <div className="chart-bar w-3 rounded-t-md bg-income" style={{ height: `${income}%`, animationDelay: `${index * 0.15}s` }} />
              <div className="chart-bar w-3 rounded-t-md bg-expense" style={{ height: `${expense}%`, animationDelay: `${index * 0.15 + 0.2}s` }} />
            </div>
            <span className="text-xs text-muted">{label}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">Verde é o que entra e vermelho é o que sai. Esta forma é só visual até o primeiro lançamento.</p>
    </div>
  );
}

function LinePreview() {
  return (
    <div>
      <svg viewBox="0 0 320 140" className="h-56 w-full" aria-hidden="true">
        <path d="M10 100 C 50 90, 70 40, 110 60 S 170 120, 210 70 S 270 20, 310 48" fill="none" stroke="#7aa7ff" strokeWidth="4" strokeLinecap="round" className="chart-draw" />
        <path d="M10 110 C 60 100, 90 70, 140 84 S 200 130, 250 90 S 290 60, 310 72" fill="none" stroke="#e6b450" strokeWidth="4" strokeDasharray="8 8" strokeLinecap="round" />
      </svg>
      <p className="mt-3 text-xs leading-5 text-muted">A linha azul é o saldo já realizado e a amarela é a projeção. Elas passam a seguir os seus valores.</p>
    </div>
  );
}

function PieBlock({ data, emptyNames, keepZeros = false }: { data: Array<{ name: string; totalCents: number; color?: string }>; emptyNames: string[]; keepZeros?: boolean }) {
  const total = data.reduce((sum, item) => sum + item.totalCents, 0);
  if (!total) return <ColorPreview names={emptyNames.length ? emptyNames : data.map((item) => item.name)} />;
  const pie = data.filter((item) => item.totalCents > 0);
  const legend = keepZeros ? data : pie;
  return (
    <div className="grid items-center gap-4 md:grid-cols-[240px_1fr]">
      <div className="relative h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pie} dataKey="totalCents" nameKey="name" innerRadius={68} outerRadius={96} paddingAngle={3} stroke="transparent">
              {pie.map((item, index) => <Cell key={item.name} fill={item.color || palette[index % palette.length]} />)}
            </Pie>
            <Tooltip formatter={(value: number) => formatBRL(Number(value))} contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-xs text-muted">Total</p>
            <p className="text-base font-semibold tabular-nums">{formatBRL(total)}</p>
          </div>
        </div>
      </div>
      <ul className="space-y-2">
        {legend.map((item, index) => (
          <li key={item.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: item.color || palette[index % palette.length] }} />{item.name}</span>
            <span className="font-semibold tabular-nums">{formatBRL(item.totalCents)} · {total ? Math.round((item.totalCents / total) * 100) : 0}%</span>
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
        points.some((item) => item.totalCents > 0) ? (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} interval={0} />
              <YAxis stroke="var(--muted)" fontSize={11} tickFormatter={axis} tickLine={false} axisLine={false} width={52} />
              <Tooltip formatter={(value: number) => formatBRL(Number(value))} contentStyle={tooltipStyle} />
              <Bar dataKey="totalCents" radius={[6, 6, 0, 0]}>
                {points.map((item, index) => <Cell key={item.name} fill={palette[index % palette.length]} />)}
                <LabelList dataKey="totalCents" position="top" formatter={(value: number) => formatBRL(Number(value))} style={{ fill: "var(--ink)", fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        ) : <BarPreview />
      ) : <PieBlock data={points} emptyNames={points.map((item) => item.name)} />}
    </div>
  );
}

export function MonthPie({ receivedCents, spentCents, futureCents }: { receivedCents: number; spentCents: number; futureCents: number }) {
  const data = [
    { name: "Já recebi", totalCents: receivedCents },
    { name: "Já paguei", totalCents: spentCents },
    { name: "Ainda vou pagar", totalCents: futureCents },
  ];
  return <PieBlock data={data} emptyNames={["Já recebi", "Já paguei", "Ainda vou pagar"]} keepZeros />;
}

export function FlowChart({ data }: { data: Array<{ label: string; incomeCents: number; expenseCents: number }> }) {
  if (!data.length) return <BarPreview />;
  const latest = data[data.length - 1];
  const peak = Math.max(1, ...data.flatMap((item) => [item.incomeCents, item.expenseCents]));
  return (
    <div>
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={axis} tickLine={false} axisLine={false} width={56} domain={[0, peak]} />
          <Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "incomeCents" ? "Receitas" : "Despesas"]} contentStyle={tooltipStyle} />
          <Legend formatter={(value) => (value === "incomeCents" ? "Receitas recebidas" : "Despesas do mês")} />
          <Bar dataKey="incomeCents" fill="var(--income)" radius={[6, 6, 0, 0]} />
          <Bar dataKey="expenseCents" fill="var(--expense)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
      <p className="mt-3 text-sm">No mês mais recente, {latest?.label}: <strong className="text-income">{formatBRL(latest?.incomeCents ?? 0)}</strong> entraram e <strong className="text-expense">{formatBRL(latest?.expenseCents ?? 0)}</strong> saíram.</p>
      <div className="mt-2 divide-y divide-line text-sm">
        {data.map((item) => (
          <p key={item.label} className="flex justify-between gap-3 py-1.5"><span>{item.label}</span><span>{formatBRL(item.incomeCents)} entrou · {formatBRL(item.expenseCents)} saiu</span></p>
        ))}
      </div>
    </div>
  );
}

export function SeriesChart({ data, dataKey, color, caption }: { data: Array<{ label: string; incomeCents: number; expenseCents: number }>; dataKey: "incomeCents" | "expenseCents"; color: string; caption: string }) {
  const latest = data[data.length - 1];
  if (!data.length) return <BarPreview />;
  const peak = Math.max(1, ...data.map((item) => Number(item[dataKey])));
  return (
    <div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={axis} tickLine={false} axisLine={false} width={56} domain={[0, peak]} />
            <Tooltip formatter={(value: number) => formatBRL(Number(value))} contentStyle={tooltipStyle} />
            <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]}>
              <LabelList dataKey={dataKey} position="top" formatter={(value: number) => formatBRL(Number(value))} style={{ fill: "var(--ink)", fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-sm">{caption} <strong>{formatBRL(Number(latest?.[dataKey] ?? 0))}</strong>.</p>
    </div>
  );
}

export function CategoryChart({ data }: { data: Array<{ name: string; totalCents: number; color: string }> }) {
  const slices = data.filter((item) => item.totalCents > 0);
  if (!slices.length) return <p className="text-sm leading-6 text-muted">Nenhuma despesa neste período. Quando você lançar uma, a categoria entra nesta pizza com o valor.</p>;
  return <PieBlock data={slices.map((item) => ({ name: item.name, totalCents: item.totalCents, color: item.color }))} emptyNames={[]} />;
}

export function BalanceChart({ data }: { data: Array<{ label: string; balanceCents: number; projectedCents: number }> }) {
  if (!data.some((item) => item.balanceCents || item.projectedCents)) return <LinePreview />;
  const latest = data[data.length - 1];
  return (
    <div>
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={axis} tickLine={false} axisLine={false} width={56} />
          <Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "balanceCents" ? "Saldo realizado" : "Saldo projetado"]} contentStyle={tooltipStyle} />
          <Legend formatter={(value) => (value === "balanceCents" ? "Realizado" : "Projetado")} />
          <Line type="monotone" dataKey="balanceCents" stroke="var(--accent)" strokeWidth={2.4} dot={false} />
          <Line type="monotone" dataKey="projectedCents" stroke="var(--warning)" strokeWidth={2.4} strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
      <p className="mt-3 text-sm">Saldo realizado mais recente: <strong>{formatBRL(latest?.balanceCents ?? 0)}</strong>. Projeção: <strong>{formatBRL(latest?.projectedCents ?? 0)}</strong>.</p>
    </div>
  );
}
