import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, EmptyState, Field, Input, Modal, MoneyField, MoneyText, PageHeader, Select } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { invoiceTotal } from "@/finance/engine";
import { fixedBillDates } from "@/finance/recurrence";
import { formatDateBR, todayISO } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { enableDueNotices, dueNoticesEnabled } from "@/lib/dueNotice";
import { errorMessage } from "@/lib/utils";
import { saveRecurrence, saveTransaction, setRecurrenceStatus } from "@/services/data";
import type { Recurrence, Transaction } from "@/types/models";

export function BillsPage() {
  const { data, today, refresh } = useFinance();
  const toast = useToast();
  const bills = data.transactions
    .filter((item) => (item.type === "income" && item.status !== "received") || (item.type === "expense" && !item.creditCardId && item.status !== "paid"))
    .sort((a, b) => (a.dueOn || a.occurredOn).localeCompare(b.dueOn || b.occurredOn));
  const invoices = data.invoices
    .filter((invoice) => invoice.status !== "paid" && invoiceTotal(invoice.id, data.transactions) > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  async function settle(item: Transaction) {
    const income = item.type === "income";
    try {
      await saveTransaction({
        description: item.description,
        amountCents: item.amountCents,
        type: item.type,
        occurredOn: today,
        dueOn: item.dueOn ?? item.occurredOn,
        status: income ? "received" : "paid",
        categoryId: item.categoryId,
        accountId: item.accountId,
        paymentMethod: item.paymentMethod,
        notes: item.notes,
      }, item.id);
      toast(income ? "Marcado como recebido. O valor entra no saldo." : "Marcado como pago. O valor sai do saldo.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  return (
    <div>
      <PageHeader title="Contas a pagar e receber" description="O que ainda não aconteceu. Verde entra, vermelho sai. Uma conta fixa se repete todo mês e o celular avisa no dia." action={<Button variant="secondary" className="w-full sm:w-auto" onClick={() => void enableDueNotices().then((ok) => toast(ok || dueNoticesEnabled() ? "Aviso ligado. No dia da conta, o celular mostra a notificação ao abrir o Contas." : "O navegador não permitiu o aviso.", ok ? "ok" : "error"))}>Avisar no celular</Button>} />
      <FixedBills />
      {!bills.length && !invoices.length ? (
        <EmptyState title="Nada em aberto" text="Uma conta pendente aparece aqui. Exemplo: Internet, R$ 120, vence em 10/11." action={<Link className="text-sm text-accent" to="/despesas?novo=1">Lançar uma despesa pendente</Link>} />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {bills.map((item) => {
            const when = item.dueOn || item.occurredOn;
            const income = item.type === "income";
            const late = when < today;
            return (
              <article key={item.id} className="rounded-3xl border border-line bg-surface p-4">
                <p className="font-medium">{item.description}</p>
                <p className={`mt-1 text-xs ${late ? "text-expense" : "text-muted"}`}>{income ? "A receber" : "A pagar"} · {formatDateBR(when)}{late ? " · vencida" : ""}</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <MoneyText cents={item.amountCents} tone={income ? "income" : "expense"} />
                  <Button variant="secondary" onClick={() => void settle(item)}>{income ? "Recebi" : "Paguei"}</Button>
                </div>
              </article>
            );
          })}
          {invoices.map((invoice) => {
            const card = data.cards.find((item) => item.id === invoice.creditCardId);
            const total = invoiceTotal(invoice.id, data.transactions);
            const late = invoice.dueOn < today;
            return (
              <article key={invoice.id} className="rounded-3xl border border-line bg-surface p-4">
                <p className="font-medium">Fatura {card?.name ?? "do cartão"}</p>
                <p className={`mt-1 text-xs ${late ? "text-expense" : "text-muted"}`}>A pagar · {formatDateBR(invoice.dueOn)}{late ? " · vencida" : ""}</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <MoneyText cents={total} tone="expense" />
                  <Link className="text-sm text-accent" to={`/cartoes/${invoice.creditCardId}`}>Pagar no cartão</Link>
                </div>
              </article>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto rounded-3xl border border-line bg-surface md:block">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-3">Descrição</th>
                <th>Valor</th>
                <th>Vencimento</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bills.map((item) => {
                const when = item.dueOn || item.occurredOn;
                const income = item.type === "income";
                const late = when < today;
                return (
                  <tr key={item.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.description}</p>
                      <p className="text-xs text-muted">{income ? "A receber" : "A pagar"}{late ? " · vencida" : ""}</p>
                    </td>
                    <td><MoneyText cents={item.amountCents} tone={income ? "income" : "expense"} /></td>
                    <td className={late ? "text-expense" : ""}>{formatDateBR(when)}</td>
                    <td className="px-4 text-right"><Button variant="secondary" onClick={() => void settle(item)}>{income ? "Recebi" : "Paguei"}</Button></td>
                  </tr>
                );
              })}
              {invoices.map((invoice) => {
                const card = data.cards.find((item) => item.id === invoice.creditCardId);
                const total = invoiceTotal(invoice.id, data.transactions);
                const late = invoice.dueOn < today;
                return (
                  <tr key={invoice.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <p className="font-medium">Fatura {card?.name ?? "do cartão"}</p>
                      <p className="text-xs text-muted">A pagar · cartão{late ? " · vencida" : ""}</p>
                    </td>
                    <td><MoneyText cents={total} tone="expense" /></td>
                    <td className={late ? "text-expense" : ""}>{formatDateBR(invoice.dueOn)}</td>
                    <td className="px-4 text-right"><Link className="text-sm text-accent" to={`/cartoes/${invoice.creditCardId}`}>Pagar no cartão</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

function FixedBills() {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recurrence | null>(null);
  const fixed = data.recurrences.filter((item) => item.type === "expense" && item.status === "active");

  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Contas fixas</h2>
          <p className="text-sm text-muted">Aluguel, internet, luz. O mesmo valor entra em todos os meses, no dia que você escolher. Dá para mudar o nome, o valor e o dia depois.</p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => { setEditing(null); setOpen(true); }}>Nova conta fixa</Button>
      </div>
      <div className="mt-4 space-y-2">
        {fixed.length ? fixed.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-3">
            <div>
              <p className="font-medium">{item.description}</p>
              <p className="text-sm text-muted">Todo dia {item.dayOfMonth ?? Number(item.startOn.slice(8, 10))} · a partir de {formatDateBR(item.startOn)}</p>
            </div>
            <div className="flex items-center gap-3">
              <MoneyText cents={item.amountCents} tone="expense" />
              <button type="button" className="text-sm text-accent" onClick={() => { setEditing(item); setOpen(true); }}>Editar</button>
              <button type="button" className="text-sm text-expense" onClick={() => void setRecurrenceStatus(item.id, "cancelled").then(() => refresh()).then(() => toast("Conta fixa encerrada. Os próximos meses saem da lista.")).catch((error) => toast(errorMessage(error), "error"))}>Encerrar</button>
            </div>
          </div>
        )) : <p className="text-sm text-muted">Nenhuma conta fixa. Uma conta avulsa continua em Despesas, com a data que você colocar.</p>}
      </div>
      {open ? <FixedForm key={editing?.id ?? "nova"} recurrence={editing} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function FixedForm({ recurrence, onClose }: { recurrence: Recurrence | null; onClose: () => void }) {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const [description, setDescription] = useState(recurrence?.description ?? "");
  const [amount, setAmount] = useState<number | null>(recurrence?.amountCents ?? null);
  const [date, setDate] = useState(recurrence?.startOn ?? todayISO());
  const [categoryId, setCategoryId] = useState(recurrence?.categoryId ?? data.categories.find((item) => item.kind === "expense")?.id ?? "");
  const [accountId, setAccountId] = useState(recurrence?.accountId ?? data.accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const months = date ? fixedBillDates(date, todayISO()) : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim() || amount == null || !date || !accountId) {
      toast("Preencha nome, valor, dia e conta.", "error");
      return;
    }
    setBusy(true);
    try {
      await saveRecurrence({
        description: description.trim(),
        amountCents: amount,
        type: "expense",
        categoryId: categoryId || null,
        accountId,
        frequency: "monthly",
        interval: 1,
        startOn: date,
      }, recurrence?.id);
      toast(recurrence ? "Conta fixa atualizada. Todos os meses usam o novo nome, valor e dia." : "Conta fixa criada. Ela entra em todos os meses, neste dia.");
      onClose();
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={recurrence ? "Editar conta fixa" : "Nova conta fixa"} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)} key={recurrence?.id ?? "nova"}>
        <Field label="Nome"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Exemplo: Internet" required /></Field>
        <MoneyField label="Valor" value={amount} onChange={setAmount} />
        <Field label="Dia do mês" hint="Esse dia vale para todos os meses. Se mudar a data, os próximos meses passam para o novo dia."><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></Field>
        {months.length ? <div className="max-h-48 overflow-y-auto rounded-2xl border border-line p-3 text-sm">{months.map((day) => <p key={day} className="flex justify-between gap-3 py-1"><span>{formatDateBR(day)}</span><span>{amount == null ? "—" : formatBRL(amount)}</span></p>)}</div> : null}
        <Field label="Categoria"><Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{data.categories.filter((item) => item.kind === "expense").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="Conta que vai pagar"><Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Button type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar"}</Button>
      </form>
    </Modal>
  );
}
