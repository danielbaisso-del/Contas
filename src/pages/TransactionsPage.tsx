import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { Button, EmptyState, Field, Input, Modal, MoneyField, MoneyText, PageHeader, Select, TextArea, useConfirm } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { planBankInstallments, planCardInstallments } from "@/finance/installments";
import { defaultStatusFor } from "@/finance/recurrence";
import { formatDateBR, isWithin, todayISO } from "@/lib/dates";
import { PAYMENT_METHODS, paymentMethodLabel, statusLabel, typeLabel } from "@/lib/labels";
import { errorMessage, normalizeText } from "@/lib/utils";
import { createBankInstallments, createCardPurchase, deleteCategory, deleteInstallmentGroup, deleteTransaction, saveCategory, saveRecurrence, saveTransaction, type TransactionInput } from "@/services/data";
import type { FinanceData, Transaction, TransactionStatus, TransactionType } from "@/types/models";

function canDelete(transaction: Transaction, data: FinanceData): string | null {
  if (transaction.type === "invoice_payment") return "Desfaça o pagamento pela tela do cartão, para a fatura e o saldo ficarem corretos.";
  if (transaction.invoiceId && data.invoices.some((invoice) => invoice.id === transaction.invoiceId && invoice.status === "paid")) {
    return "Essa compra está em uma fatura paga. Desfaça o pagamento do cartão antes de apagar.";
  }
  return null;
}

export function TransactionsPage() {
  const { data, refresh, today } = useFinance();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [open, setOpen] = useState(params.get("novo") === "1");
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState(params.get("tipo") ?? "all");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [categoryId, setCategoryId] = useState(params.get("categoria") ?? "");
  const [accountId, setAccountId] = useState(params.get("conta") ?? "");
  const [method, setMethod] = useState(params.get("forma") ?? "");
  const [start, setStart] = useState(params.get("inicio") ?? `${today.slice(0, 7)}-01`);
  const [end, setEnd] = useState(params.get("fim") ?? today.slice(0, 8) + String(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate()).padStart(2, "0"));
  useEffect(() => {
    const inicio = params.get("inicio");
    const fim = params.get("fim");
    const tipo = params.get("tipo");
    if (inicio) setStart(inicio);
    if (fim) setEnd(fim);
    if (tipo) setKind(tipo);
    if (params.has("status")) setStatus(params.get("status") ?? "");
    if (params.has("categoria")) setCategoryId(params.get("categoria") ?? "");
    if (params.has("conta")) setAccountId(params.get("conta") ?? "");
    if (params.has("forma")) setMethod(params.get("forma") ?? "");
    if (params.has("q")) setQuery(params.get("q") ?? "");
    setPage(1);
  }, [params]);
  const [page, setPage] = useState(1);

  useEffect(() => { if (params.get("novo") === "1") setOpen(true); }, [params]);

  const filtered = useMemo(() => data.transactions.filter((transaction) => {
    if (!isWithin(transaction.occurredOn, start, end)) return false;
    if (kind === "open" && transaction.status !== "pending" && transaction.status !== "planned") return false;
    if (kind !== "all" && kind !== "open" && transaction.type !== kind) return false;
    if (status && transaction.status !== status) return false;
    if (categoryId && transaction.categoryId !== categoryId) return false;
    if (accountId && transaction.accountId !== accountId && transaction.destinationAccountId !== accountId) return false;
    if (method && transaction.paymentMethod !== method) return false;
    if (query && !normalizeText(`${transaction.description} ${transaction.notes ?? ""}`).includes(normalizeText(query))) return false;
    return true;
  }), [accountId, categoryId, data.transactions, end, kind, method, query, start, status]);

  const visible = filtered.slice((page - 1) * 12, page * 12);
  const names = {
    category: (id: string | null) => data.categories.find((item) => item.id === id)?.name ?? "—",
    account: (id: string | null) => data.accounts.find((item) => item.id === id)?.name ?? data.cards.find((item) => item.id === id)?.name ?? "—",
  };

  async function remove(transaction: Transaction) {
    const blocked = canDelete(transaction, data);
    if (blocked) return toast(blocked, "error");
    const group = transaction.installmentGroupId ? await confirm("Apagar todas as parcelas deste grupo? Cancelar apaga só esta.") : false;
    if (!transaction.installmentGroupId && !(await confirm("Apagar este lançamento?"))) return;
    if (transaction.installmentGroupId && group === false && !(await confirm("Apagar somente esta parcela?"))) return;
    try {
      if (group && transaction.installmentGroupId) await deleteInstallmentGroup(transaction.installmentGroupId);
      else await deleteTransaction(transaction.id);
      toast("Lançamento apagado.");
      await refresh();
    } catch (error) { toast(errorMessage(error), "error"); }
  }

  return (
    <div>
      <PageHeader title="Lançamentos" description="Registre o que entrou, saiu ou foi previsto. Transferência e pagamento de fatura não viram receita nem despesa." action={<div className="flex gap-2"><Button variant="secondary" onClick={() => setCategoriesOpen(true)}>Categorias</Button><Button onClick={() => { setEditing(null); setOpen(true); }}>Novo lançamento</Button></div>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {[["all", "Todos"], ["income", "Receitas"], ["expense", "Despesas"], ["open", "Em aberto"]].map(([value, label]) => (
          <button key={value} className={`rounded-full px-3 py-1.5 text-sm ${kind === value ? "bg-accent text-white" : "bg-surface text-muted"}`} onClick={() => { setKind(value); setPage(1); }}>{label}</button>
        ))}
      </div>
      <div className="mb-4 grid gap-3 rounded-3xl border border-line bg-surface p-4 md:grid-cols-3 xl:grid-cols-6">
        <Input placeholder="Pesquisar" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        <Input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        <Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        <Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos os status</option><option value="planned">Previsto</option><option value="pending">Pendente</option><option value="paid">Pago</option><option value="received">Recebido</option></Select>
        <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Todas as categorias</option>{data.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Todas as contas</option>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        <Select value={method} onChange={(event) => setMethod(event.target.value)}><option value="">Todas as formas</option>{PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
      </div>
      {!filtered.length ? <EmptyState title="Nenhum lançamento neste filtro" text="Troque o período ou registre uma receita, despesa ou transferência. Campos avançados ficam fechados para o lançamento rápido." action={<Button onClick={() => setOpen(true)}>Lançar agora</Button>} /> : (
        <div className="overflow-x-auto rounded-3xl border border-line bg-surface">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-muted"><tr><th className="px-4 py-3">Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Status</th><th>Valor</th><th></th></tr></thead>
            <tbody>
              {visible.map((transaction) => (
                <tr key={transaction.id} className="border-t border-line">
                  <td className="px-4 py-3">{formatDateBR(transaction.occurredOn)}</td>
                  <td>{transaction.description}<p className="text-xs text-muted">{typeLabel(transaction.type)} · {paymentMethodLabel(transaction.paymentMethod)}</p></td>
                  <td>{names.category(transaction.categoryId)}</td>
                  <td>{transaction.destinationAccountId ? `${names.account(transaction.accountId)} → ${names.account(transaction.destinationAccountId)}` : names.account(transaction.accountId ?? transaction.creditCardId)}</td>
                  <td>{statusLabel(transaction.status, transaction.type)}</td>
                  <td><MoneyText cents={transaction.amountCents} tone={transaction.type === "income" ? "income" : transaction.type === "transfer" ? "neutral" : "expense"} /></td>
                  <td className="px-3"><button className="p-2" onClick={() => { setEditing(transaction); setOpen(true); }} aria-label="Editar"><Pencil size={15} /></button><button className="p-2" onClick={() => void remove(transaction)} aria-label="Apagar"><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between text-sm text-muted">
        <span>{filtered.length} lançamento(s)</span>
        <div className="flex gap-2"><Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page * 12 >= filtered.length} onClick={() => setPage(page + 1)}>Próxima</Button></div>
      </div>
      {open ? <TransactionModal transaction={editing} onClose={() => { setOpen(false); setEditing(null); params.delete("novo"); setParams(params); }} /> : null}
      {categoriesOpen ? <CategoryModal onClose={() => setCategoriesOpen(false)} /> : null}
      {dialog}
    </div>
  );
}

function TransactionModal({ transaction, onClose }: { transaction: Transaction | null; onClose: () => void }) {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const today = todayISO();
  const [type, setType] = useState<TransactionType>(transaction?.type ?? "expense");
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [amount, setAmount] = useState<number | null>(transaction?.amountCents ?? null);
  const [occurredOn, setOccurredOn] = useState(transaction?.occurredOn ?? today);
  const [dueOn, setDueOn] = useState(transaction?.dueOn ?? "");
  const [status, setStatus] = useState<TransactionStatus>(transaction?.status ?? defaultStatusFor("expense", today));
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? "");
  const [accountId, setAccountId] = useState(transaction?.accountId ?? "");
  const [destinationAccountId, setDestination] = useState(transaction?.destinationAccountId ?? "");
  const [cardId, setCardId] = useState(transaction?.creditCardId ?? "");
  const [method, setMethod] = useState(transaction?.paymentMethod ?? "");
  const [notes, setNotes] = useState(transaction?.notes ?? "");
  const [installments, setInstallments] = useState(transaction?.installmentTotal ?? 1);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState("monthly:1");
  const [endOn, setEndOn] = useState("");
  const [advanced, setAdvanced] = useState(Boolean(transaction));
  const [saving, setSaving] = useState(false);
  const card = data.cards.find((item) => item.id === cardId);
  const preview = card && amount && installments >= 1 ? planCardInstallments({ totalCents: amount, count: installments, purchasedOn: occurredOn, closingDay: card.closingDay, dueDay: card.dueDay }) : !card && amount && installments > 1 ? planBankInstallments({ totalCents: amount, count: installments, firstDate: occurredOn }) : [];

  async function submit() {
    if (!amount) return toast("Informe o valor.", "error");
    setSaving(true);
    try {
      if (recurring && !transaction) {
        const [freq, interval] = frequency.split(":");
        await saveRecurrence({
          description, amountCents: amount, type: type === "income" ? "income" : "expense", categoryId, accountId: cardId ? null : accountId,
          creditCardId: cardId || null, frequency: freq as "weekly" | "monthly" | "yearly", interval: Number(interval), startOn: occurredOn, endOn, paymentMethod: method, notes,
        });
      } else if (!transaction && cardId) {
        if (!card) throw new Error("Escolha um cartão.");
        await createCardPurchase({ description, totalCents: amount, count: installments, purchasedOn: occurredOn, categoryId, cardId, closingDay: card.closingDay, dueDay: card.dueDay, notes });
      } else if (!transaction && installments > 1) {
        await createBankInstallments({ description, totalCents: amount, count: installments, firstDate: occurredOn, categoryId, accountId, paymentMethod: method, notes });
      } else {
        const input: TransactionInput = {
          description, amountCents: amount, type, occurredOn, dueOn, status, categoryId, accountId, destinationAccountId, creditCardId: cardId || null, paymentMethod: method, notes,
        };
        await saveTransaction(input, transaction?.id);
      }
      toast("Lançamento salvo.");
      await refresh();
      onClose();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally { setSaving(false); }
  }

  const categories = data.categories.filter((item) => type === "income" ? item.kind === "income" : item.kind === "expense");
  return (
    <Modal title={transaction ? "Editar lançamento" : "Novo lançamento"} onClose={onClose} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tipo">
          <Select value={type} onChange={(event) => { const next = event.target.value as TransactionType; setType(next); setStatus(defaultStatusFor(next === "income" ? "income" : "expense", occurredOn)); }} disabled={Boolean(transaction)}>
            <option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option>
          </Select>
        </Field>
        <MoneyField label="Valor" value={amount} onChange={setAmount} />
        <Field label="Descrição"><Input value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <Field label="Data"><Input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></Field>
        {type !== "transfer" ? <Field label="Categoria"><Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Sem categoria</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
        {type !== "transfer" ? <Field label="Conta" hint={cardId ? "No cartão, a conta só será escolhida quando você pagar a fatura." : undefined}><Select value={accountId} onChange={(event) => { setAccountId(event.target.value); if (event.target.value) setCardId(""); }} disabled={Boolean(cardId)}><option value="">Selecione</option>{data.accounts.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
        {type === "transfer" ? <Field label="Sai de"><Select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecione</option>{data.accounts.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
        {type === "transfer" ? <Field label="Entra em"><Select value={destinationAccountId} onChange={(event) => setDestination(event.target.value)}><option value="">Selecione</option>{data.accounts.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
        {type === "expense" && !transaction ? <Field label="Cartão"><Select value={cardId} onChange={(event) => { setCardId(event.target.value); if (event.target.value) setAccountId(""); }}><option value="">Não é no cartão</option>{data.cards.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
      </div>
      <button className="mt-4 text-sm text-accent" onClick={() => setAdvanced(!advanced)}>{advanced ? "Ocultar detalhes" : "Mais detalhes"}</button>
      {advanced ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Vencimento"><Input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></Field>
          <Field label="Status"><Select value={status} onChange={(event) => setStatus(event.target.value as TransactionStatus)}>{type === "income" ? <><option value="planned">Previsto</option><option value="pending">Pendente</option><option value="received">Recebido</option></> : <><option value="planned">Previsto</option><option value="pending">Pendente</option><option value="paid">Pago</option></>}</Select></Field>
          <Field label="Forma de pagamento"><Select value={method} onChange={(event) => setMethod(event.target.value)}><option value="">Não informar</option>{PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
          {!transaction && type === "expense" ? <Field label="Parcelas" hint="Parcelar substitui a recorrência."><Input type="number" min={1} max={48} value={installments} onChange={(event) => setInstallments(Number(event.target.value))} /></Field> : null}
          {!transaction && type !== "transfer" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Repetir automaticamente</label> : null}
          {recurring ? <Field label="Frequência"><Select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="weekly:1">Toda semana</option><option value="weekly:2">A cada 15 dias</option><option value="monthly:1">Todo mês</option><option value="monthly:2">A cada 2 meses</option><option value="yearly:1">Todo ano</option></Select></Field> : null}
          {recurring ? <Field label="Termina em"><Input type="date" value={endOn} onChange={(event) => setEndOn(event.target.value)} /></Field> : null}
          <div className="md:col-span-2"><Field label="Observações"><TextArea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field></div>
        </div>
      ) : null}
      {preview.length > 1 ? (
        <div className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm">
          <p className="mb-2 font-medium">Prévia das parcelas</p>
          {preview.map((item) => <p key={item.number} className="flex justify-between"><span>{item.number}/{item.total} · {formatDateBR(item.dueOn)}</span><MoneyText cents={item.amountCents} /></p>)}
        </div>
      ) : null}
      <div className="mt-5 flex justify-end"><Button loading={saving} onClick={() => void submit()}>Salvar</Button></div>
    </Modal>
  );
}

function CategoryModal({ onClose }: { onClose: () => void }) {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  return (
    <Modal title="Categorias" onClose={onClose}>
      <div className="mb-4 flex gap-2">
        <Input value={name} placeholder="Nova categoria" onChange={(event) => setName(event.target.value)} />
        <Select value={kind} onChange={(event) => setKind(event.target.value as "income" | "expense")}><option value="expense">Despesa</option><option value="income">Receita</option></Select>
        <Button onClick={async () => { try { await saveCategory(name, kind); setName(""); await refresh(); } catch (error) { toast(errorMessage(error), "error"); } }}>Adicionar</Button>
      </div>
      <div className="space-y-2">
        {data.categories.map((category) => (
          <div key={category.id} className="flex items-center justify-between text-sm">
            <span>{category.name} · {category.kind === "income" ? "receita" : "despesa"}</span>
            <button onClick={async () => { try { await deleteCategory(category.id); await refresh(); } catch (error) { toast(errorMessage(error), "error"); } }}>Excluir</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
