import { accountDraftSchema, intentSchema, transactionDraftSchema, transferDraftSchema, type AssistantPlace, type AssistantResponse, type TransactionDraft } from "@/domain/assistant";
import { resolveAmountCents, resolveOccurredOn, suggestCategory } from "@/domain/resolveText";
import { buildDashboard } from "@/finance/engine";
import { planBankInstallments, planCardInstallments, installmentsForDatabase } from "@/finance/installments";
import { formatDateBR, monthKey, todayISO } from "@/lib/dates";
import { accountTypeLabel, COLORS, paymentMethodLabel, statusLabel } from "@/lib/labels";
import { formatBRL, parseMoneyToCents } from "@/lib/money";
import { matchByName, normalizeText } from "@/lib/utils";
import { mapAccount, mapCard, mapCategory, mapInvoice, mapRecurrence, mapTransaction } from "@/services/mappers";
import type { FinanceData } from "@/types/models";
import { answerQuery, chartForQuery, placeAfterSave, placeForQuery, placeFromText } from "./answers";
import { householdBundle } from "./household";
import { geminiJson, parseModelJson } from "./gemini";
import { HttpError, readJson, sendJson, type NodeRequest, type NodeResponse } from "./http";
import { consumeAiQuota, requireUser, userClient } from "./supabase";

const SYSTEM = `Você interpreta pedidos do Assistente Financeiro do aplicativo Contas.
Devolva somente JSON. Não calcule saldo, não invente valor e não escreva SQL.
Datas em YYYY-MM-DD. amount_cents é inteiro em centavos: R$ 85 vira 8500 e R$ 1.500,50 vira 150050.
Recebi ou salário = income. Gastei, paguei ou comprei = expense. Transferi entre contas = create_transfer.
Pergunta sobre saldo, gasto, sobra, categoria, previsão ou "posso comprar" = query. Não responda o número. Qualquer pergunta sobre os dados da pessoa é query, mesmo que não peça para lançar.
Se faltar dado para lançar, use action clarify.
Formato:
{"action":"chat|clarify|create_transaction|create_transfer|query","message":"","missing":[],"draft":{"description":"","amount_cents":0,"type":"expense","occurred_on":"","due_on":null,"category_name":null,"account_name":null,"card_name":null,"payment_method":null,"notes":null,"status":null,"installments":1},"transfer":{"description":"Transferência","amount_cents":0,"occurred_on":"","from_account_name":"","to_account_name":""},"query":{"metric":"available_balance|month_overview|forecast|category_total|upcoming|can_afford|account_balance","category_name":null,"account_name":null,"month":null,"months":null,"days":null,"amount_cents":null,"installments":null,"payment":null,"starting_on":null}}`;

function forcedQuery(text: string) {
  const lower = normalizeText(text);
  if (/posso comprar|se eu comprar|cabe no orcamento/.test(lower)) return { metric: "can_afford" as const };
  if (/vai sobrar|fim do mes|previsao|proximos dias|\b30 dias\b|\b60 dias\b|\b90 dias\b/.test(lower)) return { metric: "forecast" as const };
  if (/quanto gastei|gastos com|gastei com/.test(lower)) return { metric: "category_total" as const };
  if (/proximas contas|contas a pagar|o que tenho para pagar/.test(lower)) return { metric: "upcoming" as const };
  if (/quanto tenho|quanto eu tenho|saldo|dinheiro tenho/.test(lower)) return { metric: "available_balance" as const };
  return null;
}

function inferType(text: string): "income" | "expense" | null {
  const lower = normalizeText(text);
  if (/recebi|receber|salario|cliente pagou|entrou/.test(lower)) return "income";
  if (/gastei|gasto|paguei|pagar|comprei|compra|despesa/.test(lower)) return "expense";
  return null;
}

function inferInstallments(text: string): number | null {
  const match = text.match(/\b(\d{1,2})\s*x\b/i) ?? text.match(/\b(\d{1,2})\s*parcelas?\b/i);
  if (!match) return null;
  const count = Number(match[1]);
  return count >= 1 && count <= 48 ? count : null;
}

async function loadData(token: string): Promise<FinanceData> {
  const client = userClient(token);
  const tables = ["accounts", "categories", "credit_cards", "transactions", "recurrences", "card_invoices"] as const;
  const result = await Promise.all(tables.map(async (table) => {
    const rows: Record<string, unknown>[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await client.from(table).select("*").range(from, from + 999);
      if (error) {
        if (/relation|schema cache/i.test(error.message)) throw new HttpError(500, "O banco ainda não tem as tabelas. Execute a migration SQL do projeto.");
        throw new HttpError(500, "Não consegui ler seus dados para responder com segurança.");
      }
      const batch = (data ?? []) as Record<string, unknown>[];
      rows.push(...batch);
      if (batch.length < 1000) break;
      from += 1000;
    }
    return rows;
  }));
  const [accounts, categories, cards, transactions, recurrences, invoices] = result;
  return {
    accounts: accounts.map(mapAccount),
    categories: categories.map(mapCategory),
    cards: cards.map(mapCard),
    transactions: transactions.map(mapTransaction),
    recurrences: recurrences.map(mapRecurrence),
    invoices: invoices.map(mapInvoice),
    goals: [],
    contributions: [],
  };
}

function buildTransaction(text: string, draft: NonNullable<Awaited<ReturnType<typeof interpretIntent>>>["draft"], data: FinanceData, today: string): AssistantResponse {
  const type = draft?.type ?? inferType(text);
  if (!type) return { reply: "Isso é uma receita ou uma despesa?", confirmation: null };
  const amount = resolveAmountCents(text, draft?.amount_cents);
  if (!amount) return { reply: "Qual é o valor? Escreva, por exemplo, R$ 85,00.", confirmation: null };
  const description = (draft?.description ?? "").trim() || text.replace(/R\$\s*[\d.,]+/g, "").trim();
  if (description.trim().length < 2) return { reply: "Como você quer chamar esse lançamento?", confirmation: null };
  const occurred = resolveOccurredOn(text, today, draft?.occurred_on);
  const installments = Math.min(48, Math.max(1, Math.round(draft?.installments || inferInstallments(text) || 1)));
  const accounts = data.accounts.filter((account) => !account.archived);
  const cards = data.cards.filter((card) => !card.archived);
  const wantsCard = draft?.payment_method === "credit" || Boolean(draft?.card_name) || /cart[aã]o/i.test(text);
  let card = matchByName(cards, draft?.card_name);
  let account = matchByName(accounts, draft?.account_name);
  if (wantsCard && !card && cards.length === 1) card = cards[0] ?? null;
  if (!card && !account && accounts.length === 1) account = accounts[0] ?? null;
  if (type === "income" && !account) {
    return { reply: accounts.length ? `Entendi uma receita de ${formatBRL(amount)}. Em qual conta ela entra? Você tem: ${accounts.map((item) => item.name).join(", ")}.` : "Cadastre uma conta antes. A receita precisa ter onde entrar.", confirmation: null };
  }
  if (type === "expense" && wantsCard && !card) {
    return { reply: cards.length ? `Entendi a compra de ${formatBRL(amount)}. Qual cartão? Você tem: ${cards.map((item) => item.name).join(", ")}.` : "Você ainda não cadastrou um cartão. Pode lançar em uma conta ou criar o cartão antes.", confirmation: null };
  }
  if (type === "expense" && !card && !account) {
    return { reply: accounts.length ? `Entendi a despesa de ${formatBRL(amount)}. De qual conta saiu? Você tem: ${accounts.map((item) => item.name).join(", ")}.` : "Cadastre uma conta antes de lançar essa despesa.", confirmation: null };
  }
  const category = suggestCategory(text, data.categories, type, draft?.category_name);
  const requested = draft?.status;
  const status = type === "income"
    ? requested === "planned" || requested === "pending" || requested === "received" ? requested : occurred.date > today ? "planned" : "received"
    : requested === "planned" || requested === "pending" || requested === "paid" ? requested : occurred.date > today ? "planned" : "paid";
  const safeDescription = description.trim().slice(0, 140);
  const transaction: TransactionDraft = {
    description: safeDescription,
    amount_cents: amount,
    type,
    occurred_on: occurred.date,
    due_on: draft?.due_on && /^\d{4}-\d{2}-\d{2}$/.test(draft.due_on) ? draft.due_on : null,
    status,
    category_id: category?.id ?? null,
    account_id: card ? null : account?.id ?? null,
    card_id: card?.id ?? null,
    payment_method: card ? "credit" : draft?.payment_method ?? null,
    notes: draft?.notes?.slice(0, 500) ?? null,
    installments,
  };
  const lines = [
    `${type === "income" ? "Receita" : "Despesa"} de ${formatBRL(amount)}`,
    `Descrição: ${safeDescription}`,
    `Data: ${formatDateBR(occurred.date)}${occurred.assumed ? " — usei hoje porque a frase não trouxe outra data" : ""}`,
    `Categoria: ${category?.name ?? "sem categoria"}`,
    card ? `Cartão: ${card.name}. A compra não sai da conta agora; ela entra na fatura.` : `Conta: ${account?.name ?? "—"}`,
    installments > 1 ? `${installments} parcelas` : "À vista",
    `Status: ${statusLabel(status, type)}`,
    transaction.payment_method ? `Forma: ${paymentMethodLabel(transaction.payment_method)}` : "",
  ].filter(Boolean);
  return {
    reply: "Separei a prévia abaixo. Nada foi salvo. Confira os campos e confirme só se estiver certo.",
    confirmation: {
      kind: card ? "card_purchase" : installments > 1 ? "bank_installments" : "transaction",
      title: "Prévia do lançamento",
      lines,
      draft: transaction,
    },
  };
}

async function interpretIntent(prompt: string) {
  const first = parseModelJson(await geminiJson(prompt, SYSTEM));
  const parsed = intentSchema.safeParse(first);
  if (parsed.success) return parsed.data;
  const second = parseModelJson(await geminiJson(`${prompt}\n\nO JSON anterior era inválido. Responda só o JSON no formato pedido.`, SYSTEM));
  const again = intentSchema.safeParse(second);
  if (!again.success) throw new HttpError(422, "Não consegui organizar esse pedido. Tente uma frase direta, como: gastei R$ 85 no mercado hoje.");
  return again.data;
}

function buildTransfer(text: string, raw: NonNullable<Awaited<ReturnType<typeof interpretIntent>>>["transfer"], data: FinanceData, today: string): AssistantResponse {
  const amount = resolveAmountCents(text, raw?.amount_cents);
  if (!amount) return { reply: "Qual valor você quer transferir?", confirmation: null };
  const accounts = data.accounts.filter((account) => !account.archived);
  const from = matchByName(accounts, raw?.from_account_name);
  const to = matchByName(accounts, raw?.to_account_name);
  if (!from || !to) {
    return { reply: `Entre quais contas? Você tem: ${accounts.map((account) => account.name).join(", ") || "nenhuma conta"}.`, confirmation: null };
  }
  if (from.id === to.id) return { reply: "Escolha duas contas diferentes. Transferência não é receita nem despesa.", confirmation: null };
  const occurred = resolveOccurredOn(text, today, raw?.occurred_on);
  return {
    reply: "A transferência só muda o lugar do dinheiro. Ela não entra como receita nem como despesa. Confirme para salvar.",
    confirmation: {
      kind: "transfer",
      title: "Prévia da transferência",
      lines: [`${formatBRL(amount)} de ${from.name} para ${to.name}`, `Data: ${formatDateBR(occurred.date)}`],
      draft: {
        description: raw?.description?.trim() || `Transferência para ${to.name}`,
        amount_cents: amount,
        occurred_on: occurred.date,
        from_account_id: from.id,
        to_account_id: to.id,
      },
    },
  };
}

function amountFromSpeech(text: string): number | null {
  const normalized = normalizeText(text);
  if (/\b(zero|zerada|zerado|sem saldo)\b/.test(normalized)) return 0;
  const explicit = resolveAmountCents(text, null);
  if (explicit) return explicit;
  const match = text.match(/\b\d{1,3}(?:\.\d{3})+(?:,\d{2})?\b|\b\d+(?:,\d{2})\b|\b\d{1,7}\b/);
  if (!match) return null;
  const cents = parseMoneyToCents(match[0]);
  if (cents == null || cents < 0) return null;
  return cents;
}

function accountNameFrom(text: string): string {
  return text
    .replace(/R\$\s*[\d.]+(?:,\d{1,2})?/gi, " ")
    .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d{2})?\b/g, " ")
    .replace(/\b\d+(?:,\d{2})\b/g, " ")
    .replace(/\b\d{1,7}\b/g, " ")
    .replace(/\b(tenho|tem|tinha|com|saldo|reais|real|minha|meu|uns|cerca|de|da|do|na|no|em|a|o|hoje|agora|conta|banco)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function inferAccountType(text: string): "checking" | "savings" | "cash" | "digital" | "other" {
  const normalized = normalizeText(text);
  if (/dinheiro|especie|bolso|carteira fisica/.test(normalized)) return "cash";
  if (/poupanca|reserva/.test(normalized)) return "savings";
  if (/mercado pago|picpay|paypal|carteira digital/.test(normalized)) return "digital";
  return "checking";
}

function buildAccount(text: string, data: FinanceData, earlier: string): AssistantResponse {
  const corpus = `${earlier}\n${text}`;
  const amount = amountFromSpeech(text) ?? amountFromSpeech(corpus);
  const name = accountNameFrom(text) || accountNameFrom(earlier);
  if (!name || name.length < 2) {
    return { reply: "Qual é o nome dessa conta? Exemplo: Nubank com R$ 1.200.", confirmation: null };
  }
  if (amount == null) {
    return { reply: `Quanto tem na conta ${name} agora? Pode ser zero.`, confirmation: null };
  }
  const existing = data.accounts.find((account) => normalizeText(account.name) === normalizeText(name));
  if (existing) {
    return { reply: `A conta ${existing.name} já existe. Fale outra conta ou diga: só isso.`, confirmation: null };
  }
  const type = inferAccountType(`${name} ${text}`);
  return {
    reply: "Vou criar a conta com esse saldo inicial. Esse valor é o dinheiro que já está lá, não uma receita nova. Confirme se estiver certo.",
    confirmation: {
      kind: "account",
      title: "Nova conta",
      lines: [name, `Saldo inicial: ${formatBRL(amount)}`, `Tipo: ${accountTypeLabel(type)}`],
      draft: {
        name,
        institution: name,
        type,
        initial_balance_cents: amount,
        color: COLORS[data.accounts.length % COLORS.length] ?? COLORS[0],
      },
    },
  };
}

async function confirmDraft(token: string, body: Record<string, unknown>, data: FinanceData): Promise<{ reply: string; place: AssistantPlace }> {
  const client = userClient(token);
  const today = todayISO();
  const { data: auth } = await client.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) throw new HttpError(401, "Sua sessão expirou. Entre novamente.");
  if (body.kind === "account") {
    const parsed = accountDraftSchema.safeParse(body.draft);
    if (!parsed.success) throw new HttpError(400, "A prévia da conta está incompleta. Fale o nome e o saldo de novo.");
    const draft = parsed.data;
    if (data.accounts.some((account) => normalizeText(account.name) === normalizeText(draft.name))) {
      throw new HttpError(400, "Já existe uma conta com esse nome.");
    }
    const { error } = await client.from("accounts").insert({
      user_id: userId,
      name: draft.name,
      institution: draft.institution,
      type: draft.type,
      initial_balance_cents: draft.initial_balance_cents,
      color: draft.color,
    });
    if (error) throw new HttpError(400, "Não consegui criar a conta.");
    return { reply: `Conta ${draft.name} criada com saldo inicial de ${formatBRL(draft.initial_balance_cents)}.\n\nA tela Contas já mostra este saldo.`, place: placeAfterSave("account", {}) };
  }
  if (body.kind === "transfer") {
    const parsed = transferDraftSchema.safeParse(body.draft);
    if (!parsed.success) throw new HttpError(400, "A prévia da transferência está incompleta. Monte o pedido novamente.");
    const draft = parsed.data;
    if (draft.from_account_id === draft.to_account_id) throw new HttpError(400, "Escolha duas contas diferentes.");
    if (!data.accounts.some((account) => account.id === draft.from_account_id) || !data.accounts.some((account) => account.id === draft.to_account_id)) {
      throw new HttpError(400, "Uma das contas não pertence a você.");
    }
    const { error } = await client.from("transactions").insert({
      user_id: userId,
      description: draft.description,
      amount_cents: draft.amount_cents,
      type: "transfer",
      account_id: draft.from_account_id,
      destination_account_id: draft.to_account_id,
      occurred_on: draft.occurred_on,
      status: draft.occurred_on > today ? "planned" : "paid",
      payment_method: "transfer",
    });
    if (error) throw new HttpError(400, "Não consegui salvar a transferência.");
    return { reply: `Transferência de ${formatBRL(draft.amount_cents)} salva. O total das suas contas não muda.\n\nAs duas contas estão na tela Contas.`, place: placeAfterSave("transfer", {}) };
  }

  const parsed = transactionDraftSchema.safeParse(body.draft);
  if (!parsed.success) throw new HttpError(400, "A prévia do lançamento está incompleta. Monte o pedido novamente.");
  const draft = parsed.data;
  if (draft.category_id && !data.categories.some((category) => category.id === draft.category_id)) throw new HttpError(400, "A categoria escolhida não existe.");
  if (draft.account_id && !data.accounts.some((account) => account.id === draft.account_id)) throw new HttpError(400, "A conta escolhida não existe.");
  const card = draft.card_id ? data.cards.find((item) => item.id === draft.card_id && !item.archived) : null;
  if (draft.card_id && !card) throw new HttpError(400, "O cartão escolhido não existe.");
  const count = draft.installments ?? 1;

  if (card) {
    const { error } = await client.rpc("create_card_purchase", {
      p_payload: {
        description: draft.description,
        category_id: draft.category_id ?? "",
        credit_card_id: card.id,
        notes: draft.notes ?? "",
        purchased_on: draft.occurred_on,
        installments: installmentsForDatabase(planCardInstallments({
          totalCents: draft.amount_cents,
          count,
          purchasedOn: draft.occurred_on,
          closingDay: card.closingDay,
          dueDay: card.dueDay,
        })),
      },
    });
    if (error) throw new HttpError(400, "Não consegui lançar a compra no cartão. Se a fatura do mês já estiver paga, desfaça o pagamento antes.");
    return { reply: `Compra de ${formatBRL(draft.amount_cents)} lançada no cartão ${card.name}. O saldo da conta só muda quando você pagar a fatura.\n\nO cartão abre com esta compra.`, place: placeAfterSave("card_purchase", draft) };
  }

  if (!draft.account_id) throw new HttpError(400, "Escolha a conta desse lançamento.");
  if (count > 1) {
    if (draft.type !== "expense") throw new HttpError(400, "Parcelamento em conta vale para despesas.");
    const parts = planBankInstallments({ totalCents: draft.amount_cents, count, firstDate: draft.occurred_on });
    const groupId = crypto.randomUUID();
    const { error } = await client.from("transactions").insert(parts.map((part) => ({
      user_id: userId,
      description: `${draft.description} (${part.number}/${count})`,
      amount_cents: part.amountCents,
      type: "expense",
      category_id: draft.category_id ?? null,
      account_id: draft.account_id,
      occurred_on: part.occurredOn,
      due_on: part.dueOn,
      status: part.occurredOn > today ? "planned" : "pending",
      payment_method: draft.payment_method ?? null,
      notes: draft.notes ?? null,
      installment_group_id: groupId,
      installment_number: part.number,
      installment_total: count,
    })));
    if (error) throw new HttpError(400, "Não consegui salvar as parcelas.");
    return { reply: `${count} parcelas salvas. A soma continua ${formatBRL(draft.amount_cents)}.\n\nA visão geral deste mês já inclui a primeira parcela nos gráficos.`, place: placeAfterSave("transaction", draft) };
  }

  const { error } = await client.from("transactions").insert({
    user_id: userId,
    description: draft.description,
    amount_cents: draft.amount_cents,
    type: draft.type,
    category_id: draft.category_id ?? null,
    account_id: draft.account_id,
    occurred_on: draft.occurred_on,
    due_on: draft.due_on ?? null,
    status: draft.status,
    payment_method: draft.payment_method ?? null,
    notes: draft.notes ?? null,
  });
  if (error) throw new HttpError(400, "Não consegui salvar o lançamento.");
  return { reply: `${draft.type === "income" ? "Receita" : "Despesa"} de ${formatBRL(draft.amount_cents)} salva.\n\nA visão geral deste mês já mostra o valor nos gráficos.`, place: placeAfterSave("transaction", draft) };
}

function householdPlace(metric: string) {
  if (metric === "forecast" || metric === "can_afford") return { label: "Ver a previsão do grupo", to: "/conjunto#previsao" };
  if (metric === "category_total") return { label: "Ver as categorias do grupo", to: "/conjunto#categorias" };
  if (metric === "upcoming") return { label: "Ver o que ainda vem", to: "/conjunto#futuro" };
  if (metric === "available_balance" || metric === "account_balance") return { label: "Ver o saldo do grupo", to: "/conjunto#saldos" };
  return { label: "Ver o mês do grupo", to: "/conjunto#mes" };
}

async function answerHousehold(userId: string, email: string, text: string, today: string, res: NodeResponse): Promise<void> {
  const bundle = await householdBundle(userId, email);
  if (!bundle) throw new HttpError(400, "Aceite um convite para a IA olhar as contas juntas.");
  const normalized = normalizeText(text);
  const writing = /\b(adicione|adiciona|lanca|lancar|cadastr|recebi|gastei|paguei|comprei|transfere|transferi)\b/.test(normalized) && !isQuestion(text);
  if (writing) {
    sendJson(res, 200, {
      reply: "Nesta aba eu não gravo lançamento. Cada pessoa lança na própria conta. Depois que salvar, o valor entra aqui nos gráficos do grupo.",
      place: { label: "Lançar na minha conta", to: "/lancamentos?novo=1" },
      confirmation: null,
    });
    return;
  }
  if (/quem gastou|quem ganhou|quem recebe|quem pagou/.test(normalized)) {
    const lines = bundle.parts.map((part) => {
      const model = buildDashboard(part.data, monthKey(today), today);
      return `${part.name}: recebeu ${formatBRL(model.incomeCents)}, gastou ${formatBRL(model.spendingCents)} e ainda tem ${formatBRL(model.pendingCents)} para pagar.`;
    });
    const points = bundle.parts.map((part) => ({ name: part.name, totalCents: buildDashboard(part.data, monthKey(today), today).spendingCents })).filter((point) => point.totalCents > 0);
    sendJson(res, 200, {
      reply: ["Relatório de cada pessoa neste mês", "", ...lines, "", "O gráfico de pessoas nesta aba compara o que entrou e o que saiu."].join("\n"),
      chart: points.length ? { title: "Gastos de cada pessoa", kind: "bars", points } : null,
      place: { label: "Ver cada pessoa", to: "/conjunto#pessoas" },
      confirmation: null,
    });
    return;
  }
  const forced = forcedQuery(text);
  let query: { metric?: string | null; category_name?: string | null; account_name?: string | null; month?: string | null; months?: number | null; days?: number | null; amount_cents?: number | null; installments?: number | null; payment?: "cash" | "credit" | null; starting_on?: string | null } | null = forced
    ? {
        ...forced,
        amount_cents: forced.metric === "can_afford" ? resolveAmountCents(text, null) : null,
        installments: inferInstallments(text),
        payment: /cart[aã]o|cr[eé]dito/i.test(text) ? "credit" : "cash",
        months: /tr[eê]s meses/i.test(text) ? 3 : 1,
      }
    : null;
  if (!query) {
    try {
      await consumeAiQuota(userId);
      const intent = await interpretIntent(`Pedido sobre as contas do grupo. Não invente número e não grave lançamento.\n${text}`);
      if (intent.action === "create_transaction" || intent.action === "create_transfer") {
        sendJson(res, 200, {
          reply: "Nesta aba eu não gravo lançamento. Cada pessoa lança na própria conta. Depois que salvar, o valor entra aqui nos gráficos do grupo.",
          place: { label: "Lançar na minha conta", to: "/lancamentos?novo=1" },
          confirmation: null,
        });
        return;
      }
      const amount = intent.query?.metric === "can_afford" ? resolveAmountCents(text, intent.query.amount_cents) : intent.query?.amount_cents;
      query = intent.query?.metric ? { ...intent.query, amount_cents: amount } : { metric: "month_overview" };
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) throw error;
      query = { metric: "month_overview" };
    }
  }
  const metric = query.metric || "month_overview";
  sendJson(res, 200, {
    reply: `${answerQuery(query, bundle.data, today, text)}\n\nEstes números juntam só quem aceitou o grupo.`,
    chart: chartForQuery(query, bundle.data, today, text),
    place: householdPlace(metric),
    confirmation: null,
  });
}

function isQuestion(text: string): boolean {
  if (text.includes("?")) return true;
  const normalized = normalizeText(text);
  return /^(quanto|qual|quais|como|posso|mostra|mostre|me mostra|me diga|explica|onde)/.test(normalized)
    || /\b(saldo|sobra|previsao|grafico|posso comprar|gastei com|quanto tenho|quanto gastei|quanto recebi)\b/.test(normalized);
}

export async function handleAssistant(req: NodeRequest, res: NodeResponse): Promise<void> {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Use POST.");
    const user = await requireUser(req);
    const body = await readJson(req);
    const data = await loadData(user.token);
    if (body.mode === "confirm") {
      const saved = await confirmDraft(user.token, body, data);
      sendJson(res, 200, { reply: saved.reply, place: saved.place, confirmation: null });
      return;
    }
    const text = String(body.text ?? "").trim();
    const asking = isQuestion(text);
    const guide = asking ? null : body.guide === "account" || body.guide === "income" || body.guide === "paid" || body.guide === "upcoming" ? body.guide : null;
    if (text.length < 2) throw new HttpError(400, "Escreva o que você quer fazer.");
    if (text.length > 2000) throw new HttpError(400, "A mensagem pode ter no máximo 2000 caracteres.");
    const today = todayISO();
    if (body.household === true) {
      await answerHousehold(user.id, user.email, text, today, res);
      return;
    }
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const historyText = history.map((item) => {
      const entry = item as { role?: string; content?: string };
      return `${entry.role === "user" ? "Pessoa" : "Assistente"}: ${String(entry.content ?? "").slice(0, 300)}`;
    }).join("\n");
    if (guide === "account") {
      const earlier = history.filter((item) => (item as { role?: string }).role === "user").map((item) => String((item as { content?: string }).content ?? "")).join(" ");
      sendJson(res, 200, buildAccount(text, data, earlier));
      return;
    }
    await consumeAiQuota(user.id);
    const forced = guide ? null : forcedQuery(text);
    if (forced) {
      const amount = forced.metric === "can_afford" ? resolveAmountCents(text, null) : null;
      const installments = inferInstallments(text);
      const category = suggestCategory(text, data.categories, "expense");
      const query = {
        ...forced,
        amount_cents: amount,
        installments,
        category_name: category?.name ?? null,
        payment: /cart[aã]o|cr[eé]dito/i.test(text) ? "credit" as const : "cash" as const,
        months: /tr[eê]s meses/i.test(text) ? 3 : /dois meses/i.test(text) ? 2 : 1,
      };
      sendJson(res, 200, { reply: answerQuery(query, data, today, text), chart: chartForQuery(query, data, today, text), place: placeForQuery(query, data, today, text), confirmation: null });
      return;
    }
    const guideNote = guide === "income"
      ? "A pessoa está informando uma receita que já entrou. Use action create_transaction, type income e status received."
      : guide === "paid"
        ? "A pessoa está informando uma despesa que já pagou. Use action create_transaction, type expense e status paid."
        : guide === "upcoming"
          ? "A pessoa está informando uma conta que ainda vai pagar. Use action create_transaction, type expense e status pending. Se citar um dia, use esse dia."
          : "";
    const context = {
      hoje: today,
      contas: data.accounts.filter((account) => !account.archived).map((account) => account.name),
      cartoes: data.cards.filter((card) => !card.archived).map((card) => card.name),
      categorias: data.categories.map((category) => `${category.name} (${category.kind === "income" ? "receita" : "despesa"})`),
    };
    const intent = await interpretIntent(`Contexto:\n${JSON.stringify(context)}\n${guideNote}\n\nConversa recente:\n${historyText || "(vazia)"}\n\nPedido:\n${text}`);
    if (!guide && intent.action === "query" && intent.query?.metric) {
      const amount = intent.query.metric === "can_afford" ? resolveAmountCents(text, intent.query.amount_cents) : intent.query.amount_cents;
      const query = { ...intent.query, amount_cents: amount };
      sendJson(res, 200, { reply: answerQuery(query, data, today, text), chart: chartForQuery(query, data, today, text), place: placeForQuery(query, data, today, text), confirmation: null });
      return;
    }
    if (!guide && intent.action === "create_transfer") {
      sendJson(res, 200, buildTransfer(text, intent.transfer, data, today));
      return;
    }
    if (!guide && intent.action === "chat") {
      const message = intent.message ?? "";
      const place = placeFromText(text);
      sendJson(res, 200, {
        reply: /R\$\s*\d/.test(message)
          ? "Posso responder com os números reais dos seus lançamentos. Pergunte, por exemplo, qual é o saldo ou quanto vai sobrar no fim do mês."
          : `${message.trim() || "Posso lançar conta, receita, despesa, compra no cartão e transferência. Nada é salvo sem a sua confirmação."}${place ? `\n\nO que não dá para gravar por aqui está na tela indicada abaixo, com os seus dados.` : ""}`,
        place,
        confirmation: null,
      });
      return;
    }
    const guidedDate = resolveOccurredOn(text, today, intent.draft?.occurred_on).date;
    const guidedFuture = guidedDate > today;
    const guidedDraft = guide
      ? {
          ...(intent.draft ?? {}),
          type: guide === "income" ? "income" as const : "expense" as const,
          status: guide === "income"
            ? (guidedFuture ? "planned" as const : "received" as const)
            : guide === "paid"
              ? (guidedFuture ? "planned" as const : "paid" as const)
              : (guidedFuture ? "planned" as const : "pending" as const),
        }
      : intent.draft;
    sendJson(res, 200, buildTransaction(text, guidedDraft, data, today));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Não consegui concluir o pedido.";
    if (!(error instanceof HttpError)) console.error(error);
    sendJson(res, error instanceof HttpError ? status : 500, { error: error instanceof HttpError ? message : "Não consegui concluir o pedido. Tente novamente." });
  }
}
