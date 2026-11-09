import { useMemo, useState } from "react";
import { FlowChart } from "@/components/Charts";
import { Button, MoneyText, PageHeader } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { buildReport } from "@/finance/engine";
import { currentMonth, formatMonthLabel, shiftMonth } from "@/lib/dates";
import { downloadText } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { typeLabel } from "@/lib/labels";

export function ReportsPage() {
  const { data, today } = useFinance();
  const [from, setFrom] = useState(shiftMonth(currentMonth(today), -5));
  const [to, setTo] = useState(currentMonth(today));
  const report = useMemo(() => buildReport(data, from, to, today), [data, from, to, today]);

  function exportCsv() {
    const start = `${from}-01`;
    const end = `${to}-31`;
    const rows = [["Data", "Descrição", "Tipo", "Valor", "Status"], ...data.transactions.filter((item) => item.occurredOn >= start && item.occurredOn <= end).map((item) => [item.occurredOn, item.description, typeLabel(item.type), (item.amountCents / 100).toFixed(2).replace(".", ","), item.status])];
    const content = `\uFEFF${rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(";")).join("\n")}`;
    downloadText(`contas-${from}-a-${to}.csv`, content);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Relatórios" description="Compare meses, categorias, cartões e contas. A exportação usa ponto e vírgula para abrir corretamente no Excel brasileiro." action={<Button onClick={exportCsv}>Exportar CSV</Button>} />
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">De <input className="ml-2 rounded-xl border border-line bg-surface px-3 py-2" type="month" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="text-sm">Até <input className="ml-2 rounded-xl border border-line bg-surface px-3 py-2" type="month" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <article className="rounded-3xl border border-line bg-surface p-5"><h2 className="mb-4 font-semibold">Receitas e despesas por mês</h2><FlowChart data={report.months} /></article>
      <section className="grid gap-4 lg:grid-cols-2">
        <ReportTable title="Despesas por categoria" rows={report.categories.map((item) => [item.name, formatBRL(item.totalCents)])} />
        <ReportTable title="Gastos por cartão" rows={report.cards.map((item) => [item.name, formatBRL(item.totalCents)])} />
        <ReportTable title="Movimento por conta" rows={report.accounts.map((item) => [`${item.name} · saldo ${formatBRL(item.balanceCents)}`, `entrou ${formatBRL(item.incomeCents)} · saiu ${formatBRL(item.expenseCents)}`])} />
        <article className="rounded-3xl border border-line bg-surface p-5 text-sm leading-6">
          <h2 className="font-semibold">Compromissos</h2>
          <p className="mt-3">Despesas recorrentes no período: <MoneyText cents={report.recurringCents} tone="expense" />.</p>
          <p>Compromissos futuros ainda em aberto: <MoneyText cents={report.futureCommitmentsCents} tone="expense" />.</p>
          <p className="mt-3 text-xs text-muted">Nas contas, a coluna de saída inclui pagamento de fatura porque o dinheiro realmente saiu. A compra do cartão continua em gastos por cartão.</p>
          <p className="text-xs text-muted">Período de {formatMonthLabel(from)} até {formatMonthLabel(to)}.</p>
        </article>
      </section>
    </div>
  );
}

function ReportTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <article className="rounded-3xl border border-line bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-sm">{rows.length ? rows.map((row) => <p key={row.join()} className="flex justify-between gap-3"><span>{row[0]}</span><span className="text-right text-muted">{row[1]}</span></p>) : <p className="text-muted">Sem dados no período.</p>}</div>
    </article>
  );
}
