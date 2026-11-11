import type { InterviewState } from "@/domain/assistant";
import { explicitDate, readAmountCents, readInstallmentCount, recentLines } from "@/domain/interview";
import { formatBRL } from "@/lib/money";
import { normalizeText } from "@/lib/utils";

export interface SimpleResult {
  state: InterviewState | null;
  question: string | null;
  ready: boolean;
}

function emptyState(): InterviewState {
  return {
    kind: "unset",
    amountCents: null,
    occurredOn: null,
    description: null,
    accountId: null,
    installments: null,
    perInstallment: false,
    askInstallments: false,
  };
}

function kindOf(text: string): InterviewState["kind"] | null {
  const normalized = normalizeText(text);
  if (/^(gasto|despesa)$/.test(normalized) || /\b(gastei|gasto|despesa|paguei|pago|pagar|comprei|compra)\b/.test(normalized)) return "paid";
  if (/^(recebido|receita|recebimento)$/.test(normalized) || /\b(recebi|receber|recebido|ganhei|entrou|receita|recebimento|salario)\b/.test(normalized)) return "income";
  if (/\b(\d{1,2}\s*(?:x|parcelas?|vezes)|parcel)/.test(normalized)) return "paid";
  return null;
}

function entryName(text: string): string | null {
  const source = text
    .replace(/\b\d{1,2}\s*(?:x|parcelas?|vezes)\s*(?:de\s*)?/gi, " ")
    .replace(/R\$\s*[\d.]+(?:,\d{1,2})?/gi, " ")
    .replace(/\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b/g, " ")
    .replace(/\b(hoje|ontem|amanh[aã])\b/gi, " ")
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b\d{1,7}(?:[.,]\d{1,2})?\b/g, " ")
    .replace(/\b(recebi|receber|recebido|ganhei|entrou|receita|recebimento|gastei|gasto|gastos|despesa|paguei|pago|pagar|comprei|compra|lancar|lan[cç]ar|lanca|lance|anota|anotar|coloca|colocar|de|do|da|no|na|em|para|pra|um|uma|o|a|os|as|meu|minha|reais|real|valor|que|foi|quero|por|favor|parcelado|parcelada|parcelados|vezes|parcela|parcelas|nome|chamado|chamada)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (source.length < 2) return null;
  const plain = normalizeText(source);
  if (/^(gasto|despesa|recebido|receita|recebimento|hoje|ontem|parcelado)$/.test(plain)) return null;
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function installmentPlan(text: string): { count: number | null; perInstallment: boolean; asked: boolean } | null {
  const each = text.match(/\b(\d{1,2})\s*(?:x|parcelas?|vezes)\s*de\b/i);
  if (each) {
    const count = Number(each[1]);
    if (count >= 2 && count <= 48) return { count, perInstallment: true, asked: true };
  }
  const count = readInstallmentCount(text);
  if (count) return { count, perInstallment: false, asked: true };
  if (/\bparcelad[oa]s?\b/i.test(text)) return { count: null, perInstallment: false, asked: true };
  return null;
}

function applyText(state: InterviewState, text: string, today: string, slot: "kind" | "name" | "amount" | "date" | "count" | null) {
  const kind = kindOf(text);
  const amount = readAmountCents(text);
  const date = explicitDate(text, today);
  const name = entryName(text);
  const plan = installmentPlan(text);
  const bareCount = text.trim().match(/^(\d{1,2})$/);
  if (slot === "kind" && kind && kind !== "unset") state.kind = kind;
  else if (!slot && kind && state.kind === "unset") state.kind = kind;
  else if (kind && state.kind === "unset") state.kind = kind;
  if (slot === "count" && bareCount) {
    const count = Number(bareCount[1]);
    if (count >= 2 && count <= 48) state.installments = count;
  }
  if (plan?.asked) state.askInstallments = true;
  if (plan?.count) state.installments = plan.count;
  if (plan?.perInstallment) state.perInstallment = true;
  if (slot === "amount" && amount) state.amountCents = amount;
  else if (slot !== "count" && state.amountCents == null && amount) state.amountCents = amount;
  if (slot === "date" && date) state.occurredOn = date;
  else if (slot !== "count" && slot !== "amount" && !state.occurredOn && date) state.occurredOn = date;
  if (slot === "name" && text.trim().length >= 2 && !bareCount && !date && amount == null) {
    state.description = name ?? (text.trim().charAt(0).toUpperCase() + text.trim().slice(1, 80));
  } else if (!state.description && name) state.description = name;
}

function missing(state: InterviewState): "kind" | "name" | "amount" | "date" | "count" | null {
  if (state.kind !== "income" && state.kind !== "paid") return "kind";
  if (!state.description) return "name";
  if (state.amountCents == null) return "amount";
  if (!state.occurredOn) return "date";
  if (state.askInstallments && (state.installments == null || state.installments < 2)) return "count";
  return null;
}

function questionFor(state: InterviewState): string {
  const slot = missing(state);
  const what = state.kind === "income" ? "recebimento" : "gasto";
  if (slot === "kind") return "Isso é um gasto ou um valor recebido?";
  if (slot === "name") return state.kind === "income" ? "Qual é o nome desse recebimento?" : "Qual é o nome desse gasto?";
  if (slot === "amount") return `Qual é o valor de ${state.description}?`;
  if (slot === "date") return `Em que data foi ${state.description}? Pode dizer hoje, ontem ou 10/11.`;
  if (slot === "count") return `Em quantas vezes parcela ${state.description}${state.amountCents ? ` de ${formatBRL(state.amountCents)}` : ""}? Diga só o número, por exemplo 3.`;
  return `Diga o nome, o valor e a data do ${what}.`;
}

const HELP = "Eu só lanço gasto e recebimento. Diga o nome, o valor e a data. Exemplo: gastei 80 de mercado hoje. Se for parcelado, diga em quantas vezes.";

export function simpleChips(state: InterviewState | null): string[] {
  if (!state) return [];
  const slot = missing(state);
  if (slot === "kind") return ["Gasto", "Recebido"];
  if (slot === "date") return ["hoje", "ontem"];
  if (slot === "count") return ["2", "3", "6", "12"];
  return [];
}

export function conductSimple(text: string, current: InterviewState | null, today: string, context = ""): SimpleResult {
  const incoming = emptyState();
  applyText(incoming, text, today, null);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const fresh = words >= 3 && incoming.amountCents != null && (incoming.kind === "income" || incoming.kind === "paid");
  const state: InterviewState = fresh ? incoming : current ? { ...emptyState(), ...current, accountId: null, pendingAccountName: null } : emptyState();
  const opened = !fresh && current != null && (current.description != null || current.amountCents != null || current.occurredOn != null || current.kind === "income" || current.kind === "paid" || current.askInstallments === true);
  if (!fresh) {
    const before = missing(opened ? state : emptyState());
    applyText(state, text, today, opened ? before : null);
    if (opened) {
      for (const line of recentLines(context)) {
        if (!missing(state)) break;
        applyText(state, line, today, null);
      }
    }
  }
  const slot = missing(state);
  const learned = state.kind === "income" || state.kind === "paid" || state.description || state.amountCents || state.occurredOn || state.askInstallments;
  if (!learned) return { state: opened ? state : null, question: opened ? `${HELP}\n\n${questionFor(state)}` : HELP, ready: false };
  if (slot) return { state, question: questionFor(state), ready: false };
  return { state, question: null, ready: true };
}
