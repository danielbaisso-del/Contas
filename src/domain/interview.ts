import { resolveAmountCents, resolveOccurredOn, suggestCategory } from "@/domain/resolveText";
import { formatBRL, parseMoneyToCents } from "@/lib/money";
import { matchByName, normalizeText } from "@/lib/utils";
import type { InterviewState } from "@/domain/assistant";
import type { Account, FinanceData } from "@/types/models";

export function readAmountCents(text: string): number | null {
  const explicit = resolveAmountCents(text, null);
  if (explicit) return explicit;
  const stripped = text
    .replace(/\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b/g, " ")
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ");
  const match = stripped.match(/\b\d{1,7}(?:[.,]\d{1,2})?\b/);
  if (!match) return null;
  const cents = parseMoneyToCents(match[0]);
  if (cents == null || cents <= 0 || cents > 100_000_000_00) return null;
  return cents;
}

export function explicitDate(text: string, today: string): string | null {
  const trimmed = text.trim();
  if (/^\d{1,2}$/.test(trimmed)) {
    const day = Number(trimmed);
    if (day >= 1 && day <= 31) {
      const resolved = resolveOccurredOn(`dia ${day}`, today, null);
      return resolved.assumed ? null : resolved.date;
    }
  }
  const resolved = resolveOccurredOn(text, today, null);
  return resolved.assumed ? null : resolved.date;
}

function sourceText(text: string, accounts: Account[]): string {
  let cleaned = text;
  for (const account of accounts) {
    if (account.name.trim().length >= 2) cleaned = cleaned.replace(new RegExp(account.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  return cleaned
    .replace(/R\$\s*[\d.]+(?:,\d{1,2})?/gi, " ")
    .replace(/\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b/g, " ")
    .replace(/\b(hoje|ontem|amanh[aã]|dia)\s*\d{0,2}\b/gi, " ")
    .replace(/\b\d{1,7}(?:[.,]\d{1,2})?\b/g, " ")
    .replace(/\b(recebi|receber|recebido|receita|entrou|ganhei|gastei|gasto|despesa|paguei|pago|pagar|comprei|compra|vou|ainda|vai|devo|devendo|tenho|falta|quero|lancar|lan[cç]ar|de|do|da|no|na|em|para|pra|pro|o|a|os|as|um|uma|meu|minha|reais|real|conta|banco|valor|que|foi|foram|esse|essa|neste|nessa|mes|m[eê]s)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function continuesInterview(text: string, current: InterviewState, data: FinanceData, today: string): boolean {
  const normalized = normalizeText(text);
  if (text.includes("?") || /^(quanto|qual|quais|como|posso|mostra|mostre|explica|onde|me)\b/.test(normalized)) return false;
  const spoken = inferEntry(text);
  if (spoken && spoken !== current.kind) return false;
  const accounts = data.accounts.filter((account) => !account.archived);
  const hasAmount = readAmountCents(text) != null;
  const hasDate = explicitDate(text, today) != null;
  const hasAccount = matchByName(accounts, text) != null;
  if (current.amountCents != null && current.description && hasAmount && !(spoken === current.kind && hasDate)) return false;
  if (current.amountCents == null && hasAmount) return true;
  if (!current.occurredOn && hasDate && !hasAmount) return true;
  if (!current.accountId && hasAccount && !hasAmount) return true;
  if (!current.description && !hasAmount && text.trim().length >= 2 && text.trim().length <= 60) return true;
  return spoken === current.kind && (hasAmount || hasDate || hasAccount);
}

export function inferEntry(text: string): "income" | "paid" | "upcoming" | null {
  const normalized = normalizeText(text);
  if (/\b(recebi|receber|entrou|ganhei|receita)\b/.test(normalized)) return "income";
  if (/\b(vou pagar|ainda vou|vai vencer|vence dia|vence em|conta a pagar)\b/.test(normalized)) return "upcoming";
  if (/\b(devo|devendo|tenho que pagar)\b/.test(normalized)) {
    if (/^(quanto|qual|quais|como|me)\b/.test(normalized) && readAmountCents(text) == null) return null;
    if (readAmountCents(text) != null) return "upcoming";
    const rest = normalized.replace(/\b(eu|estou|to|devo|devendo|tenho|que|pagar|o|a|os|as|de|do|da|um|uma)\b/g, " ").replace(/\s+/g, " ").trim();
    if (rest.length >= 3) return "upcoming";
    return null;
  }
  if (/\b(paguei|gastei|comprei|despesa)\b/.test(normalized)) return "paid";
  return null;
}

function categoryNote(description: string, data: FinanceData, kind: InterviewState["kind"]): string {
  const type = kind === "income" ? "income" : "expense";
  const category = suggestCategory(description, data.categories, type, description);
  return category ? ` A categoria fica ${category.name}.` : ` Vou criar a categoria ${description}.`;
}

function openAccounts(data: FinanceData): Account[] {
  return data.accounts.filter((account) => !account.archived);
}

export function conductInterview(kind: InterviewState["kind"], text: string, current: InterviewState | null, data: FinanceData, today: string): { state: InterviewState; question: string | null; ready: boolean } {
  const accounts = openAccounts(data);
  const state: InterviewState = {
    kind,
    amountCents: current?.kind === kind ? current.amountCents : null,
    occurredOn: current?.kind === kind ? current.occurredOn : null,
    description: current?.kind === kind ? current.description : null,
    accountId: current?.kind === kind ? current.accountId : null,
  };
  if (state.accountId && !accounts.some((account) => account.id === state.accountId)) state.accountId = null;
  const normalized = normalizeText(text);
  if (state.amountCents != null && /\b(muda|altera|corrige|valor)\b/.test(normalized)) {
    const replacement = readAmountCents(text);
    if (replacement) state.amountCents = replacement;
  }
  if (state.amountCents == null) {
    const amount = readAmountCents(text);
    if (amount) state.amountCents = amount;
  }
  if (!state.occurredOn) {
    const date = explicitDate(text, today);
    if (date) state.occurredOn = date;
  }
  const named = matchByName(accounts, text);
  if (named) state.accountId = named.id;
  if (!state.description) {
    const source = sourceText(text, accounts);
    if (source.length >= 2 && !accounts.some((account) => normalizeText(account.name) === normalizeText(source))) state.description = source.charAt(0).toUpperCase() + source.slice(1);
  }
  if (!state.accountId && accounts.length === 1) state.accountId = accounts[0]?.id ?? null;

  if (!accounts.length) {
    return { state, ready: false, question: "Antes do valor, preciso saber onde o dinheiro está. Diga o nome da conta e quanto tem nela. Exemplo: Nubank com 1.200." };
  }
  if (state.amountCents == null) {
    return {
      state,
      ready: false,
      question: kind === "income"
        ? "Qual valor entrou? Pode responder só o número, por exemplo 3.200."
        : kind === "paid"
          ? "Qual valor saiu? Pode responder só o número, por exemplo 150."
          : "Qual é o valor que ainda vai pagar? Pode responder só o número, por exemplo 1.800.",
    };
  }
  if (!state.description) {
    return {
      state,
      ready: false,
      question: kind === "income"
        ? `Anotei ${formatBRL(state.amountCents)}. De onde veio esse dinheiro? Por exemplo: salário, cliente ou venda.`
        : kind === "paid"
          ? `Anotei ${formatBRL(state.amountCents)}. O que foi esse gasto? Por exemplo: mercado, aluguel ou internet.`
          : `Anotei ${formatBRL(state.amountCents)}. Qual é essa conta? Por exemplo: aluguel, luz ou escola.`,
    };
  }
  if (!state.occurredOn) {
    return {
      state,
      ready: false,
      question: kind === "upcoming"
        ? `Entendi: ${state.description} de ${formatBRL(state.amountCents)}.${categoryNote(state.description, data, kind)} Em que dia vence? Diga o dia, como 10 ou 10/11.`
        : `Entendi: ${state.description} de ${formatBRL(state.amountCents)}.${categoryNote(state.description, data, kind)} Em que dia foi? Diga hoje, ontem ou uma data, como 05/11.`,
    };
  }
  if (!state.accountId) {
    return {
      state,
      ready: false,
      question: kind === "income"
        ? `Para qual conta foram esses ${formatBRL(state.amountCents)}? Você tem: ${accounts.map((account) => account.name).join(", ")}.`
        : `De qual conta saiu? Você tem: ${accounts.map((account) => account.name).join(", ")}.`,
    };
  }
  return { state, question: null, ready: true };
}
