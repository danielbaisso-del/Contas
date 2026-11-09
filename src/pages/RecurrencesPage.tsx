import { useState } from "react";
import { Button, EmptyState, Field, Input, Modal, MoneyField, MoneyText, PageHeader, Select, TextArea } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { recurrenceDates } from "@/finance/recurrence";
import { formatDateBR, todayISO } from "@/lib/dates";
import { frequencyLabel, parseFrequency } from "@/lib/labels";
import { errorMessage } from "@/lib/utils";
import { saveRecurrence, setRecurrenceStatus, type RecurrenceInput } from "@/services/data";
import type { Recurrence } from "@/types/models";

export function RecurrencesPage() {
  const { data } = useFinance();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recurrence | null>(null);
  return (
    <div>
      <PageHeader title="Contas recorrentes" description="Aluguel, internet, salário e assinaturas. Os lançamentos são criados do mês atual até 12 meses à frente, sem repetir a mesma data." action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Nova recorrência</Button>} />
      {!data.recurrences.length ? <EmptyState title="Nada se repete ainda" text="Crie a primeira conta fixa. Ela entra como prevista ou pendente; você marca como paga quando o dinheiro realmente sair." /> : (
        <div className="space-y-3">
          {data.recurrences.map((item) => <RecurrenceCard key={item.id} item={item} onEdit={() => { setEditing(item); setOpen(true); }} />)}
        </div>
      )}
      {open ? <RecurrenceModal item={editing} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function RecurrenceCard({ item, onEdit }: { item: Recurrence; onEdit: () => void }) {
  const { refresh, today } = useFinance();
  const next = recurrenceDates(item, today, "2100-01-01")[0];
  return (
    <article className="rounded-3xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{item.description}</p>
          <p className="text-xs text-muted">{frequencyLabel(item.frequency, item.interval)} · {item.status === "active" ? "ativa" : item.status === "paused" ? "pausada" : "cancelada"} · próxima {next ? formatDateBR(next) : "—"}</p>
        </div>
        <MoneyText cents={item.amountCents} tone={item.type === "income" ? "income" : "expense"} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onEdit}>Editar</Button>
        {item.status === "active" ? <Button variant="ghost" onClick={async () => { await setRecurrenceStatus(item.id, "paused"); await refresh(); }}>Pausar</Button> : null}
        {item.status === "paused" ? <Button variant="ghost" onClick={async () => { await setRecurrenceStatus(item.id, "active"); await refresh(); }}>Retomar</Button> : null}
        {item.status !== "cancelled" ? <Button variant="ghost" onClick={async () => { await setRecurrenceStatus(item.id, "cancelled"); await refresh(); }}>Cancelar futuras</Button> : null}
      </div>
    </article>
  );
}

function RecurrenceModal({ item, onClose }: { item: Recurrence | null; onClose: () => void }) {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const [description, setDescription] = useState(item?.description ?? "");
  const [amount, setAmount] = useState<number | null>(item?.amountCents ?? null);
  const [type, setType] = useState<"income" | "expense">(item?.type ?? "expense");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [accountId, setAccountId] = useState(item?.accountId ?? "");
  const [cardId, setCardId] = useState(item?.creditCardId ?? "");
  const [frequency, setFrequency] = useState(item ? `${item.frequency}:${item.interval}` : "monthly:1");
  const [startOn, setStartOn] = useState(item?.startOn ?? todayISO());
  const [endOn, setEndOn] = useState(item?.endOn ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  async function save() {
    try {
      if (!amount) throw new Error("Informe o valor.");
      const parsed = parseFrequency(frequency);
      const input: RecurrenceInput = { description, amountCents: amount, type, categoryId, accountId: cardId ? null : accountId, creditCardId: cardId || null, frequency: parsed.frequency, interval: parsed.interval, startOn, endOn, notes };
      await saveRecurrence(input, item?.id);
      toast(item ? "Recorrência atualizada. Lançamentos futuros ainda não pagos receberam o novo valor." : "Recorrência criada. Os próximos lançamentos serão gerados agora.");
      await refresh();
      onClose();
    } catch (error) { toast(errorMessage(error), "error"); }
  }
  return (
    <Modal title={item ? "Editar recorrência" : "Nova recorrência"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Descrição"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Aluguel, internet, salário..." /></Field>
        <MoneyField label="Valor" value={amount} onChange={setAmount} />
        <Field label="Tipo"><Select value={type} onChange={(event) => setType(event.target.value as "income" | "expense")}><option value="expense">Despesa</option><option value="income">Receita</option></Select></Field>
        <Field label="Frequência"><Select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="weekly:1">Toda semana</option><option value="weekly:2">A cada 15 dias</option><option value="monthly:1">Todo mês</option><option value="monthly:2">A cada 2 meses</option><option value="monthly:3">A cada 3 meses</option><option value="yearly:1">Todo ano</option></Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Começa em"><Input type="date" value={startOn} onChange={(event) => setStartOn(event.target.value)} /></Field><Field label="Termina em" hint="Opcional."><Input type="date" value={endOn} onChange={(event) => setEndOn(event.target.value)} /></Field></div>
        <Field label="Categoria"><Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Sem categoria</option>{data.categories.filter((category) => category.kind === type).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></Field>
        <Field label="Conta"><Select value={accountId} onChange={(event) => { setAccountId(event.target.value); if (event.target.value) setCardId(""); }}><option value="">Selecione</option>{data.accounts.filter((account) => !account.archived).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></Field>
        {type === "expense" ? <Field label="Ou cartão" hint="Assinatura no cartão entra na fatura, não na conta."><Select value={cardId} onChange={(event) => { setCardId(event.target.value); if (event.target.value) setAccountId(""); }}><option value="">Não é no cartão</option>{data.cards.filter((card) => !card.archived).map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</Select></Field> : null}
        <Field label="Observações"><TextArea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        <Button onClick={() => void save()}>Salvar</Button>
      </div>
    </Modal>
  );
}
