import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, EmptyState, Field, Input, Modal, MoneyField, MoneyText, PageHeader, Select, TextArea, useConfirm } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { cardCommittedCents, invoiceDisplayStatus, invoiceTotal } from "@/finance/engine";
import { planCardInstallments } from "@/finance/installments";
import { formatDateBR, todayISO } from "@/lib/dates";
import { COLORS } from "@/lib/labels";
import { formatBRL } from "@/lib/money";
import { errorMessage } from "@/lib/utils";
import { createCardPurchase, moveGroupToTrash, moveToTrash, payInvoice, saveCard, setCardArchived, undoInvoicePayment } from "@/services/data";
import type { CreditCard } from "@/types/models";

export function CardsPage() {
  const { data, today } = useFinance();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CreditCard | null>(null);
  return (
    <div>
      <PageHeader title="Cartões" description="Cadastre o cartão, o limite total, o fechamento e o vencimento. Ao abrir, lance compras parceladas e veja o histórico das faturas. O dinheiro da conta só sai quando a fatura é paga." action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Novo cartão</Button>} />
      {!data.cards.length ? <EmptyState title="Nenhum cartão" text="Cadastre o limite, o dia de fechamento e o dia de vencimento. As parcelas serão distribuídas nas faturas certas." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.cards.map((card) => {
            const used = cardCommittedCents(card.id, data.transactions, data.invoices);
            const available = card.limitCents - used;
            const openInvoice = data.invoices.filter((invoice) => invoice.creditCardId === card.id && invoice.status !== "paid").reduce((sum, invoice) => sum + invoiceTotal(invoice.id, data.transactions), 0);
            return (
              <article key={card.id} className="rounded-3xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{card.name}</p><p className="text-xs text-muted">{card.bank || "Sem banco"} · fecha dia {card.closingDay} · vence dia {card.dueDay}</p></div><span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: card.color }} /></div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{ width: `${card.limitCents ? Math.min(100, (used / card.limitCents) * 100) : 0}%` }} /></div>
                <p className="mt-3 text-sm">Limite total: <MoneyText cents={card.limitCents} /></p>
                <p className="text-sm">Limite disponível: <MoneyText cents={available} tone={available < 0 ? "expense" : "income"} /></p>
                <p className="text-xs text-muted">Usado, com parcelas futuras: {formatBRL(used)}. Faturas em aberto: {formatBRL(openInvoice)}.</p>
                <div className="mt-4 flex flex-wrap gap-2"><Link className="rounded-xl bg-accent px-4 py-2 text-sm text-white" to={`/cartoes/${card.id}`}>Abrir</Link><Button variant="secondary" onClick={() => { setEditing(card); setOpen(true); }}>Editar</Button></div>
              </article>
            );
          })}
        </div>
      )}
      {open ? <CardModal card={editing} today={today} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function CardModal({ card, today, onClose }: { card: CreditCard | null; today: string; onClose: () => void }) {
  const { refresh } = useFinance();
  const toast = useToast();
  const [name, setName] = useState(card?.name ?? "");
  const [bank, setBank] = useState(card?.bank ?? "");
  const [limit, setLimit] = useState<number | null>(card?.limitCents ?? 0);
  const [closingDay, setClosingDay] = useState(card?.closingDay ?? 1);
  const [dueDay, setDueDay] = useState(card?.dueDay ?? 10);
  const [color, setColor] = useState(card?.color ?? COLORS[4]);
  return (
    <Modal title={card ? "Editar cartão" : "Novo cartão"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nome"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Banco"><Input value={bank} onChange={(event) => setBank(event.target.value)} /></Field>
        <MoneyField label="Limite total" value={limit} onChange={setLimit} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia de fechamento"><Input type="number" min={1} max={31} value={closingDay} onChange={(event) => setClosingDay(Number(event.target.value))} /></Field>
          <Field label="Dia de vencimento"><Input type="number" min={1} max={31} value={dueDay} onChange={(event) => setDueDay(Number(event.target.value))} /></Field>
        </div>
        <p className="text-xs text-muted">Compras depois do fechamento vão para a fatura seguinte. A mudança vale para as próximas compras. Hoje é {today}.</p>
        <div className="flex gap-2">{COLORS.map((item) => <button key={item} className="h-7 w-7 rounded-full" style={{ background: item, outline: color === item ? "2px solid var(--ink)" : undefined }} onClick={() => setColor(item)} />)}</div>
        <div className="flex gap-2">
          <Button onClick={async () => { try { await saveCard({ name, bank, limitCents: limit ?? 0, closingDay, dueDay, color }, card?.id); await refresh(); onClose(); } catch (error) { toast(errorMessage(error), "error"); } }}>Salvar</Button>
          {card ? <Button variant="ghost" onClick={async () => { await setCardArchived(card.id, !card.archived); await refresh(); onClose(); }}>{card.archived ? "Reativar" : "Arquivar"}</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

export function CardDetailPage() {
  const { id } = useParams();
  const { data, today, refresh } = useFinance();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const card = data.cards.find((item) => item.id === id);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const invoices = useMemo(() => data.invoices.filter((invoice) => invoice.creditCardId === id).sort((a, b) => a.dueOn.localeCompare(b.dueOn)), [data.invoices, id]);
  const purchases = data.transactions.filter((transaction) => transaction.creditCardId === id && transaction.type === "expense");
  if (!card) return <p>Cartão não encontrado.</p>;
  const used = cardCommittedCents(card.id, data.transactions, data.invoices);
  return (
    <div>
      <PageHeader title={card.name} description={`${card.bank || "Cartão"} · limite ${formatBRL(card.limitCents)} · disponível ${formatBRL(card.limitCents - used)}. Parcelas futuras continuam comprometendo o limite até a fatura ser paga.`} action={<Button onClick={() => setPurchaseOpen(true)}>Nova compra</Button>} />
      <div className="space-y-3">
        {invoices.map((invoice) => {
          const total = invoiceTotal(invoice.id, data.transactions);
          if (!total) return null;
          const display = invoiceDisplayStatus(invoice, today);
          return (
            <article key={invoice.id} className="rounded-3xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Fatura {formatDateBR(invoice.referenceMonth).slice(3)} · {display === "paid" ? "Paga" : display === "closed" ? "Fechada" : "Aberta"}</p>
                  <p className="text-xs text-muted">Fecha {formatDateBR(invoice.closingOn)} · vence {formatDateBR(invoice.dueOn)}</p>
                </div>
                <MoneyText cents={total} tone="expense" />
              </div>
              <div className="mt-3 space-y-1 text-sm">
                {purchases.filter((purchase) => purchase.invoiceId === invoice.id).map((purchase) => <p key={purchase.id} className="flex justify-between gap-3 text-muted"><span>{purchase.description}{purchase.installmentNumber ? ` · ${purchase.installmentNumber}/${purchase.installmentTotal}` : ""}</span><span className="flex items-center gap-2">{formatBRL(purchase.amountCents)}{invoice.status === "paid" ? null : <button className="text-xs text-expense" onClick={() => void (purchase.installmentGroupId ? moveGroupToTrash(purchase.installmentGroupId) : moveToTrash(purchase.id, purchase.notes)).then(() => refresh()).then(() => toast("Compra foi para a lixeira.")).catch((error) => toast(errorMessage(error), "error"))}>Lixeira</button>}</span></p>)}
              </div>
              {invoice.status !== "paid" ? <Button className="mt-4" onClick={() => setPaying(invoice.id)}>Pagar fatura</Button> : <Button className="mt-4" variant="secondary" onClick={async () => { if (await confirm("Desfazer o pagamento devolve o valor à conta e reabre a fatura.")) { await undoInvoicePayment(invoice.id); await refresh(); } }}>Desfazer pagamento</Button>}
            </article>
          );
        })}
      </div>
      {purchaseOpen ? <PurchaseModal card={card} onClose={() => setPurchaseOpen(false)} /> : null}
      {paying ? <PayModal invoiceId={paying} amount={invoiceTotal(paying, data.transactions)} onClose={() => setPaying(null)} onPaid={async (accountId, date) => { try { await payInvoice(paying, accountId, date); toast("Fatura paga. O valor saiu da conta e não foi somado outra vez nas despesas."); await refresh(); setPaying(null); } catch (error) { toast(errorMessage(error), "error"); } }} /> : null}
      {dialog}
    </div>
  );
}

function PurchaseModal({ card, onClose }: { card: CreditCard; onClose: () => void }) {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState("");
  const [notes, setNotes] = useState("");
  const preview = amount ? planCardInstallments({ totalCents: amount, count, purchasedOn: date, closingDay: card.closingDay, dueDay: card.dueDay }) : [];
  return (
    <Modal title="Compra no cartão" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Descrição"><Input value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <MoneyField label="Valor total" value={amount} onChange={setAmount} />
        <Field label="Parcelas"><Input type="number" min={1} max={48} value={count} onChange={(event) => setCount(Number(event.target.value))} /></Field>
        <Field label="Data da compra"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Categoria"><Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Sem categoria</option>{data.categories.filter((item) => item.kind === "expense").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="Observações"><TextArea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        {preview.length ? <div className="rounded-2xl bg-surface-2 p-3 text-sm">{preview.map((item) => <p key={item.number} className="flex flex-col gap-0.5 py-1 sm:flex-row sm:justify-between"><span>Parcela {item.number} · vence {formatDateBR(item.dueOn)}</span><span>{formatBRL(item.amountCents)}</span></p>)}</div> : null}
        <Button onClick={async () => { try { if (!amount) throw new Error("Informe o valor."); await createCardPurchase({ description, totalCents: amount, count, purchasedOn: date, categoryId, cardId: card.id, closingDay: card.closingDay, dueDay: card.dueDay, notes }); await refresh(); onClose(); } catch (error) { toast(errorMessage(error), "error"); } }}>Lançar compra</Button>
      </div>
    </Modal>
  );
}

function PayModal({ amount, onClose, onPaid }: { invoiceId: string; amount: number; onClose: () => void; onPaid: (accountId: string, date: string) => Promise<void> }) {
  const { data } = useFinance();
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayISO());
  return (
    <Modal title="Pagar fatura" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">Vai sair <strong>{formatBRL(amount)}</strong> da conta escolhida. Esse pagamento quita o cartão e não aparece de novo como despesa.</p>
        <Field label="Conta"><Select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecione</option>{data.accounts.filter((account) => !account.archived).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></Field>
        <Field label="Data do pagamento"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Button onClick={() => void onPaid(accountId, date)}>Confirmar pagamento</Button>
      </div>
    </Modal>
  );
}
