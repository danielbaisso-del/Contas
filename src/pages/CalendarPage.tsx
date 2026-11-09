import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MoneyText } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { calendarCardEvents, calendarCashEvents, projectCash } from "@/finance/engine";
import { calendarCells, currentMonth, formatDateBR, formatMonthLabel, monthKey, shiftMonth } from "@/lib/dates";
import { cx } from "@/lib/utils";

export function CalendarPage() {
  const { data, today } = useFinance();
  const [params] = useSearchParams();
  const requestedMonth = params.get("mes");
  const requestedDay = params.get("dia");
  const [month, setMonth] = useState(requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : currentMonth(today));
  const [selected, setSelected] = useState(requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : today);
  useEffect(() => {
    const nextMonth = params.get("mes");
    const nextDay = params.get("dia");
    if (nextMonth && /^\d{4}-\d{2}$/.test(nextMonth)) setMonth(nextMonth);
    if (nextDay && /^\d{4}-\d{2}-\d{2}$/.test(nextDay)) setSelected(nextDay);
  }, [params]);
  const cells = useMemo(() => calendarCells(month), [month]);
  const cash = calendarCashEvents(data, selected);
  const cards = calendarCardEvents(data, selected);
  const invoices = data.invoices.filter((invoice) => invoice.dueOn === selected && invoice.status !== "paid");

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Calendário financeiro</h1>
          <p className="mt-1 text-sm text-muted">Verde entra, vermelho sai da conta, azul é cartão ou fatura. O saldo projetado considera o dia inteiro.</p>
        </div>
        <div className="inline-flex items-center rounded-full border border-line bg-surface">
          <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-40 text-center text-sm">{formatMonthLabel(month)}</span>
          <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-3xl border border-line bg-surface p-4">
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const hasIncome = data.transactions.some((transaction) => (transaction.dueOn || transaction.occurredOn) === cell.iso && transaction.type === "income");
              const hasExpense = data.transactions.some((transaction) => (transaction.dueOn || transaction.occurredOn) === cell.iso && transaction.type === "expense" && !transaction.creditCardId);
              const hasCard = data.transactions.some((transaction) => transaction.occurredOn === cell.iso && transaction.creditCardId) || data.invoices.some((invoice) => invoice.dueOn === cell.iso);
              return (
                <button key={cell.iso} onClick={() => setSelected(cell.iso)} className={cx("min-h-16 rounded-2xl border p-2 text-left text-xs", cell.iso === selected ? "border-accent" : "border-transparent", cell.inMonth ? "bg-surface-2" : "opacity-40")}>
                  <span className={cell.iso === today ? "font-semibold text-accent" : ""}>{Number(cell.iso.slice(8))}</span>
                  <span className="mt-2 flex gap-1">{hasIncome ? <i className="h-1.5 w-1.5 rounded-full bg-income" /> : null}{hasExpense ? <i className="h-1.5 w-1.5 rounded-full bg-expense" /> : null}{hasCard ? <i className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}</span>
                </button>
              );
            })}
          </div>
        </div>
        <aside className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">{formatDateBR(selected)}</p>
          <p className="mt-1 text-lg font-semibold">Saldo projetado: <MoneyText cents={projectCash(data, selected, today)} tone="auto" /></p>
          <p className="mt-2 text-xs leading-5 text-muted">Este saldo imagina que tudo o que está previsto até este dia aconteça. Compra de cartão não reduz o saldo aqui; a fatura reduz.</p>
          <div className="mt-4 space-y-3 text-sm">
            {cash.map((transaction) => <p key={transaction.id} className="flex justify-between gap-3"><span>{transaction.description}</span><MoneyText cents={transaction.amountCents} tone={transaction.type === "income" ? "income" : "expense"} /></p>)}
            {cards.map((transaction) => <p key={transaction.id} className="flex justify-between gap-3 text-muted"><span>{transaction.description} · parcela do cartão</span><MoneyText cents={transaction.amountCents} /></p>)}
            {invoices.map((invoice) => <p key={invoice.id}>Vencimento de fatura neste dia. O valor entra no saldo projetado.</p>)}
            {!cash.length && !cards.length && !invoices.length ? <p className="text-muted">Nada previsto neste dia.</p> : null}
          </div>
          {monthKey(selected) !== month ? <button className="mt-4 text-sm text-accent" onClick={() => setMonth(monthKey(selected))}>Mostrar o mês deste dia</button> : null}
        </aside>
      </div>
    </div>
  );
}
