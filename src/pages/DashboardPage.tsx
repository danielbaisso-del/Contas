import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BalanceChart, BridgeChart, CategoryChart, FlowChart, type BridgeStep } from "@/components/Charts";
import { MoneyText } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import type { FinanceData } from "@/types/models";
import { appendInstallmentMonths, balanceParts, buildDashboard, categoryMovement, inflowDates, invoiceTotal, ledgerTotals, openingIncome, openingOn, totalBalance } from "@/finance/engine";
import { formatDateBR, formatMonthLabel, monthKey, monthRange, shiftMonth } from "@/lib/dates";
import { formatBRL } from "@/lib/money";

export function DashboardPage() {
  const { data, today } = useFinance();
  const [params] = useSearchParams();
  const location = useLocation();
  const requested = params.get("mes");
  const [month, setMonth] = useState(requested && /^\d{4}-\d{2}$/.test(requested) ? requested : monthKey(today));
  useEffect(() => {
    const next = params.get("mes");
    if (next && /^\d{4}-\d{2}$/.test(next)) setMonth(next);
  }, [params]);
  useEffect(() => {
    const id = location.hash.replace("#", "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, month]);

  const range = monthRange(month);
  const model = useMemo(() => buildDashboard(data, month, today), [data, month, today]);
  const movement = useMemo(() => categoryMovement(data, month), [data, month]);
  const ledger = useMemo(() => ledgerTotals(data.accounts, data.transactions, today), [data.accounts, data.transactions, today]);
  const bridge = useMemo(() => {
    const pending = movement.pending.filter((item) => item.totalCents > 0);
    const openedInMonth = openingIncome(data.accounts, range.start, range.end, today);
    const entryDates = inflowDates(data, range.start, range.end, today);
    const afterPending = ledger.balanceCents - pending.reduce((sum, item) => sum + item.totalCents, 0);
    const gap = model.projectedEndCents - afterPending;
    const steps: BridgeStep[] = [
      { label: "Começo", cents: Math.max(0, ledger.initialCents - openedInMonth), kind: "total", date: range.start },
      { label: "Entrou", cents: ledger.inCents + openedInMonth, kind: "in", date: entryDates[0] ?? null },
      { label: "Saiu", cents: ledger.outCents, kind: "out" },
      { label: "Agora", cents: ledger.balanceCents, kind: "total", date: today },
      ...pending.map((item) => ({ label: item.name, cents: item.totalCents, kind: "out" as const, date: item.date })),
    ];
    if (gap > 0) steps.push({ label: "Ainda entra", cents: gap, kind: "in" });
    if (gap < 0) steps.push({ label: "Resto a sair", cents: -gap, kind: "out" });
    steps.push({ label: "Previsto", cents: model.projectedEndCents, kind: "forecast", date: range.end });
    return steps;
  }, [data, ledger, model.projectedEndCents, movement.pending, range.end, range.start, today]);
  const chartHistory = useMemo(() => appendInstallmentMonths(data, model.history, today), [data, model.history, today]);
  const toReceive = data.transactions.filter((item) => item.type === "income" && item.status !== "received");
  const toPay = data.transactions.filter((item) => item.type === "expense" && !item.creditCardId && item.status !== "paid");
  const receiveCents = toReceive.reduce((sum, item) => sum + item.amountCents, 0);
  const billsCents = toPay.reduce((sum, item) => sum + item.amountCents, 0) + model.openInvoicesCents;
  const nextBills = [...toReceive.map((item) => ({ id: item.id, title: item.description, date: item.dueOn || item.occurredOn, amountCents: item.amountCents, income: true })), ...toPay.map((item) => ({ id: item.id, title: item.description, date: item.dueOn || item.occurredOn, amountCents: item.amountCents, income: false }))]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  const accounts = data.accounts;
  const saldoHoje = totalBalance(accounts, data.transactions, today);
  const periodEnd = month === monthKey(today) ? today : range.end;
  const nextPay = [...toPay.map((item) => item.dueOn || item.occurredOn), ...data.invoices.filter((invoice) => invoice.status !== "paid" && invoiceTotal(invoice.id, data.transactions) > 0).map((invoice) => invoice.dueOn)].sort()[0];
  const nextReceive = [...toReceive.map((item) => item.dueOn || item.occurredOn)].sort()[0];
  const todayLabel = formatDateBR(today);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Você tem {formatBRL(model.availableCents)}. Está devendo {formatBRL(billsCents)}. Ainda vai receber {formatBRL(receiveCents)} e pagar {formatBRL(billsCents)}. No fim de {formatMonthLabel(month)} a previsão é {formatBRL(model.projectedEndCents)}.</p>
        </div>
        <div className="inline-flex max-w-full items-center self-start rounded-full border border-line bg-surface sm:self-auto">
          <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-0 px-2 text-center text-sm font-medium">{formatMonthLabel(month)}</span>
          <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês"><ChevronRight size={16} /></button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link to="/contas" className="tap rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Saldo atual</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl"><MoneyText cents={model.availableCents} tone="auto" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Em {todayLabel}. Saldo inicial, mais o que já entrou, menos o que já saiu. {formatBRL(saldoHoje)}.</p>
        </Link>
        <Link to="/receitas" className="tap rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Receitas do mês</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl"><MoneyText cents={model.incomeCents} tone="income" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Recebido de {formatDateBR(range.start)} até {formatDateBR(periodEnd)}.</p>
        </Link>
        <Link to="/despesas" className="tap rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Despesas do mês</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl"><MoneyText cents={model.spendingCents} tone="expense" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Pago de {formatDateBR(range.start)} até {formatDateBR(periodEnd)}, mais as compras no cartão.</p>
        </Link>
        <Link to="/compromissos" className="tap rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Contas a pagar</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl"><MoneyText cents={billsCents} tone="expense" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">{nextPay ? `Próxima em ${formatDateBR(nextPay)}. Contas em aberto e faturas do cartão.` : `Nenhuma em aberto em ${todayLabel}.`}</p>
        </Link>
        <Link to="/compromissos" className="tap rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Contas a receber</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl"><MoneyText cents={receiveCents} tone="income" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">{nextReceive ? `Próxima em ${formatDateBR(nextReceive)}. Dinheiro combinado que ainda não entrou.` : `Nada a receber em ${todayLabel}.`}</p>
        </Link>
        <Link id="previsao" to="/relatorios" className="tap scroll-mt-24 rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Saldo previsto no fim do mês</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl"><MoneyText cents={model.projectedEndCents} tone="auto" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Até {formatDateBR(range.end)}. Saldo de hoje, mais o que ainda entra, menos o que ainda sai.</p>
        </Link>
      </section>

      {!accounts.length ? (
        <div className="rounded-3xl border border-line bg-surface p-5 text-sm leading-6">
          <p className="font-medium">Cadastre onde o dinheiro está.</p>
          <p className="mt-1 text-muted">O saldo só existe depois da primeira conta. O valor inicial já entra na soma. Depois, o que você recebe soma e o que você paga subtrai.</p>
          <Link className="mt-3 inline-block text-accent" to="/contas">Cadastrar a conta</Link>
        </div>
      ) : (
        <section className="rounded-3xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Onde está o dinheiro</h2>
            <Link className="tap rounded-full px-3 py-1 text-sm text-accent" to="/contas">Ver contas</Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => {
              const parts = balanceParts(account, data.transactions, today);
              return (
                <Link key={account.id} to="/contas" className="tap flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-3 text-sm">
                  <span>
                    <span className="block font-medium">{account.name}</span>
                    <span className="text-xs text-muted">Lançado em {formatDateBR(openingOn(account))} com {formatBRL(parts.initialCents)}. Entrou {formatBRL(parts.inCents)}. Saiu {formatBRL(parts.outCents)}.</span>
                  </span>
                  <MoneyText cents={parts.balanceCents} tone="auto" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section id="graficos" className="grid scroll-mt-24 gap-4 xl:grid-cols-2">
        <article className="rounded-3xl border border-line bg-surface p-5 xl:col-span-2">
          <h2 className="font-semibold">Como o saldo chega no previsto</h2>
          <p className="mb-4 mt-1 max-w-3xl text-sm text-muted">Os cartões são a conta completa. A cascata liga uma coluna na outra: o que soma sobe, o que subtrai desce, e a última coluna é o previsto de {formatMonthLabel(month)}.</p>
          <BridgeChart steps={bridge} />
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Por categoria</h2>
          <p className="mb-4 mt-1 text-sm text-muted">O centro é o que entrou em {formatMonthLabel(month)}. Cada fatia é um gasto. O que sobra do que entrou aparece como Sobrou.</p>
          <CategoryChart receivedCents={model.incomeCents} receivedOn={inflowDates(data, range.start, range.end, today).map((date) => formatDateBR(date)).join(" · ")} slices={[...movement.paid.map((item) => ({ ...item, status: "Já saiu" })), ...movement.pending.map((item) => ({ ...item, status: "A pagar" }))]} />
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Mês a mês</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Verde é o que entra. Vermelho junta o que já saiu, o pendente, as parcelas e as compras no cartão.</p>
          <FlowChart data={chartHistory} />
          <DatedMovements data={data} start={range.start} end={range.end} />
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5 xl:col-span-2">
          <h2 className="font-semibold">Evolução do saldo</h2>
          <p className="mb-4 mt-1 text-sm text-muted">A linha é o saldo já realizado. A área tracejada é a projeção de cada mês.</p>
          <BalanceChart data={chartHistory} />
          <DatedMovements data={data} start={range.start} end={range.end} />
        </article>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Próximas contas</h2>
          <Link className="tap rounded-full px-3 py-1 text-sm text-accent" to="/compromissos">Ver todas</Link>
        </div>
        <div className="mt-4 space-y-3">
          {nextBills.length ? nextBills.map((item) => (
            <Link key={item.id} to="/compromissos" className="tap flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-3 text-sm">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted">{formatDateBR(item.date)} · {item.income ? "A receber" : "A pagar"}</p>
              </div>
              <MoneyText cents={item.amountCents} tone={item.income ? "income" : "expense"} />
            </Link>
          )) : <p className="text-sm text-muted">Nenhuma conta em aberto em {todayLabel}.</p>}
          {data.invoices.filter((invoice) => invoice.status !== "paid" && invoiceTotal(invoice.id, data.transactions) > 0).slice(0, 2).map((invoice) => (
            <Link key={invoice.id} to={`/cartoes/${invoice.creditCardId}`} className="tap flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-3 text-sm">
              <div>
                <p className="font-medium">Fatura {data.cards.find((card) => card.id === invoice.creditCardId)?.name ?? "do cartão"}</p>
                <p className="text-xs text-muted">{formatDateBR(invoice.dueOn)} · A pagar</p>
              </div>
              <MoneyText cents={invoiceTotal(invoice.id, data.transactions)} tone="expense" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function DatedMovements({ data, start, end }: { data: FinanceData; start: string; end: string }) {
  const items = [
    ...data.accounts
      .filter((account) => account.initialBalanceCents > 0 && openingOn(account) >= start && openingOn(account) <= end)
      .map((account) => ({ date: openingOn(account), label: account.name, text: `+ ${formatBRL(account.initialBalanceCents)}` })),
    ...data.transactions
      .filter((item) => (item.type === "income" || item.type === "expense") && (item.dueOn || item.occurredOn) >= start && (item.dueOn || item.occurredOn) <= end)
      .map((item) => ({ date: item.dueOn || item.occurredOn, label: item.description, text: `${item.type === "income" ? "+" : "−"} ${formatBRL(item.amountCents)}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) return null;
  return (
    <ul className="mt-3 divide-y divide-line text-sm">
      {items.map((item) => (
        <li key={`${item.date}-${item.label}`} className="flex items-center justify-between gap-3 py-1.5">
          <span className="min-w-0 truncate">{formatDateBR(item.date)} · {item.label}</span>
          <span className="shrink-0 font-semibold tabular-nums">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
