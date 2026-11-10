import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BalanceChart, CategoryChart, FlowChart, SeriesChart } from "@/components/Charts";
import { Button, MoneyField, PageHeader, Select } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { buildReport, inflowDates, openingIncome } from "@/finance/engine";
import { currentMonth, formatDateBR, monthRange, shiftMonth } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { errorMessage } from "@/lib/utils";
import { saveTransaction } from "@/services/data";
import type { Transaction } from "@/types/models";

interface Preview {
  id: string;
  description: string;
  amountCents: number;
  type: "income" | "expense";
  occurredOn: string;
  accountId: string;
}

function previewTransaction(item: Preview, today: string): Transaction {
  const future = item.occurredOn > today;
  return {
    id: item.id,
    description: item.description,
    amountCents: item.amountCents,
    type: item.type,
    categoryId: null,
    accountId: item.accountId,
    destinationAccountId: null,
    creditCardId: null,
    occurredOn: item.occurredOn,
    dueOn: item.occurredOn,
    status: item.type === "income" ? (future ? "planned" : "received") : (future ? "planned" : "paid"),
    paymentMethod: null,
    notes: null,
    recurrenceId: null,
    installmentGroupId: null,
    installmentNumber: null,
    installmentTotal: null,
    invoiceId: null,
    purchasedOn: null,
    externalId: null,
    createdAt: "",
  };
}

export function ReportsPage() {
  const { data, today, refresh } = useFinance();
  const toast = useToast();
  const [params] = useSearchParams();
  const [from, setFrom] = useState(params.get("de") && /^\d{4}-\d{2}$/.test(params.get("de") ?? "") ? params.get("de")! : shiftMonth(currentMonth(today), -5));
  const [to, setTo] = useState(params.get("ate") && /^\d{4}-\d{2}$/.test(params.get("ate") ?? "") ? params.get("ate")! : currentMonth(today));
  const [drafts, setDrafts] = useState<Preview[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [occurredOn, setOccurredOn] = useState(today);
  const [accountId, setAccountId] = useState("");
  const accounts = [...data.accounts.filter((account) => !account.archived), ...data.accounts.filter((account) => account.archived)];
  useEffect(() => {
    const start = params.get("de");
    const end = params.get("ate");
    if (start && /^\d{4}-\d{2}$/.test(start)) setFrom(start);
    if (end && /^\d{4}-\d{2}$/.test(end)) setTo(end);
  }, [params]);
  const previewData = useMemo(() => ({
    ...data,
    transactions: [...data.transactions, ...drafts.map((item) => previewTransaction(item, today))],
  }), [data, drafts, today]);
  const periodStart = from <= to ? from : to;
  const periodEnd = from <= to ? to : from;
  const report = useMemo(() => buildReport(previewData, periodStart, periodEnd, today), [previewData, periodStart, periodEnd, today]);
  const months = report.months;
  const receivedCents = useMemo(() => {
    const start = monthRange(periodStart).start;
    const end = monthRange(periodEnd).end;
    const received = previewData.transactions.reduce((sum, item) => item.type === "income" && item.status === "received" && item.occurredOn >= start && item.occurredOn <= end ? sum + item.amountCents : sum, 0);
    return received + openingIncome(previewData.accounts, start, end, today);
  }, [previewData, periodStart, periodEnd, today]);
  const receivedOn = useMemo(() => {
    const start = monthRange(periodStart).start;
    const end = monthRange(periodEnd).end;
    return inflowDates(previewData, start, end, today).map((date) => formatDateBR(date)).join(" · ");
  }, [previewData, periodStart, periodEnd, today]);

  function addPreview() {
    const month = occurredOn.slice(0, 7);
    const start = from <= to ? from : to;
    const end = from <= to ? to : from;
    if (!description.trim() || description.trim().length < 2) return toast("Diga o nome desse valor.", "error");
    if (!amount || amount <= 0) return toast("Informe um valor maior que zero.", "error");
    if (month < start || month > end) return toast("A data precisa estar dentro do período escolhido.", "error");
    const account = accountId || accounts[0]?.id || "";
    if (!account) return toast("Cadastre uma conta antes de simular.", "error");
    setDrafts((current) => [...current, { id: crypto.randomUUID(), description: description.trim(), amountCents: amount, type: kind, occurredOn, accountId: account }]);
    setDescription("");
    setAmount(null);
    toast("Valor só nesta simulação. Os gráficos mudam agora. Salvar grava de verdade.");
  }

  async function saveDrafts() {
    try {
      for (const item of drafts) {
        const row = previewTransaction(item, today);
        await saveTransaction({
          description: row.description,
          amountCents: row.amountCents,
          type: row.type,
          occurredOn: row.occurredOn,
          dueOn: row.dueOn,
          status: row.status,
          accountId: row.accountId,
        });
      }
      setDrafts([]);
      await refresh();
      toast("Valores salvos. Eles entram no saldo e nos gráficos.");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Relatórios" description="Escolha o período. Os gráficos usam o que já entrou, o que ainda vai entrar, o que já saiu e o que ainda vai sair nesse intervalo." />
      <div className="grid gap-3 sm:flex">
        <label className="grid gap-1 text-sm">De <input className="w-full rounded-xl border border-line bg-surface px-3 py-2 sm:w-auto" type="month" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Até <input className="w-full rounded-xl border border-line bg-surface px-3 py-2 sm:w-auto" type="month" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Simular neste período</h2>
        <p className="mt-1 text-sm text-muted">O valor aparece nos gráficos sem gravar. Salvar é que lança de verdade na conta.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">Nome <input className="rounded-xl border border-line bg-surface px-3 py-2" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Salário, mercado, aluguel" /></label>
          <MoneyField label="Valor" value={amount} onChange={setAmount} />
          <label className="grid gap-1 text-sm">Tipo
            <Select value={kind} onChange={(event) => setKind(event.target.value === "income" ? "income" : "expense")}>
              <option value="income">Entrada</option>
              <option value="expense">Saída</option>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">Data <input className="rounded-xl border border-line bg-surface px-3 py-2" type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
          <label className="grid gap-1 text-sm md:col-span-2">Conta
            <Select value={accountId || accounts[0]?.id || ""} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.archived ? " (arquivada)" : ""}</option>)}
            </Select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={addPreview}>Ver no gráfico</Button>
          <Button type="button" variant="secondary" disabled={!drafts.length} onClick={() => void saveDrafts()}>Salvar estes valores</Button>
          <Button type="button" variant="ghost" disabled={!drafts.length} onClick={() => setDrafts([])}>Limpar simulação</Button>
        </div>
        {drafts.length ? <ul className="mt-4 space-y-1 text-sm">{drafts.map((item) => <li key={item.id}>{item.type === "income" ? "Entrada" : "Saída"} · {item.description} · {formatBRL(item.amountCents)} · {formatDateBR(item.occurredOn)}</li>)}</ul> : null}
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">O que entrou e os gastos</h2>
        <p className="mb-4 mt-1 text-sm text-muted">O centro é o que entrou no período selecionado. Cada fatia é um gasto. O que sobra do que entrou aparece como Sobrou.</p>
        <CategoryChart receivedCents={receivedCents} receivedOn={receivedOn} slices={report.categories} />
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Receitas por mês</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Inclui o que já entrou e o que ainda vai entrar em cada mês do período.</p>
        <SeriesChart data={months} dataKey="incomeCents" color="var(--income)" caption="No mês mais recente entraram" />
        <NumberList rows={months.map((item) => ({ name: item.label, value: formatBRL(item.incomeCents) }))} empty="Nenhuma receita neste período." />
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Comparação entre receitas e despesas</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Verde é o que entra no mês. Vermelho é o que o mês compromete: pago, pendente, parcela e cartão.</p>
        <FlowChart data={months} />
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Evolução do saldo</h2>
        <p className="mb-4 mt-1 text-sm text-muted">A linha contínua é o saldo já realizado. A tracejada é a projeção do mês.</p>
        <BalanceChart data={months} />
        <NumberList rows={months.map((item) => ({ name: item.label, value: formatBRL(item.balanceCents) }))} empty="Cadastre uma conta para o saldo aparecer." />
      </article>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Gastos dos últimos meses</h2>
        <p className="mb-4 mt-1 text-sm text-muted">Junta o pago, o pendente, as parcelas e as compras no cartão de cada mês.</p>
        <SeriesChart data={months} dataKey="expenseCents" color="var(--expense)" caption="No mês mais recente saíram" />
        <NumberList rows={months.map((item) => ({ name: item.label, value: formatBRL(item.expenseCents) }))} empty="Nenhum gasto neste período." />
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
