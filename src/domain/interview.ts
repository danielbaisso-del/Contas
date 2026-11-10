import { resolveAmountCents, resolveOccurredOn, suggestCategory } from "@/domain/resolveText";
import { formatBRL, parseMoneyToCents } from "@/lib/money";
import { matchByName, normalizeText } from "@/lib/utils";
import type { InterviewState } from "@/domain/assistant";
import type { Account, FinanceData } from "@/types/models";

export function readInstallmentCount(text: string): number | null {
  const match = text.match(/\b(\d{1,2})\s*x\b/i)
    ?? text.match(/\b(\d{1,2})\s*parcelas?\b/i)
    ?? text.match(/\bem\s+(\d{1,2})\s+vezes\b/i);
  if (!match) return null;
  const count = Number(match[1]);
  return count >= 2 && count <= 48 ? count : null;
}

export function wantsFixedBill(text: string): boolean {
  return /\b(conta fixa|todo mes|todos os meses|repete todo|fixa todo)\b/.test(normalizeText(text));
}

export function readAmountCents(text: string): number | null {
  const withoutPlan = text.replace(/\b\d{1,2}\s*(?:x|parcelas?|vezes)\b/gi, " ");
  const explicit = resolveAmountCents(withoutPlan, null);
  if (explicit) return explicit;
  const stripped = withoutPlan
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

export function accountPhrase(text: string): string | null {
  const withoutFixed = text.replace(/\bcontas?\s+fixas?\b/gi, " ");
  const match = withoutFixed.match(/\bcontas?\s+(?:do|da|de|no|na|o|a)?\s*([A-Za-zÀ-ú0-9][^,.;\n]{1,40})/i);
  if (!match?.[1]) return null;
  const name = match[1]
    .split(/\b(?:recebi|receber|recebido|hoje|ontem|amanh[aã]|reais|real|saldo|lance|lan[cç]ar|lanca|valor|que|falei|gastei|paguei|comprei|entrou|ganhei)\b/i)[0]
    ?.replace(/\b(do|da|de|no|na|o|a|e|com)$/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\d{1,7}(?:[.,]\d{1,2})?$/, "")
    .trim() ?? "";
  if (name.length < 2 || /^fix[ao]\b/i.test(name)) return null;
  return name;
}

export function rememberedText(history: unknown): string {
  if (!Array.isArray(history)) return "";
  return history
    .filter((item): item is { role?: string; content?: string } => !!item && typeof item === "object")
    .filter((item) => item.role === "user")
    .map((item) => String(item.content ?? "").trim())
    .filter((item) => item.length >= 2)
    .slice(-12)
    .join("\n");
}

function sourceText(text: string, accounts: Account[], extraNames: string[] = []): string {
  let cleaned = text;
  for (const name of [...accounts.map((account) => account.name), ...extraNames]) {
    if (name.trim().length >= 2) cleaned = cleaned.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  return cleaned
    .replace(/R\$\s*[\d.]+(?:,\d{1,2})?/gi, " ")
    .replace(/\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b/g, " ")
    .replace(/\b(hoje|ontem|amanh[aã]|dia)\s*\d{0,2}\b/gi, " ")
    .replace(/\b\d{1,7}(?:[.,]\d{1,2})?\b/g, " ")
    .replace(/\b(recebi|receber|recebido|receita|entrou|ganhei|gastei|gasto|despesa|paguei|pago|pagar|comprei|compra|vou|ainda|vai|devo|devendo|tenho|falta|quero|lancar|lan[cç]ar|lanca|crie|cria|criar|cadastra|ja|já|falei|disse|de|do|da|no|na|em|para|pra|pro|o|a|os|as|um|uma|meu|minha|reais|real|conta|banco|valor|que|foi|foram|esse|essa|neste|nessa|mes|m[eê]s|todo|todos|fixa|fixo|parcela|parcelas|parcelada|parcelado|vezes)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function usableDescription(text: string, accounts: Account[], extraNames: string[]): string | null {
  const source = sourceText(text, accounts, extraNames);
  if (source.length < 2) return null;
  const normalized = normalizeText(source);
  if (/^(ja falei|valor|conta|mercado pago)$/.test(normalized)) return null;
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function recentLines(context: string): string[] {
  return context.split("\n").map((line) => line.trim()).filter((line) => line.length >= 2).reverse();
}

export function continuesInterview(text: string, current: InterviewState, _data: FinanceData, today: string): boolean {
  const normalized = normalizeText(text);
  const amount = readAmountCents(text);
  const date = explicitDate(text, today);
  const asking = text.includes("?") || /^(quanto|qual|quais|como|posso|mostra|mostre|explica|onde|me)\b/.test(normalized);
  if (asking && amount == null && date == null && !matchByName(_data.accounts, text)) return false;
  if (/\b(ja falei|eu ja disse|como eu disse|como falei|te falei|ja disse|pode lancar|lance o valor|crie a conta|cria a conta|criar a conta|isso mesmo|essa mesma)\b/.test(normalized)) return true;
  const spoken = inferEntry(text);
  if (spoken && spoken !== current.kind && amount != null) return false;
  if (amount != null && current.amountCents != null && amount !== current.amountCents && text.trim().length > 18 && !/\b(muda|altera|corrige|nao|errei|troca)\b/.test(normalized)) return false;
  return true;
}

export function inferEntry(text: string): "income" | "paid" | "upcoming" | null {
  const normalized = normalizeText(text);
  if (/\b(recebi|receber|entrou|ganhei|receita|salario|holerite)\b/.test(normalized)) return "income";
  if (/\b(lance|lanca|lancar)\b/.test(normalized) && /\b(salario|receita|entrada|ganho)\b/.test(normalized)) return "income";
  if (/\b(vou pagar|ainda vou|vai vencer|vence dia|vence em|conta a pagar)\b/.test(normalized)) return "upcoming";
  if (/\b(devo|devendo|tenho que pagar)\b/.test(normalized)) {
    if (/^(quanto|qual|quais|como|me)\b/.test(normalized) && readAmountCents(text) == null) return null;
    if (readAmountCents(text) != null) return "upcoming";
    const rest = normalized.replace(/\b(eu|estou|to|devo|devendo|tenho|que|pagar|o|a|os|as|de|do|da|um|uma)\b/g, " ").replace(/\s+/g, " ").trim();
    if (rest.length >= 3) return "upcoming";
    return null;
  }
  if (/\b(paguei|gastei|comprei|despesa|gasto)\b/.test(normalized)) return "paid";
  if (/^(receita|entrada|ganho)$/.test(normalized) || /\b(e|eh) (uma )?(receita|entrada)\b/.test(normalized)) return "income";
  if (/^(despesa|gasto|saida)$/.test(normalized) || /\b(e|eh) (uma )?(despesa|gasto)\b/.test(normalized)) return "paid";
  if (/^(a pagar|conta a pagar)$/.test(normalized)) return "upcoming";
  if (/\b(anota|anotar|anote|registra|registrar|coloca|colocar|adiciona|adicionar|lanca|lancar|lance)\b/.test(normalized)) {
    if (/\b(recebi|receber|receita|salario|entrada|ganho|ganhei)\b/.test(normalized)) return "income";
    if (/\b(devo|vencer|vence|a pagar|boleto)\b/.test(normalized)) return "upcoming";
    if (readAmountCents(text) != null) return "paid";
  }
  if (wantsFixedBill(text) || readInstallmentCount(text) != null) return readAmountCents(text) == null && /^(quanto|qual|quais)\b/.test(normalized) ? null : "upcoming";
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

export function conductInterview(kind: InterviewState["kind"], text: string, current: InterviewState | null, data: FinanceData, today: string, context = ""): { state: InterviewState; question: string | null; ready: boolean } {
  const accounts = openAccounts(data);
  const state: InterviewState = {
    kind,
    amountCents: current?.kind === kind ? current.amountCents : null,
    occurredOn: current?.kind === kind ? current.occurredOn : null,
    description: current?.kind === kind ? current.description : null,
    accountId: current?.kind === kind ? current.accountId : null,
    installments: current?.kind === kind ? current.installments ?? null : null,
    fixed: current?.kind === kind ? current.fixed === true : false,
    pendingAccountName: current?.kind === kind ? current.pendingAccountName ?? null : null,
  };
  const counted = readInstallmentCount(text) ?? (context ? readInstallmentCount(context) : null);
  if (counted) state.installments = counted;
  if (wantsFixedBill(text) || (context && wantsFixedBill(context))) state.fixed = true;
  if ((state.installments ?? 1) > 1) state.fixed = false;
  if (state.accountId && !data.accounts.some((account) => account.id === state.accountId)) state.accountId = null;
  const normalized = normalizeText(text);
  if (state.amountCents != null && /\b(muda|altera|corrige|valor)\b/.test(normalized)) {
    const replacement = readAmountCents(text);
    if (replacement) state.amountCents = replacement;
  }
  const remembered = context ? recentLines(context) : [];
  const spokenNow = inferEntry(text);
  if (spokenNow && readAmountCents(text) == null) state.kind = spokenNow;
  if (state.amountCents == null) state.amountCents = readAmountCents(text) ?? remembered.map(readAmountCents).find((value) => value != null) ?? null;
  if (!state.occurredOn) state.occurredOn = explicitDate(text, today) ?? remembered.map((line) => explicitDate(line, today)).find((value) => value != null) ?? null;
  const phrase = accountPhrase(text) ?? remembered.map((line) => accountPhrase(line)).find((value) => value != null) ?? null;
  const named = (phrase ? matchByName(data.accounts, phrase) : null) ?? matchByName(data.accounts, text) ?? remembered.map((line) => matchByName(data.accounts, line)).find((value) => value != null) ?? null;
  if (named) {
    state.accountId = named.id;
    state.pendingAccountName = null;
  } else if (!state.accountId && phrase) state.pendingAccountName = phrase;
  else if (!state.accountId && !phrase && accounts.length === 0 && text.trim().length >= 2 && text.trim().length <= 40 && !/\d/.test(text) && !/\b(ja falei|falei|disse|salario|salário)\b/.test(normalized)) {
    state.pendingAccountName = text.trim();
  }
  const kindOnly = spokenNow != null && readAmountCents(text) == null && explicitDate(text, today) == null && text.trim().length <= 32;
  if (!state.description) {
    const description = [text, ...remembered]
      .map((line) => usableDescription(line, accounts, phrase ? [phrase] : []))
      .find((value) => value && normalizeText(value) !== normalizeText(state.pendingAccountName ?? ""));
    if (description) state.description = description;
  }
  if (!state.description && current?.amountCents != null && !kindOnly && readAmountCents(text) == null && explicitDate(text, today) == null) {
    const direct = text.trim().replace(/[.!?]+$/g, "");
    const plain = normalizeText(direct);
    if (direct.length >= 2 && direct.length <= 60 && !/^(ja falei|isso|ok|sim|nao|pode lancar|pode salvar)$/.test(plain)) {
      state.description = direct.charAt(0).toUpperCase() + direct.slice(1);
    }
  }
  if (!state.accountId && !state.pendingAccountName && accounts.length === 1) state.accountId = accounts[0]?.id ?? null;
  if (!state.accountId && !state.pendingAccountName && data.accounts.length === 1) state.accountId = data.accounts[0]?.id ?? null;

  if (!accounts.length && !state.accountId && !state.pendingAccountName) {
    const archived = data.accounts.filter((account) => account.archived).map((account) => account.name);
    return {
      state,
      ready: false,
      question: archived.length
        ? `A conta está arquivada: ${archived.join(", ")}. Diga o nome que eu reativo e continuo o lançamento.`
        : "Não achei nenhuma conta. Diga o nome, por exemplo: conta Mercado Pago. Eu crio se ela ainda não existir e continuo o lançamento.",
    };
  }
  if (state.amountCents == null) {
    const chosen = state.accountId ? data.accounts.find((account) => account.id === state.accountId) : null;
    const place = chosen
      ? ` A conta é ${chosen.name}${chosen.archived ? ", e eu reativo ela ao salvar" : ""}.`
      : state.pendingAccountName
        ? ` Vou criar a conta ${state.pendingAccountName}.`
        : "";
    const known = state.description ? ` Já anotei ${state.description}.` : "";
    return {
      state,
      ready: false,
      question: state.kind === "income"
        ? `Qual valor entrou?${place}${known} Pode responder só o número, por exemplo 3.200.`
        : state.kind === "paid"
          ? `Qual valor saiu?${place}${known} Pode responder só o número, por exemplo 150.`
          : `Qual é o valor que ainda vai pagar?${place}${known} Pode responder só o número, por exemplo 1.800.`,
    };
  }
  if (!state.description) {
    return {
      state,
      ready: false,
      question: state.kind === "income"
        ? `Anotei ${formatBRL(state.amountCents)}. De onde veio esse dinheiro? Por exemplo: salário, cliente ou venda.`
        : state.kind === "paid"
          ? `Anotei ${formatBRL(state.amountCents)}. O que foi esse gasto? Por exemplo: mercado, aluguel ou internet.`
          : `Anotei ${formatBRL(state.amountCents)}. Qual é essa conta? Por exemplo: aluguel, luz ou escola.`,
    };
  }
  if (!state.occurredOn) {
    return {
      state,
      ready: false,
      question: state.kind === "upcoming"
        ? `Entendi: ${state.description} de ${formatBRL(state.amountCents)}.${categoryNote(state.description, data, state.kind)} Em que dia vence? Diga o dia, como 10 ou 10/11.`
        : `Entendi: ${state.description} de ${formatBRL(state.amountCents)}.${categoryNote(state.description, data, state.kind)} Em que dia foi? Diga hoje, ontem ou uma data, como 05/11.`,
    };
  }
  if (!state.accountId && !state.pendingAccountName) {
    const names = accounts.map((account) => account.name).join(", ") || "nenhuma conta";
    return {
      state,
      ready: false,
      question: state.kind === "income"
        ? `Para qual conta foram esses ${formatBRL(state.amountCents)}? Você tem: ${names}. Se o nome não existir, eu crio.`
        : `De qual conta saiu? Você tem: ${names}. Se o nome não existir, eu crio.`,
    };
  }
  return { state, question: null, ready: true };
}
