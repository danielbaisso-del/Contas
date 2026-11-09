import type { InterviewState } from "@/domain/assistant";
import { explicitDate, inferEntry, readAmountCents } from "@/domain/interview";
import { suggestCategory } from "@/domain/resolveText";
import { formatBRL } from "@/lib/money";
import { matchByName, normalizeText } from "@/lib/utils";
import type { FinanceData } from "@/types/models";

export interface UnderstoodDraft {
  description?: string | null;
  type?: "income" | "expense" | null;
  status?: "planned" | "pending" | "paid" | "received" | null;
  category_name?: string | null;
  account_name?: string | null;
  card_name?: string | null;
  payment_method?: string | null;
  installments?: number | null;
}

export interface LaunchDraft {
  description: string;
  amountCents: number;
  type: "income" | "expense";
  occurredOn: string;
  dueOn: string | null;
  status: "planned" | "pending" | "paid" | "received";
  accountId: string | null;
  cardId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  createCategory: string | null;
  installments: number;
  paymentMethod: "pix" | "debit" | "credit" | "cash" | "boleto" | "transfer" | "other" | null;
}

export interface GroundLaunch {
  reply: string;
  ready: boolean;
  draft: LaunchDraft | null;
  interview: InterviewState | null;
}

function descriptionFromText(text: string, data: FinanceData): string | null {
  let cleaned = text;
  for (const account of data.accounts) {
    if (account.name.trim().length >= 2) cleaned = cleaned.replace(new RegExp(account.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  const source = cleaned
    .replace(/R\$\s*[\d.]+(?:,\d{1,2})?/gi, " ")
    .replace(/\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b/g, " ")
    .replace(/\b(hoje|ontem|amanh[aã]|dia)\s*\d{0,2}\b/gi, " ")
    .replace(/\b\d{1,7}(?:[.,]\d{1,2})?\b/g, " ")
    .replace(/\b(recebi|receber|recebido|receita|entrou|ganhei|gastei|gasto|despesa|paguei|pago|pagar|comprei|compra|vou|ainda|vai|devo|devendo|tenho|falta|quero|lancar|lan[cç]ar|anota|anotar|anote|coloca|colocar|registra|registrar|de|do|da|no|na|em|para|pra|pro|o|a|os|as|um|uma|meu|minha|reais|real|conta|banco|valor|que|foi|foram|esse|essa|neste|nessa|mes|m[eê]s|tambem|tamb[eé]m|por|favor|ai|a[ií])\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleanName(source);
}

function cleanName(value: string | null | undefined): string | null {
  const text = value?.trim().replace(/\s+/g, " ") ?? "";
  if (text.length < 2 || text.length > 80) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function kindOf(text: string, draft: UnderstoodDraft | null): InterviewState["kind"] | null {
  const spoken = inferEntry(text);
  if (spoken) return spoken;
  if (draft?.type === "income") return "income";
  if (draft?.status === "pending" || draft?.status === "planned") return "upcoming";
  if (draft?.type === "expense") return "paid";
  return null;
}

function wantsCard(text: string, draft: UnderstoodDraft | null): boolean {
  return draft?.payment_method === "credit" || Boolean(draft?.card_name?.trim()) || /cart[aã]o|fatura|cr[eé]dito/.test(normalizeText(text));
}

export function groundLaunch(text: string, data: FinanceData, today: string, understood: string, draft: UnderstoodDraft | null): GroundLaunch {
  const kind = kindOf(text, draft);
  const accounts = data.accounts.filter((account) => !account.archived);
  const cards = data.cards.filter((card) => !card.archived);
  const lines: string[] = [];
  const amount = readAmountCents(text);
  const description = cleanName(draft?.description) ?? descriptionFromText(text, data);
  const date = explicitDate(text, today);
  const cardMode = wantsCard(text, draft);
  const namedAccount = cleanName(draft?.account_name);
  const namedCard = cleanName(draft?.card_name);
  let account = namedAccount ? matchByName(accounts, namedAccount) : matchByName(accounts, text);
  let card = namedCard ? matchByName(cards, namedCard) : matchByName(cards, text);

  if (!kind) {
    return { reply: `${understood || "Entendi a frase."}\n\nNão achei se isso é receita, despesa ou conta a pagar. Diga qual dos três é.`, ready: false, draft: null, interview: null };
  }
  if (namedAccount && !account) lines.push(`Não achei a conta ${namedAccount}. Você tem: ${accounts.map((item) => item.name).join(", ") || "nenhuma conta"}.`);
  else if (account) lines.push(`Achei a conta ${account.name}.`);
  else if (!cardMode && accounts.length === 1) {
    account = accounts[0] ?? null;
    if (account) lines.push(`Achei a conta ${account.name}.`);
  } else if (!cardMode) lines.push(`Não achei em qual conta lançar. Você tem: ${accounts.map((item) => item.name).join(", ") || "nenhuma conta"}.`);

  if (cardMode) {
    if (namedCard && !card) lines.push(`Não achei o cartão ${namedCard}. Você tem: ${cards.map((item) => item.name).join(", ") || "nenhum cartão"}.`);
    else if (card) lines.push(`Achei o cartão ${card.name}.`);
    else if (cards.length === 1) {
      card = cards[0] ?? null;
      if (card) lines.push(`Achei o cartão ${card.name}.`);
    } else lines.push(`Não achei o cartão. Você tem: ${cards.map((item) => item.name).join(", ") || "nenhum cartão"}.`);
  }

  const type = kind === "income" ? "income" : "expense";
  const category = description || namedAccount || text
    ? suggestCategory(`${text} ${description ?? ""}`, data.categories, type, draft?.category_name)
    : null;
  const createCategory = category ? null : description;
  if (category) lines.push(`Achei a categoria ${category.name}.`);
  else if (description) lines.push(`Não achei a categoria ${description}. Vou criar e lançar nela.`);

  const missing: string[] = [];
  if (amount == null) missing.push(kind === "income" ? "Qual valor entrou?" : kind === "paid" ? "Qual valor saiu?" : "Qual é o valor?");
  if (!description) missing.push(kind === "income" ? "De onde veio esse dinheiro?" : "Como se chama esse lançamento?");
  if (!date) missing.push(kind === "upcoming" ? "Em que dia vence?" : "Em que dia foi? Pode dizer hoje, ontem ou 10/11.");
  if (cardMode && !card) missing.push("Qual cartão?");
  if (!cardMode && !account) missing.push("Qual conta?");

  const intro = understood.trim() || (description && amount ? `Entendi: ${description} de ${formatBRL(amount)}.` : "Entendi o pedido.");
  const found = lines.length ? lines.join("\n") : "Não achei conta nem categoria para este pedido.";
  if (missing.length || amount == null || !description || !date || (cardMode ? !card : !account)) {
    const interview: InterviewState = {
      kind,
      amountCents: amount,
      occurredOn: date,
      description,
      accountId: cardMode ? null : account?.id ?? null,
    };
    return { reply: `${intro}\n\n${found}\n\n${missing[0] ?? "Falta um detalhe para eu lançar."}`, ready: false, draft: null, interview };
  }

  const future = date > today;
  const status = kind === "income"
    ? (future ? "planned" as const : "received" as const)
    : kind === "upcoming"
      ? (future ? "planned" as const : "pending" as const)
      : (future ? "planned" as const : "paid" as const);
  const installments = Math.min(48, Math.max(1, Math.round(draft?.installments || 1)));
  const payment = draft?.payment_method;
  const paymentMethod = cardMode
    ? "credit" as const
    : payment === "pix" || payment === "debit" || payment === "cash" || payment === "boleto" || payment === "transfer" || payment === "other"
      ? payment
      : null;
  return {
    reply: `${intro}\n\n${found}\n\nLancei no sistema.`,
    ready: true,
    interview: null,
    draft: {
      description,
      amountCents: amount,
      type,
      occurredOn: date,
      dueOn: kind === "upcoming" ? date : null,
      status,
      accountId: card ? null : account?.id ?? null,
      cardId: card?.id ?? null,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      createCategory,
      installments,
      paymentMethod,
    },
  };
}

export function groundTransfer(text: string, data: FinanceData, today: string, fromName: string | null | undefined, toName: string | null | undefined): { reply: string; ready: boolean; amountCents: number | null; date: string | null; fromId: string | null; toId: string | null } {
  const accounts = data.accounts.filter((account) => !account.archived);
  const amount = readAmountCents(text);
  const date = explicitDate(text, today);
  const from = matchByName(accounts, fromName);
  const to = matchByName(accounts, toName);
  const lines = [
    from ? `Achei a conta ${from.name}.` : `Não achei a conta de origem${fromName ? ` ${fromName}` : ""}. Você tem: ${accounts.map((item) => item.name).join(", ") || "nenhuma conta"}.`,
    to ? `Achei a conta ${to.name}.` : `Não achei a conta de destino${toName ? ` ${toName}` : ""}. Você tem: ${accounts.map((item) => item.name).join(", ") || "nenhuma conta"}.`,
  ];
  if (from && to && from.id === to.id) lines.push("As duas contas são a mesma. Escolha contas diferentes.");
  const missing = [
    amount == null ? "Qual valor da transferência?" : "",
    !date ? "Em que dia foi a transferência?" : "",
    !from || !to || from.id === to.id ? "Diga as duas contas." : "",
  ].filter(Boolean);
  const ready = missing.length === 0 && amount != null && date != null && from != null && to != null && from.id !== to.id;
  return {
    reply: `Entendi uma transferência.\n\n${lines.join("\n")}${ready ? "\n\nLancei no sistema." : `\n\n${missing[0]}`}`,
    ready,
    amountCents: amount,
    date,
    fromId: from?.id ?? null,
    toId: to?.id ?? null,
  };
}
