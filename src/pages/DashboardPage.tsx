import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BalanceChart, CategoryChart, FlowChart } from "@/components/Charts";
import { MoneyText } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { accountBalance, buildDashboard, invoiceTotal } from "@/finance/engine";
import { formatDateBR, formatMonthLabel, monthKey, shiftMonth } from "@/lib/dates";
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

  const model = useMemo(() => buildDashboard(data, month, today), [data, month, today]);
  const toReceive = data.transactions.filter((item) => item.type === "income" && item.status !== "received");
  const toPay = data.transactions.filter((item) => item.type === "expense" && !item.creditCardId && item.status !== "paid");
  const receiveCents = toReceive.reduce((sum, item) => sum + item.amountCents, 0);
  const billsCents = toPay.reduce((sum, item) => sum + item.amountCents, 0) + model.openInvoicesCents;
  const nextBills = [...toReceive.map((item) => ({ id: item.id, title: item.description, date: item.dueOn || item.occurredOn, amountCents: item.amountCents, income: true })), ...toPay.map((item) => ({ id: item.id, title: item.description, date: item.dueOn || item.occurredOn, amountCents: item.amountCents, income: false }))]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  const accounts = data.accounts.filter((account) => !account.archived);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Você tem {formatBRL(model.availableCents)}. Está devendo {formatBRL(billsCents)}. Ainda vai receber {formatBRL(receiveCents)} e pagar {formatBRL(billsCents)}. No fim de {formatMonthLabel(month)} a previsão é {formatBRL(model.projectedEndCents)}.</p>
        </div>
        <div className="inline-flex items-center rounded-full border border-line bg-surface">
          <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-40 text-center text-sm font-medium">{formatMonthLabel(month)}</span>
          <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês"><ChevronRight size={16} /></button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link to="/contas" className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Saldo atual</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.availableCents} tone="auto" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Quanto dinheiro tenho hoje, somando as contas.</p>
        </Link>
        <Link to="/receitas" className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Receitas do mês</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.incomeCents} tone="income" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">O que já foi marcado como recebido em {formatMonthLabel(month)}.</p>
        </Link>
        <Link to="/despesas" className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Despesas do mês</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.spendingCents} tone="expense" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">O que já foi pago neste mês, mais as compras feitas no cartão.</p>
        </Link>
        <Link to="/compromissos" className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Contas a pagar</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={billsCents} tone="expense" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Quanto estou devendo: contas em aberto e faturas do cartão.</p>
        </Link>
        <Link to="/compromissos" className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Contas a receber</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={receiveCents} tone="income" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Dinheiro combinado que ainda não entrou na conta.</p>
        </Link>
        <article id="previsao" className="scroll-mt-24 rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Saldo previsto no fim do mês</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.projectedEndCents} tone="auto" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Saldo de hoje, mais o que ainda entra até o fim do mês, menos o que ainda sai.</p>
        </article>
      </section>

      {!accounts.length ? (
        <div className="rounded-3xl border border-line bg-surface p-5 text-sm leading-6">
          <p className="font-medium">Cadastre onde o dinheiro está.</p>
          <p className="mt-1 text-muted">O saldo só existe depois da primeira conta. Pode ser o banco, uma carteira ou o dinheiro em espécie.</p>
          <Link className="mt-3 inline-block text-accent" to="/contas">Cadastrar a conta</Link>
        </div>
      ) : (
        <section className="rounded-3xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Onde está o dinheiro</h2>
            <Link className="text-sm text-accent" to="/contas">Ver contas</Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => (
              <p key={account.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{account.name}</span>
                <MoneyText cents={accountBalance(account, data.transactions, today)} tone="auto" />
              </p>
            ))}
          </div>
        </section>
      )}

      <section id="graficos" className="grid scroll-mt-24 gap-4 xl:grid-cols-2">
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Despesas por categoria</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Cada fatia é uma categoria lançada em {formatMonthLabel(month)}. Ela entra quando você adiciona a despesa.</p>
          <CategoryChart data={model.categories} />
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Receitas e despesas</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Os últimos meses, lado a lado. Verde entra, vermelho sai.</p>
          <FlowChart data={model.history} />
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5 xl:col-span-2">
          <h2 className="font-semibold">Evolução do saldo</h2>
          <p className="mb-4 mt-1 text-sm text-muted">A linha contínua é o que já aconteceu. A tracejada é a projeção.</p>
          <BalanceChart data={model.history} />
        </article>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Próximas contas</h2>
          <Link className="text-sm text-accent" to="/compromissos">Ver todas</Link>
        </div>
        <div className="mt-4 space-y-3">
          {nextBills.length ? nextBills.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted">{formatDateBR(item.date)} · {item.income ? "A receber" : "A pagar"}</p>
              </div>
              <MoneyText cents={item.amountCents} tone={item.income ? "income" : "expense"} />
            </div>
          )) : <p className="text-sm text-muted">Nenhuma conta em aberto.</p>}
          {data.invoices.filter((invoice) => invoice.status !== "paid" && invoiceTotal(invoice.id, data.transactions) > 0).slice(0, 2).map((invoice) => (
            <div key={invoice.id} className="flex items-center justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">Fatura {data.cards.find((card) => card.id === invoice.creditCardId)?.name ?? "do cartão"}</p>
                <p className="text-xs text-muted">{formatDateBR(invoice.dueOn)} · A pagar</p>
              </div>
              <MoneyText cents={invoiceTotal(invoice.id, data.transactions)} tone="expense" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
