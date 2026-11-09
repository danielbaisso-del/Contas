import { Cell, Pie, PieChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBRL } from "@/lib/money";

function axis(value: number) {
  const amount = value / 100;
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return amount.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)" };

export function FlowChart({ data }: { data: Array<{ label: string; incomeCents: number; expenseCents: number }> }) {
  if (!data.some((item) => item.incomeCents || item.expenseCents)) {
    return <p className="text-sm text-muted">O gráfico de receitas e despesas aparece quando houver movimentação no período.</p>;
  }
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={axis} tickLine={false} axisLine={false} width={56} />
          <Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "incomeCents" ? "Receitas" : "Despesas"]} contentStyle={tooltipStyle} />
          <Legend formatter={(value) => (value === "incomeCents" ? "Receitas recebidas" : "Despesas do mês")} />
          <Bar dataKey="incomeCents" fill="var(--income)" radius={[6, 6, 0, 0]} />
          <Bar dataKey="expenseCents" fill="var(--expense)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart({ data }: { data: Array<{ name: string; totalCents: number; color: string }> }) {
  if (!data.length) return <p className="text-sm text-muted">As despesas por categoria aparecem depois dos primeiros gastos pagos ou compras no cartão.</p>;
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="totalCents" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2}>
            {data.map((item) => <Cell key={item.name} fill={item.color} />)}
          </Pie>
          <Tooltip formatter={(value: number) => formatBRL(Number(value))} contentStyle={tooltipStyle} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalanceChart({ data }: { data: Array<{ label: string; balanceCents: number; projectedCents: number }> }) {
  return (
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
  );
}
