import { accountDraftSchema, intentSchema, transactionDraftSchema, transferDraftSchema, type AssistantPlace, type AssistantResponse, type InterviewState, type TransactionDraft } from "@/domain/assistant";
import { groundLaunch, groundTransfer, type GroundLaunch, type UnderstoodDraft } from "@/domain/ground";
import { conductInterview, continuesInterview, explicitDate, inferEntry, readAmountCents, rememberedText } from "@/domain/interview";
import { resolveAmountCents, suggestCategory } from "@/domain/resolveText";
import { accountBalance, balanceParts, buildDashboard, categoryMovement, ledgerTotals, openingOn } from "@/finance/engine";
import { planBankInstallments, planCardInstallments, installmentsForDatabase } from "@/finance/installments";
import { formatDateBR, monthKey, todayISO } from "@/lib/dates";
import { accountTypeLabel, COLORS } from "@/lib/labels";
import { formatBRL, parseMoneyToCents } from "@/lib/money";
import { isTrashed, isTrashedAccount } from "@/lib/trash";
import { matchByName, normalizeText } from "@/lib/utils";
import { mapAccount, mapCard, mapCategory, mapInvoice, mapRecurrence, mapTransaction } from "@/services/mappers";
import type { FinanceData } from "@/types/models";
import { answerQuery, chartForQuery, placeAfterSave, placeForQuery, placeFromText } from "./answers";
import { householdBundle } from "./household";
import { geminiJson, parseModelJson } from "./gemini";
import { HttpError, readJson, sendJson, type NodeRequest, type NodeResponse } from "./http";
import { consumeAiQuota, requireUser, userClient } from "./supabase";

const SYSTEM = `Você é a conversa do aplicativo Contas. Fale como uma IA que entende português, datas, valores e o que a pessoa já disse. Devolva somente JSON.
Os números do contexto são os dados gravados. Use só esses centavos. Não invente saldo e não escreva SQL.
Quando a pessoa informar valor, data, conta ou categoria para lançar, preencha o draft. O aplicativo é quem guarda. amount_cents só se ela falou o número: R$ 85 vira 8500.
message é uma frase curta do que você entendeu, sem dizer que já salvou.
Se a pessoa quer gravar receita, despesa, conta a pagar ou compra, use create_transaction e preencha description, type, status, category_name, account_name e card_name com as palavras dela.
Recebi = income received. Paguei, gastei ou comprei = expense paid. Devo, falta pagar ou conta a pagar = expense pending.
Transferência entre contas = create_transfer. Pergunta sobre os números dela = query, sem responder o número.
Conversa, explicação ou pedido que não é número nem lançamento = chat.
query.metric pode ser available_balance, month_overview, forecast, category_total, upcoming, can_afford, account_balance, debt, open_items ou cards.
Formato:
{"action":"chat|clarify|create_transaction|create_transfer|query","message":"","missing":[],"draft":{"description":"","amount_cents":0,"type":"expense","occurred_on":"","due_on":null,"category_name":null,"account_name":null,"card_name":null,"payment_method":null,"notes":null,"status":null,"installments":1},"transfer":{"description":"Transferência","amount_cents":0,"occurred_on":"","from_account_name":"","to_account_name":""},"query":{"metric":"available_balance|month_overview|forecast|category_total|upcoming|can_afford|account_balance|debt|open_items|cards","category_name":null,"account_name":null,"month":null,"months":null,"days":null,"amount_cents":null,"installments":null,"payment":null,"starting_on":null}}`;

function forcedQuery(text: string) {
  const lower = normalizeText(text);
  if (/cartao|fatura/.test(lower) && !/o que e|o que significa|explica|como funciona/.test(lower) && readAmountCents(text) == null && !inferEntry(text)) return { metric: "cards" as const };
  if (/posso comprar|se eu comprar|cabe no orcamento/.test(lower)) return { metric: "can_afford" as const };
  if (/vai sobrar|fim do mes|saldo previsto|previsao|proximos dias|\b30 dias\b|\b60 dias\b|\b90 dias\b/.test(lower)) return { metric: "forecast" as const };
  if (/quanto gastei com|gastos com|gastei com/.test(lower)) return { metric: "category_total" as const };
  if (/quanto (eu )?estou devendo|quanto estamos devendo|quanto (eu )?devo|quanto devemos|divida|contas a pagar|o que (eu )?tenho para pagar|o que temos para pagar/.test(lower)) return { metric: "debt" as const };
  if (/ainda vou receber|ainda vamos receber|contas a receber|receber e pagar|o que falta/.test(lower)) return { metric: "open_items" as const };
  if (/proximas contas/.test(lower)) return { metric: "upcoming" as const };
  if (/quanto tenho|quanto eu tenho|quanto temos|dinheiro tenho|dinheiro temos|saldo atual|\bsaldo\b/.test(lower)) return { metric: "available_balance" as const };
  if (/quanto recebi|quanto recebemos|receitas do mes|quanto gastei|quanto gastamos|despesas do mes|grafico|relatorio|como esta o mes|resumo/.test(lower)) return { metric: "month_overview" as const };
  return null;
}

function wantsNewAccount(text: string): boolean {
  return /\b(cadastrar uma conta|nova conta|criar uma conta|criar conta|crie a conta|cria a conta|cadastra a conta)\b/.test(normalizeText(text));
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
    accounts: accounts.map(mapAccount).filter((account) => !isTrashedAccount(account)),
    categories: categories.map(mapCategory),
    cards: cards.map(mapCard),
    transactions: transactions.map(mapTransaction).filter((item) => !isTrashed(item.notes)),
    recurrences: recurrences.map(mapRecurrence),
    invoices: invoices.map(mapInvoice),
    goals: [],
    contributions: [],
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
  if (!bundle) {
    sendJson(res, 200, {
      reply: "Ainda não há um grupo aceito. Envie o convite pelo e-mail e espere a outra pessoa aceitar. Até lá eu olho só a sua conta, na bolha das outras telas.",
      place: { label: "Voltar para o convite", to: "/conjunto" },
      confirmation: null,
    });
    return;
  }
  const normalized = normalizeText(text);
  const writing = /\b(adicione|adiciona|lanca|lancar|cadastr|recebi|gastei|paguei|comprei|transfere|transferi)\b/.test(normalized) && !isQuestion(text);
  if (writing) {
    sendJson(res, 200, {
      reply: "Nesta aba eu não gravo lançamento. Cada pessoa lança na própria conta. Depois que salvar, o valor entra aqui nos gráficos do grupo.",
      place: { label: "Lançar na minha conta", to: "/despesas?novo=1" },
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
          place: { label: "Lançar na minha conta", to: "/despesas?novo=1" },
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

function readInterview(value: unknown): InterviewState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== "income" && row.kind !== "paid" && row.kind !== "upcoming") return null;
  return {
    kind: row.kind,
    amountCents: typeof row.amountCents === "number" && row.amountCents > 0 ? Math.round(row.amountCents) : null,
    occurredOn: typeof row.occurredOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.occurredOn) ? row.occurredOn : null,
    description: typeof row.description === "string" && row.description.trim().length >= 2 ? row.description.trim().slice(0, 80) : null,
    accountId: typeof row.accountId === "string" ? row.accountId : null,
    installments: typeof row.installments === "number" && row.installments >= 2 && row.installments <= 48 ? Math.round(row.installments) : null,
    fixed: row.fixed === true,
    pendingAccountName: typeof row.pendingAccountName === "string" && row.pendingAccountName.trim().length >= 2 ? row.pendingAccountName.trim().slice(0, 40) : null,
  };
}

function chartPlace(month: string): AssistantPlace {
  return { label: "Ver no gráfico", to: `/?mes=${month}#graficos` };
}

async function ensureCategory(token: string, userId: string, name: string, kind: "income" | "expense", used: number): Promise<{ id: string; name: string }> {
  const client = userClient(token);
  const clean = name.trim().slice(0, 40);
  const { data, error } = await client.from("categories").insert({
    user_id: userId,
    name: clean,
    kind,
    color: COLORS[used % COLORS.length] ?? COLORS[0],
  }).select("id").single();
  if (error || !data) throw new HttpError(400, "Não consegui criar a categoria.");
  return { id: String(data.id), name: clean };
}

async function saveInterview(token: string, userId: string, state: InterviewState, data: FinanceData, today: string): Promise<{ reply: string; place: AssistantPlace }> {
  const occurred = state.occurredOn ?? today;
  const type = state.kind === "income" ? "income" : "expense";
  const status = state.kind === "income"
    ? (occurred > today ? "planned" as const : "received" as const)
    : state.kind === "paid"
      ? (occurred > today ? "planned" as const : "paid" as const)
      : (occurred > today ? "planned" as const : "pending" as const);
  let accountId = state.accountId;
  let createdAccount = "";
  const chosen = accountId ? data.accounts.find((account) => account.id === accountId) : null;
  if (chosen?.archived) {
    const client = userClient(token);
    const reactivated = await client.from("accounts").update({ archived: false }).eq("id", chosen.id);
    if (reactivated.error) throw new HttpError(400, "Não consegui reativar a conta.");
    chosen.archived = false;
    createdAccount = `Reativei a conta ${chosen.name}.`;
  }
  if (!accountId && state.pendingAccountName) {
    const name = state.pendingAccountName.trim().slice(0, 80);
    const existing = data.accounts.find((account) => !account.archived && normalizeText(account.name) === normalizeText(name));
    if (existing) accountId = existing.id;
    else {
      const client = userClient(token);
      const accountType = inferAccountType(name);
      const color = COLORS[data.accounts.length % COLORS.length] ?? COLORS[0];
      const inserted = await client.from("accounts").insert({
        user_id: userId,
        name,
        institution: name,
        type: accountType,
        initial_balance_cents: 0,
        color,
      }).select("id").single();
      if (inserted.error || !inserted.data) throw new HttpError(400, "Não consegui criar a conta.");
      accountId = String(inserted.data.id);
      createdAccount = `Criei a conta ${name} com saldo inicial zero.`;
      data.accounts.push({
        id: accountId,
        name,
        institution: name,
        type: accountType,
        initialBalanceCents: 0,
        color,
        archived: false,
        createdAt: "",
      });
    }
  }
  const matched = suggestCategory(state.description ?? "", data.categories, type, state.description);
  const category = matched ?? (state.description ? await ensureCategory(token, userId, state.description, type, data.categories.length) : null);
  const categoryLine = matched ? `Categoria: ${matched.name}.` : category ? `Criei a categoria ${category.name}.` : "";
  if (category && !data.categories.some((item) => item.id === category.id)) {
    data.categories.push({ id: category.id, name: category.name, kind: type, color: COLORS[data.categories.length % COLORS.length] ?? "#1d4ed8" });
  }
  const draft: TransactionDraft = {
    description: (state.description ?? "Lançamento").slice(0, 140),
    amount_cents: state.amountCents ?? 0,
    type,
    occurred_on: occurred,
    due_on: state.kind === "upcoming" ? occurred : null,
    status,
    category_id: category?.id ?? null,
    account_id: accountId,
    card_id: null,
    payment_method: null,
    notes: null,
    installments: state.installments ?? 1,
  };
  if (state.fixed && type === "expense" && accountId) {
    await saveFixedBill(token, userId, draft);
    return {
      reply: `${createdAccount} Conta fixa salva: ${formatBRL(draft.amount_cents)} de ${draft.description}, todo dia ${occurred.slice(8, 10)}, na conta ${data.accounts.find((item) => item.id === accountId)?.name ?? "escolhida"}. ${categoryLine} Ela entra em todos os meses a partir de ${formatDateBR(occurred)}.`.trim(),
      place: { label: "Ver as contas fixas", to: "/compromissos" },
    };
  }
  await confirmDraft(token, { kind: (draft.installments ?? 1) > 1 ? "bank_installments" : "transaction", draft }, data);
  const account = data.accounts.find((item) => item.id === accountId);
  const where = account?.name ?? "a conta";
  const when = formatDateBR(occurred);
  const before = account ? accountBalance(account, data.transactions, today) : 0;
  const delta = status === "received" && occurred <= today ? draft.amount_cents : status === "paid" && occurred <= today ? -draft.amount_cents : 0;
  const balanceLine = account && delta !== 0 ? `${where} estava com ${formatBRL(before)} e agora fica com ${formatBRL(before + delta)}.` : "";
  const effect = (draft.installments ?? 1) > 1
    ? `Dividi em ${draft.installments} parcelas, uma em cada mês a partir de ${when}.`
    : state.kind === "income"
    ? (status === "received" ? `Esse valor soma no saldo. ${balanceLine}` : "A data é futura, então ele fica previsto e ainda não entra no saldo de hoje.")
    : state.kind === "paid"
      ? (status === "paid" ? `Esse valor subtrai do saldo. ${balanceLine}` : "A data é futura, então ele fica previsto.")
      : "O dinheiro ainda não saiu. Ele fica na parte amarela, como conta a pagar.";
  return {
    reply: `${createdAccount} ${state.kind === "income" ? "Receita salva" : state.kind === "paid" ? "Gasto salvo" : "Conta futura salva"}: ${formatBRL(state.amountCents ?? 0)} de ${state.description}, em ${when}, na conta ${where}. ${categoryLine} ${effect}\nSe algum detalhe ficou errado, diga: muda o valor para 200. Quer anotar outro? Se acabou, diga: só isso.`.replace(/\s+/g, " ").trim(),
    place: chartPlace(occurred.slice(0, 7)),
  };
}

async function applyChange(token: string, text: string, data: FinanceData, today: string): Promise<{ reply: string; place: AssistantPlace } | null> {
  const normalized = normalizeText(text);
  const change = /\b(muda|altera|corrige|atualiza|troca)\b/.test(normalized);
  const remove = /\b(apaga|exclui|remove)\b/.test(normalized);
  const pay = /\b(paguei|quitei|marca como pago|ja paguei)\b/.test(normalized) && readAmountCents(text) == null;
  const received = /\b(recebi|ja recebi|marca como recebido)\b/.test(normalized) && readAmountCents(text) == null;
  const closeFixed = /\b(encerra|encerrar|cancela a conta fixa)\b/.test(normalized);
  if (!change && !remove && !pay && !received && !closeFixed) return null;
  const hint = normalizeText(text.replace(/\b(?:nome|chama|descri[cç][aã]o|data|valor)\b[\s\S]*\b(?:para|pra)\s+.+$/i, " "))
    .replace(/\b(muda|altera|corrige|atualiza|troca|apaga|exclui|remove|encerra|encerrar|cancela|paguei|quitei|recebi|marca|como|pago|recebido|ja|valor|nome|data|para|pra|o|a|de|do|da|lancamento|reais|conta|fixa)\b/g, " ")
    .replace(/\d[\d.,]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const pool = data.transactions.filter((item) => {
    if (item.type !== "income" && item.type !== "expense") return false;
    if (pay) return item.type === "expense" && (item.status === "pending" || item.status === "planned");
    if (received) return item.type === "income" && item.status !== "received";
    if (closeFixed) return Boolean(item.recurrenceId);
    return true;
  });
  const matches = hint
    ? pool.filter((item) => normalizeText(item.description).includes(hint) || hint.includes(normalizeText(item.description)))
    : [];
  if (matches.length !== 1) {
    const sample = (matches.length ? matches : pool).slice(0, 5).map((item) => item.description);
    if (!sample.length) return { reply: "Ainda não há um lançamento com esse nome para eu mudar.", place: chartPlace(monthKey(today)) };
    return { reply: `Encontrei mais de um jeito de entender. Diga o nome de um destes: ${sample.join(", ")}.`, place: chartPlace(monthKey(today)) };
  }
  const target = matches[0];
  if (!target) return null;
  const client = userClient(token);
  if (remove || closeFixed) {
    if (target.recurrenceId) {
      const { error: stopError } = await client.from("recurrences").update({ status: "cancelled" }).eq("id", target.recurrenceId);
      if (stopError) throw new HttpError(400, "Não consegui encerrar a conta fixa.");
      const { error: dropError } = await client.from("transactions").delete().eq("recurrence_id", target.recurrenceId).in("status", ["planned", "pending"]).gte("occurred_on", today);
      if (dropError) throw new HttpError(400, "Não consegui tirar os meses seguintes da conta fixa.");
      return { reply: `Encerrei a conta fixa ${target.description}. Os meses que ainda não foram pagos saíram da lista.`, place: { label: "Ver as contas fixas", to: "/compromissos" } };
    }
    if (target.installmentGroupId) {
      const { error } = await client.from("transactions").delete().eq("installment_group_id", target.installmentGroupId).neq("type", "invoice_payment");
      if (error) throw new HttpError(400, "Não consegui apagar as parcelas.");
      return { reply: `Apaguei todas as parcelas de ${target.description}.`, place: chartPlace(target.occurredOn.slice(0, 7)) };
    }
    const { error } = await client.from("transactions").delete().eq("id", target.id);
    if (error) throw new HttpError(400, "Não consegui apagar esse lançamento.");
    return { reply: `Apaguei ${target.description}. O gráfico deixa de contar esses ${formatBRL(target.amountCents)}.`, place: chartPlace(target.occurredOn.slice(0, 7)) };
  }
  if (pay || received) {
    const status = received ? "received" : "paid";
    const { error } = await client.from("transactions").update({ status, occurred_on: today }).eq("id", target.id);
    if (error) throw new HttpError(400, received ? "Não consegui marcar essa receita como recebida." : "Não consegui marcar essa conta como paga.");
    return { reply: received ? `Marquei ${target.description} como recebida hoje. ${formatBRL(target.amountCents)} entram no saldo.` : `Marquei ${target.description} como paga hoje. ${formatBRL(target.amountCents)} saem do saldo e passam para a parte vermelha do gráfico.`, place: chartPlace(today.slice(0, 7)) };
  }
  const amount = readAmountCents(text);
  const date = explicitDate(text, today);
  const renamed = text.match(/\b(?:nome|chama|descri[cç][aã]o)\b[\s\S]*?\b(?:para|pra)\s+(.+)$/i);
  const nextName = renamed?.[1]?.trim().replace(/[.?!]+$/, "").slice(0, 80) ?? "";
  const patch: Record<string, unknown> = {};
  if (amount) patch.amount_cents = amount;
  if (date) {
    patch.occurred_on = date;
    patch.due_on = date;
  }
  if (nextName.length >= 2) patch.description = nextName.charAt(0).toUpperCase() + nextName.slice(1);
  if (!Object.keys(patch).length) return { reply: `Diga o novo valor, a nova data ou o novo nome de ${target.description}.`, place: chartPlace(target.occurredOn.slice(0, 7)) };
  const { error } = await client.from("transactions").update(patch).eq("id", target.id);
  if (error) throw new HttpError(400, "Não consegui alterar esse lançamento.");
  const bits = [
    amount ? `valor ${formatBRL(amount)}` : "",
    date ? `data ${formatDateBR(date)}` : "",
    nextName.length >= 2 ? `nome ${patch.description}` : "",
  ].filter(Boolean).join(", ");
  return { reply: `Atualizei ${target.description}: ${bits}.`, place: chartPlace((date ?? target.occurredOn).slice(0, 7)) };
}

async function saveFixedBill(token: string, userId: string, draft: TransactionDraft): Promise<void> {
  const client = userClient(token);
  const { error } = await client.from("recurrences").insert({
    user_id: userId,
    description: draft.description,
    amount_cents: draft.amount_cents,
    type: "expense",
    category_id: draft.category_id ?? null,
    account_id: draft.account_id,
    frequency: "monthly",
    interval: 1,
    start_on: draft.occurred_on,
    day_of_month: Number(draft.occurred_on.slice(8, 10)),
  });
  if (error) throw new HttpError(400, "Não consegui criar a conta fixa.");
}

async function launchFromGround(token: string, userId: string, grounded: GroundLaunch, data: FinanceData): Promise<{ reply: string; place: AssistantPlace }> {
  const draft = grounded.draft;
  if (!draft) throw new HttpError(400, "Falta um detalhe para lançar.");
  let categoryId = draft.categoryId;
  if (!categoryId && draft.createCategory) {
    const created = await ensureCategory(token, userId, draft.createCategory, draft.type, data.categories.length);
    categoryId = created.id;
    data.categories.push({ id: created.id, name: created.name, kind: draft.type, color: COLORS[data.categories.length % COLORS.length] ?? "#1d4ed8" });
  }
  if (draft.fixed && draft.accountId) {
    await saveFixedBill(token, userId, {
      description: draft.description,
      amount_cents: draft.amountCents,
      type: "expense",
      occurred_on: draft.occurredOn,
      due_on: draft.occurredOn,
      status: "pending",
      category_id: categoryId,
      account_id: draft.accountId,
      card_id: null,
      payment_method: null,
      notes: null,
      installments: 1,
    });
    return { reply: grounded.reply, place: { label: "Ver as contas fixas", to: "/compromissos" } };
  }
  const saved = await confirmDraft(token, {
    kind: draft.cardId ? "card_purchase" : draft.installments > 1 ? "bank_installments" : "transaction",
    draft: {
      description: draft.description,
      amount_cents: draft.amountCents,
      type: draft.type,
      occurred_on: draft.occurredOn,
      due_on: draft.dueOn,
      status: draft.status,
      category_id: categoryId,
      account_id: draft.accountId,
      card_id: draft.cardId,
      payment_method: draft.paymentMethod,
      notes: null,
      installments: draft.installments,
    },
  }, data);
  return { reply: grounded.reply, place: saved.place };
}

function plainMessage(message: string | null | undefined): string {
  const text = message?.trim() ?? "";
  if (!text || /R\$\s*\d/.test(text)) return "Entendi. Vou olhar no sistema se isso existe e, se achar, eu lanço.";
  return text;
}

function lookupNotes(draft: UnderstoodDraft | null, data: FinanceData): string {
  if (!draft) return "";
  const lines: string[] = [];
  if (draft.account_name?.trim()) {
    const found = matchByName(data.accounts.filter((account) => !account.archived), draft.account_name);
    lines.push(found ? `Achei a conta ${found.name}.` : `Não achei a conta ${draft.account_name.trim()}.`);
  }
  if (draft.category_name?.trim()) {
    const found = matchByName(data.categories, draft.category_name);
    lines.push(found ? `Achei a categoria ${found.name}.` : `Não achei a categoria ${draft.category_name.trim()}.`);
  }
  if (draft.card_name?.trim()) {
    const found = matchByName(data.cards.filter((card) => !card.archived), draft.card_name);
    lines.push(found ? `Achei o cartão ${found.name}.` : `Não achei o cartão ${draft.card_name.trim()}.`);
  }
  return lines.length ? `\n\n${lines.join("\n")}` : "";
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
    const guide = body.guide === "account" || body.guide === "income" || body.guide === "paid" || body.guide === "upcoming" ? body.guide : null;
    if (text.length < 2) throw new HttpError(400, "Escreva o que você quer fazer.");
    if (text.length > 2000) throw new HttpError(400, "A mensagem pode ter no máximo 2000 caracteres.");
    const today = todayISO();
    if (body.household === true) {
      await answerHousehold(user.id, user.email, text, today, res);
      return;
    }
    const interview = readInterview(body.interview);
    const context = rememberedText(body.history);
    const followUp = /\b(ja falei|eu ja disse|como eu disse|crie a conta|cria a conta|o valor|pode lancar|pode salvar)\b/.test(normalizeText(text))
      || (/^\d/.test(text.trim()) && text.trim().length <= 20)
      || (explicitDate(text, today) != null && text.trim().length <= 24);
    const spoken = inferEntry(text) ?? ((interview || followUp) && !isQuestion(text) ? inferEntry(context) : null);
    const launching = spoken != null && (readAmountCents(text) != null || readAmountCents(context) != null || interview?.amountCents != null);
    if ((guide === "account" || wantsNewAccount(text)) && !launching) {
      sendJson(res, 200, buildAccount(text, data, context));
      return;
    }
    const aboutCard = /cart[aã]o|fatura/.test(normalizeText(text));
    const cardPurchase = aboutCard && (spoken === "paid" || readAmountCents(text) != null);
    const continuing = interview != null && continuesInterview(text, interview, data, today);
    const guided = aboutCard ? null : guide === "income" || guide === "paid" || guide === "upcoming" ? guide : null;
    const activeKind = cardPurchase ? null : guided ?? (continuing ? interview?.kind ?? null : null);
    const switched = spoken != null && activeKind != null && spoken !== activeKind;
    const entryKind = cardPurchase ? null : switched ? spoken : activeKind ?? (continuing ? null : spoken);
    const interviewNow = continuing && !switched ? interview : null;
    if (entryKind && !(isQuestion(text) && readAmountCents(text) == null && explicitDate(text, today) == null && !matchByName(data.accounts, text))) {
      if (!switched) {
        const changed = await applyChange(user.token, text, data, today);
        if (changed && /Marquei|Apaguei|agora é/.test(changed.reply)) {
          sendJson(res, 200, { reply: changed.reply, place: changed.place, interview: null, saved: true, confirmation: null });
          return;
        }
      }
      if (entryKind === "paid" && readAmountCents(text) == null) {
        const marked = await applyChange(user.token, text, data, today);
        if (marked && /Marquei/.test(marked.reply)) {
          sendJson(res, 200, { reply: marked.reply, place: marked.place, interview: null, saved: true, confirmation: null });
          return;
        }
      }
      const result = conductInterview(entryKind, text, interviewNow, data, today, context);
      if (!result.ready || result.state.amountCents == null || !result.state.occurredOn || !result.state.description || !result.state.accountId) {
        sendJson(res, 200, { reply: result.question ?? "Me diga o próximo detalhe.", interview: result.state, confirmation: null });
        return;
      }
      const saved = await saveInterview(user.token, user.id, result.state, data, today);
      sendJson(res, 200, { reply: saved.reply, place: saved.place, interview: null, saved: true, confirmation: null });
      return;
    }
    if (!guide) {
      const changed = await applyChange(user.token, text, data, today);
      if (changed) {
        sendJson(res, 200, { reply: changed.reply, place: changed.place, interview: null, saved: true, confirmation: null });
        return;
      }
    }
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const historyText = history.map((item) => {
      const entry = item as { role?: string; content?: string };
      return `${entry.role === "user" ? "Pessoa" : "Assistente"}: ${String(entry.content ?? "").slice(0, 300)}`;
    }).join("\n");
    if (guide === "income" || guide === "paid" || guide === "upcoming") {
      const reminder = conductInterview(guide, "", interview, data, today).question;
      const query = forcedQuery(text) ?? { metric: "month_overview" as const };
      sendJson(res, 200, {
        reply: `${answerQuery(query, data, today, text)}${reminder ? `\n\nPara continuar o lançamento: ${reminder}` : ""}`,
        chart: chartForQuery(query, data, today, text),
        place: chartPlace(monthKey(today)),
        interview,
        confirmation: null,
      });
      return;
    }
    const forced = forcedQuery(text);
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
      sendJson(res, 200, { reply: answerQuery(query, data, today, text), chart: chartForQuery(query, data, today, text), place: placeForQuery(query, data, today, text), interview, confirmation: null });
      return;
    }
    const normalized = normalizeText(text);
    if (readAmountCents(text) == null && !inferEntry(text) && !/\b(transferi|transferir|anota|anotar|lanca|lan[cç]ar)\b/.test(normalized) && /^(oi|ola|obrigad|bom dia|boa tarde|boa noite)\b|explica|para que serve|o que (e|voce) faz|como (eu )?uso|como funciona/.test(normalized)) {
      sendJson(res, 200, {
        reply: "Eu cuido do seu dinheiro neste app. Digo quanto você tem, quanto deve, o que ainda vai receber e pagar, e quanto sobra no fim do mês. Quando você fala um valor, eu procuro a conta e a categoria. Se achar, eu lanço, inclusive parcela e conta fixa. Também mudo valor, data e nome, marco como pago ou recebido e apago o lançamento que você nomear.",
        interview: null,
        confirmation: null,
      });
      return;
    }
    await consumeAiQuota(user.id);
    const ledger = ledgerTotals(data.accounts, data.transactions, today);
    const movement = categoryMovement(data, monthKey(today));
    const facts = {
      hoje: today,
      centavos: { comecou: ledger.initialCents, entrou: ledger.inCents, saiu: ledger.outCents, saldo_agora: ledger.balanceCents },
      contas: data.accounts.map((account) => {
        const parts = balanceParts(account, data.transactions, today);
        return { nome: account.name, arquivada: account.archived, lancado_em: openingOn(account), comecou: parts.initialCents, entrou: parts.inCents, saiu: parts.outCents, agora: parts.balanceCents };
      }),
      categorias_que_ja_sairam_no_mes: movement.paid.map((item) => ({ nome: item.name, centavos: item.totalCents })),
      categorias_que_ainda_vao_sair_no_mes: movement.pending.map((item) => ({ nome: item.name, centavos: item.totalCents })),
      cartoes: data.cards.filter((card) => !card.archived).map((card) => card.name),
      categorias: data.categories.map((category) => `${category.name} (${category.kind === "income" ? "receita" : "despesa"})`),
    };
    let intent: Awaited<ReturnType<typeof interpretIntent>>;
    try {
      intent = await interpretIntent(`Contexto do sistema desta pessoa:\n${JSON.stringify(facts)}\n\nConversa recente:\n${historyText || "(vazia)"}\n\nPedido:\n${text}`);
    } catch (error) {
      if (error instanceof HttpError && (error.status === 429 || error.status === 503)) throw error;
      sendJson(res, 200, {
        reply: "Entendi a conversa. Se quiser gravar alguma coisa, diga o valor e o nome. Eu procuro a conta e a categoria e, se achar, eu lanço.",
        interview: null,
        confirmation: null,
      });
      return;
    }
    const transfer = intent.action === "create_transfer" || /\b(transferi|transferir)\b/.test(normalizeText(text));
    if (transfer) {
      const move = groundTransfer(text, data, today, intent.transfer?.from_account_name, intent.transfer?.to_account_name);
      if (!move.ready || move.amountCents == null || !move.date || !move.fromId || !move.toId) {
        sendJson(res, 200, { reply: move.reply, interview: null, confirmation: null });
        return;
      }
      const saved = await confirmDraft(user.token, {
        kind: "transfer",
        draft: {
          description: intent.transfer?.description?.trim() || "Transferência",
          amount_cents: move.amountCents,
          occurred_on: move.date,
          from_account_id: move.fromId,
          to_account_id: move.toId,
        },
      }, data);
      sendJson(res, 200, { reply: move.reply, place: saved.place, interview: null, saved: true, confirmation: null });
      return;
    }
    const money = intent.action === "create_transaction" || intent.action === "clarify" || inferEntry(text) != null || readAmountCents(text) != null;
    if (money && intent.action !== "query") {
      const grounded = groundLaunch(text, data, today, plainMessage(intent.message), intent.draft ?? null);
      if (!grounded.ready || !grounded.draft) {
        sendJson(res, 200, { reply: grounded.reply, interview: grounded.interview, confirmation: null });
        return;
      }
      const saved = await launchFromGround(user.token, user.id, grounded, data);
      sendJson(res, 200, { reply: saved.reply, place: saved.place, interview: null, saved: true, confirmation: null });
      return;
    }
    if (intent.action === "query" && intent.query?.metric) {
      const amount = intent.query.metric === "can_afford" ? resolveAmountCents(text, intent.query.amount_cents) : intent.query.amount_cents;
      const query = { ...intent.query, amount_cents: amount };
      sendJson(res, 200, {
        reply: `Olhei no sistema.\n\n${answerQuery(query, data, today, text)}`,
        chart: chartForQuery(query, data, today, text),
        place: placeForQuery(query, data, today, text),
        interview: null,
        confirmation: null,
      });
      return;
    }
    sendJson(res, 200, {
      reply: `${plainMessage(intent.message)}${lookupNotes(intent.draft ?? null, data)}`,
      place: placeFromText(text),
      interview: null,
      confirmation: null,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Não consegui concluir o pedido.";
    if (!(error instanceof HttpError)) console.error(error);
    sendJson(res, error instanceof HttpError ? status : 500, { error: error instanceof HttpError ? message : "Não consegui concluir o pedido. Tente novamente." });
  }
}
