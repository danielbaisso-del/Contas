import { useEffect, useState } from "react";
import { AnswerChart } from "@/components/Charts";
import { PlaceLink } from "@/components/PlaceLink";
import { Button, Field, Input, MoneyField, PageHeader, Select } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import type { AssistantChart, AssistantPlace, AssistantResponse, Confirmation, TransactionDraft, TransferDraft } from "@/domain/assistant";
import { planCardInstallments } from "@/finance/installments";
import { formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { errorMessage } from "@/lib/utils";
import { askAssistant } from "@/services/ai";
import { loadAssistantMessages, saveAssistantMessage } from "@/services/data";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  confirmation: Confirmation | null;
  chart: AssistantChart | null;
  place: AssistantPlace | null;
}

export function AssistantPage() {
  const { refresh } = useFinance();
  const toast = useToast();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadAssistantMessages().then((messages) => {
      setItems(messages.map((message) => ({ id: message.id, role: message.role, content: message.content, confirmation: null, chart: null, place: null })));
    }).catch(() => undefined);
  }, []);

  async function send() {
    const content = text.trim();
    if (!content) return;
    setText("");
    const history = items.slice(-6).map((item) => ({ role: item.role, content: item.content }));
    setItems((current) => [...current, { id: crypto.randomUUID(), role: "user", content, confirmation: null, chart: null, place: null }]);
    setLoading(true);
    try {
      await saveAssistantMessage("user", content);
      const response = await askAssistant({ mode: "interpret", text: content, history });
      await saveAssistantMessage("assistant", response.reply, response.confirmation);
      setItems((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: response.reply, confirmation: response.confirmation, chart: response.chart ?? null, place: response.place ?? null }]);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally { setLoading(false); }
  }

  async function confirm(itemId: string, confirmation: Confirmation) {
    setLoading(true);
    try {
      const response: AssistantResponse = await askAssistant({ mode: "confirm", kind: confirmation.kind, draft: confirmation.draft });
      await saveAssistantMessage("assistant", response.reply);
      setItems((current) => current.map((item) => item.id === itemId ? { ...item, confirmation: null } : item).concat({ id: crypto.randomUUID(), role: "assistant", content: response.reply, confirmation: null, chart: null, place: response.place ?? null }));
      await refresh();
    } catch (error) { toast(errorMessage(error), "error"); } finally { setLoading(false); }
  }

  return (
    <div>
      <PageHeader title="Assistente Financeiro" description="Escreva como você falaria. Ele prepara o lançamento e só salva depois da confirmação. Os valores mostrados são calculados pelo sistema." />
      <div className="rounded-3xl border border-line bg-surface p-4">
        <div className="mb-4 space-y-3">
          {!items.length ? <p className="text-sm leading-6 text-muted">Experimente: “Recebi R$ 1.500 de um cliente”, “ontem gastei R$ 85 no supermercado” ou “quanto vai sobrar no fim do mês?”.</p> : null}
          {items.map((item) => (
            <div key={item.id} className={`max-w-3xl rounded-2xl px-4 py-3 text-sm leading-6 ${item.role === "user" ? "ml-auto bg-accent text-white" : "bg-surface-2"}`}>
              <p className="whitespace-pre-line">{item.content}</p>
              {item.chart ? <AnswerChart title={item.chart.title} kind={item.chart.kind} points={item.chart.points} /> : null}
              {item.place ? <PlaceLink place={item.place} /> : null}
              {item.confirmation ? <ConfirmationCard confirmation={item.confirmation} disabled={loading} onConfirm={(next) => void confirm(item.id, next)} /> : null}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={text} placeholder="Pergunte ou conte um lançamento. Exemplo: quanto gastei com mercado?" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} />
          <Button loading={loading} onClick={() => void send()}>Enviar</Button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmationCard({ confirmation, onConfirm, onDismiss, disabled, confirmLabel = "Confirmar e salvar" }: { confirmation: Confirmation; onConfirm: (value: Confirmation) => void; onDismiss?: () => void; disabled: boolean; confirmLabel?: string }) {
  const { data } = useFinance();
  const [draft, setDraft] = useState(confirmation.draft);
  const isAccount = confirmation.kind === "account";
  const isTransfer = confirmation.kind === "transfer";
  const transaction = !isTransfer && !isAccount ? draft as TransactionDraft : null;
  const transfer: TransferDraft | null = isTransfer ? draft as TransferDraft : null;
  const card = transaction?.card_id ? data.cards.find((item) => item.id === transaction.card_id) : null;
  const preview = transaction && card ? planCardInstallments({ totalCents: transaction.amount_cents, count: transaction.installments ?? 1, purchasedOn: transaction.occurred_on, closingDay: card.closingDay, dueDay: card.dueDay }) : [];
  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-surface p-3 text-ink">
      <p className="font-medium">{confirmation.title}</p>
      {confirmation.lines.map((line) => <p key={line} className="text-xs text-muted">{line}</p>)}
      {isAccount ? <p className="text-sm">Confira o nome e o saldo inicial. Se estiver errado, feche esta prévia e fale de novo.</p> : null}
      {transaction ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Descrição"><Input value={transaction.description} onChange={(event) => setDraft({ ...transaction, description: event.target.value })} /></Field>
          <MoneyField label="Valor" value={transaction.amount_cents} onChange={(value) => setDraft({ ...transaction, amount_cents: value ?? transaction.amount_cents })} />
          <Field label="Data"><Input type="date" value={transaction.occurred_on} onChange={(event) => setDraft({ ...transaction, occurred_on: event.target.value })} /></Field>
          <Field label="Categoria"><Select value={transaction.category_id ?? ""} onChange={(event) => setDraft({ ...transaction, category_id: event.target.value || null })}><option value="">Sem categoria</option>{data.categories.filter((item) => item.kind === transaction.type).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
          {transaction.card_id ? <Field label="Cartão"><Select value={transaction.card_id} onChange={(event) => setDraft({ ...transaction, card_id: event.target.value })}>{data.cards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : <Field label="Conta"><Select value={transaction.account_id ?? ""} onChange={(event) => setDraft({ ...transaction, account_id: event.target.value })}>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>}
        </div>
      ) : isTransfer ? (
        <div className="grid gap-3 md:grid-cols-2">
          <MoneyField label="Valor" value={transfer?.amount_cents ?? 0} onChange={(value) => { if (transfer) setDraft({ ...transfer, amount_cents: value ?? transfer.amount_cents }); }} />
          <Field label="Data"><Input type="date" value={transfer?.occurred_on ?? ""} onChange={(event) => { if (transfer) setDraft({ ...transfer, occurred_on: event.target.value }); }} /></Field>
        </div>
      ) : null}
      {preview.length ? <div className="text-xs text-muted">{preview.map((item) => <p key={item.number}>{item.number}/{item.total} vence em {formatDateBR(item.dueOn)} · {formatBRL(item.amountCents)}</p>)}</div> : null}
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={() => onConfirm({ ...confirmation, draft } as Confirmation)}>{confirmLabel}</Button>
        {onDismiss ? <Button variant="ghost" disabled={disabled} onClick={onDismiss}>Quero corrigir</Button> : null}
      </div>
    </div>
  );
}
