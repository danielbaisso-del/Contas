import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BalanceChart, CategoryChart, FlowChart, SeriesChart } from "@/components/Charts";
import { PageHeader } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { buildReport } from "@/finance/engine";
import { currentMonth, formatMonthLabel, shiftMonth } from "@/lib/dates";
import { formatBRL } from "@/lib/money";

export function ReportsPage() {
  const { data, today } = useFinance();
  const [params] = useSearchParams();
  const foco = (params.get("foco") ?? "").toLocaleLowerCase("pt-BR");
  const [from, setFrom] = useState(params.get("de") && /^\d{4}-\d{2}$/.test(params.get("de") ?? "") ? params.get("de")! : shiftMonth(currentMonth(today), -5));
  const [to, setTo] = useState(params.get("ate") && /^\d{4}-\d{2}$/.test(params.get("ate") ?? "") ? params.get("ate")! : currentMonth(today));
  useEffect(() => {
    const start = params.get("de");
    const end = params.get("ate");
    if (start && /^\d{4}-\d{2}$/.test(start)) setFrom(start);
    if (end && /^\d{4}-\d{2}$/.test(end)) setTo(end);
  }, [params]);
  const report = useMemo(() => buildReport(data, from, to, today), [data, from, to, today]);
  const period = `${formatMonthLabel(from)} até ${formatMonthLabel(to)}`;

  return (
    <div className="space-y-4">
      <PageHeader title="Relatórios" description="Cinco gráficos do seu dinheiro. O período já abre nos últimos 6 meses." />
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">De <input className="ml-2 rounded-xl border border-line bg-surface px-3 py-2" type="month" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="text-sm">Até <input className="ml-2 rounded-xl border border-line bg-surface px-3 py-2" type="month" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Despesas por categoria</h2>
        <p className="mb-4 mt-1 text-sm text-muted">{period}. Cada categoria lançada neste período vira uma fatia, com o valor.</p>
        <CategoryChart data={report.categories} />
        <NumberList rows={report.categories.map((item) => ({ name: item.name, value: formatBRL(item.totalCents), marked: foco !== "" && item.name.toLocaleLowerCase("pt-BR") === foco }))} empty="Nenhuma despesa paga neste período." />
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Receitas por mês</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Só o que já foi marcado como recebido.</p>
        <SeriesChart data={report.months} dataKey="incomeCents" color="var(--income)" caption="No mês mais recente entraram" />
        <NumberList rows={report.months.map((item) => ({ name: item.label, value: formatBRL(item.incomeCents) }))} empty="Nenhuma receita neste período." />
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Comparação entre receitas e despesas</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Verde é o que entrou. Vermelho é o que saiu no mesmo mês.</p>
        <FlowChart data={report.months} />
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Evolução do saldo</h2>
        <p className="mb-4 mt-1 text-sm text-muted">A linha contínua é o saldo já realizado. A tracejada é a projeção do mês.</p>
        <BalanceChart data={report.months} />
        <NumberList rows={report.months.map((item) => ({ name: item.label, value: formatBRL(item.balanceCents) }))} empty="Cadastre uma conta para o saldo aparecer." />
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Gastos dos últimos meses</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Despesas pagas e compras no cartão, mês a mês.</p>
        <SeriesChart data={report.months} dataKey="expenseCents" color="var(--expense)" caption="No mês mais recente saíram" />
        <NumberList rows={report.months.map((item) => ({ name: item.label, value: formatBRL(item.expenseCents) }))} empty="Nenhum gasto neste período." />
      </article>
    </div>
  );
}

function NumberList({ rows, empty }: { rows: Array<{ name: string; value: string; marked?: boolean }>; empty: string }) {
  return (
    <div className="mt-4 divide-y divide-line text-sm">
      {rows.length ? rows.map((row) => (
        <p key={`${row.name}-${row.value}`} className={`flex justify-between gap-3 rounded-xl px-2 py-2 ${row.marked ? "bg-accent text-white" : ""}`}>
          <span>{row.name}</span>
          <span className={`text-right font-semibold ${row.marked ? "text-white" : ""}`}>{row.value}</span>
        </p>
      )) : <p className="py-2 text-muted">{empty}</p>}
    </div>
  );
}
