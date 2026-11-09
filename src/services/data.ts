import { planBankInstallments, planCardInstallments, installmentsForDatabase } from "@/finance/installments";
import { DEFAULT_CATEGORIES } from "@/domain/defaults";
import { friendlyDbError } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import {
  mapAccount,
  mapCard,
  mapCategory,
  mapContribution,
  mapGoal,
  mapInvoice,
  mapProfile,
  mapRecurrence,
  mapTransaction,
} from "@/services/mappers";
import { requireUserId } from "@/services/session";
import { supabase } from "@/services/supabase";
import type {
  AccountType,
  CategoryKind,
  FinanceData,
  Profile,
  RecurrenceFrequency,
  TransactionStatus,
  TransactionType,
} from "@/types/models";

type Row = Record<string, unknown>;

async function readAll(table: string, column: string, ascending = true): Promise<Row[]> {
  const pageSize = 1000;
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select("*").order(column, { ascending }).range(from, from + pageSize - 1);
    if (error) throw new Error(friendlyDbError(error));
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function ensureStarter(userId: string, categories: number): Promise<void> {
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!profile) {
    const { error } = await supabase.from("profiles").insert({ id: userId, full_name: "" });
    if (error) throw new Error(friendlyDbError(error));
  }
  if (categories === 0) {
    const { error } = await supabase.from("categories").insert(
      DEFAULT_CATEGORIES.map((category) => ({
        user_id: userId,
        name: category.name,
        kind: category.kind,
        color: category.color,
      })),
    );
    if (error) throw new Error(friendlyDbError(error));
  }
}

export async function loadWorkspace(userId: string): Promise<{ data: FinanceData; profile: Profile | null }> {
  const categoryProbe = await supabase.from("categories").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (categoryProbe.error) throw new Error(friendlyDbError(categoryProbe.error));
  await ensureStarter(userId, categoryProbe.count ?? 0);

  const [accounts, categories, cards, transactions, recurrences, invoices, goals, contributions, profileRow] = await Promise.all([
    readAll("accounts", "name"),
    readAll("categories", "name"),
    readAll("credit_cards", "name"),
    readAll("transactions", "occurred_on", false),
    readAll("recurrences", "description"),
    readAll("card_invoices", "due_on"),
    readAll("goals", "name"),
    readAll("goal_contributions", "contributed_on", false),
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
  ]);
  if (profileRow.error) throw new Error(friendlyDbError(profileRow.error));

  return {
    profile: profileRow.data ? mapProfile(profileRow.data as Row) : null,
    data: {
      accounts: accounts.map(mapAccount),
      categories: categories.map(mapCategory),
      cards: cards.map(mapCard),
      transactions: transactions.map(mapTransaction),
      recurrences: recurrences.map(mapRecurrence),
      invoices: invoices.map(mapInvoice),
      goals: goals.map(mapGoal),
      contributions: contributions.map(mapContribution),
    },
  };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export interface TransactionInput {
  description: string;
  amountCents: number;
  type: TransactionType;
  occurredOn: string;
  dueOn?: string | null;
  status: TransactionStatus;
  categoryId?: string | null;
  accountId?: string | null;
  destinationAccountId?: string | null;
  creditCardId?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
}

function validateTransaction(input: TransactionInput): void {
  if (input.description.trim().length < 2) throw new Error("Informe uma descrição com pelo menos 2 letras.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Informe um valor maior que zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) throw new Error("Informe uma data válida.");
  if (input.type === "transfer") {
    if (!input.accountId || !input.destinationAccountId) throw new Error("Escolha a conta de saída e a conta de entrada.");
    if (input.accountId === input.destinationAccountId) throw new Error("A transferência precisa acontecer entre duas contas diferentes.");
  }
  if (input.type === "income" && !input.accountId) throw new Error("Escolha a conta que vai receber o dinheiro.");
  if (input.type === "expense" && !input.accountId && !input.creditCardId) throw new Error("Escolha a conta ou o cartão.");
  if (input.type === "expense" && input.accountId && input.creditCardId) {
    throw new Error("Compra no cartão não sai da conta neste momento. O dinheiro só sai quando você pagar a fatura.");
  }
  if (input.type === "income" && !["planned", "pending", "received"].includes(input.status)) {
    throw new Error("Uma receita fica prevista, pendente ou recebida.");
  }
  if (input.type === "expense" && !["planned", "pending", "paid"].includes(input.status)) {
    throw new Error("Uma despesa fica prevista, pendente ou paga.");
  }
}

function transactionRow(userId: string, input: TransactionInput): Row {
  validateTransaction(input);
  return {
    user_id: userId,
    description: input.description.trim(),
    amount_cents: input.amountCents,
    type: input.type,
    occurred_on: input.occurredOn,
    due_on: clean(input.dueOn),
    status: input.status,
    category_id: input.categoryId || null,
    account_id: input.accountId || null,
    destination_account_id: input.type === "transfer" ? input.destinationAccountId || null : null,
    credit_card_id: input.creditCardId || null,
    payment_method: clean(input.paymentMethod),
    notes: clean(input.notes),
  };
}

export async function saveTransaction(input: TransactionInput, id?: string): Promise<void> {
  const userId = await requireUserId();
  const row = transactionRow(userId, input);
  const query = id
    ? supabase.from("transactions").update(row).eq("id", id)
    : supabase.from("transactions").insert(row);
  const { error } = await query;
  if (error) throw new Error(friendlyDbError(error));
}

export async function deleteTransaction(id: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw new Error(friendlyDbError(error));
}

export async function deleteInstallmentGroup(groupId: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from("transactions").delete().eq("installment_group_id", groupId).neq("type", "invoice_payment");
  if (error) throw new Error(friendlyDbError(error));
}

export async function createBankInstallments(input: {
  description: string;
  totalCents: number;
  count: number;
  firstDate: string;
  categoryId?: string | null;
  accountId: string;
  paymentMethod?: string | null;
  notes?: string | null;
}): Promise<void> {
  const userId = await requireUserId();
  const today = todayISO();
  const parts = planBankInstallments({ totalCents: input.totalCents, count: input.count, firstDate: input.firstDate });
  const groupId = crypto.randomUUID();
  const rows = parts.map((part) =>
    transactionRow(userId, {
      description: input.count === 1 ? input.description : `${input.description} (${part.number}/${input.count})`,
      amountCents: part.amountCents,
      type: "expense",
      occurredOn: part.occurredOn,
      dueOn: part.dueOn,
      status: part.occurredOn > today ? "planned" : "pending",
      categoryId: input.categoryId,
      accountId: input.accountId,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
    }),
  );
  const { error } = await supabase.from("transactions").insert(
    rows.map((row, index) => ({
      ...row,
      installment_group_id: groupId,
      installment_number: parts[index]?.number,
      installment_total: input.count,
    })),
  );
  if (error) throw new Error(friendlyDbError(error));
}

export async function createCardPurchase(input: {
  description: string;
  totalCents: number;
  count: number;
  purchasedOn: string;
  categoryId?: string | null;
  cardId: string;
  closingDay: number;
  dueDay: number;
  notes?: string | null;
}): Promise<void> {
  await requireUserId();
  const installments = planCardInstallments({
    totalCents: input.totalCents,
    count: input.count,
    purchasedOn: input.purchasedOn,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
  });
  const { error } = await supabase.rpc("create_card_purchase", {
    p_payload: {
      description: input.description.trim(),
      category_id: input.categoryId || "",
      credit_card_id: input.cardId,
      notes: clean(input.notes) ?? "",
      purchased_on: input.purchasedOn,
      installments: installmentsForDatabase(installments),
    },
  });
  if (error) throw new Error(friendlyDbError(error));
}

export async function saveAccount(input: {
  name: string;
  institution: string;
  type: AccountType;
  initialBalanceCents: number;
  color: string;
}, id?: string): Promise<void> {
  const userId = await requireUserId();
  if (input.name.trim().length < 2) throw new Error("Dê um nome para a conta.");
  const row = {
    user_id: userId,
    name: input.name.trim(),
    institution: input.institution.trim(),
    type: input.type,
    initial_balance_cents: input.initialBalanceCents,
    color: input.color,
  };
  const { error } = id ? await supabase.from("accounts").update(row).eq("id", id) : await supabase.from("accounts").insert(row);
  if (error) throw new Error(friendlyDbError(error));
}

export async function setAccountArchived(id: string, archived: boolean): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from("accounts").update({ archived }).eq("id", id);
  if (error) throw new Error(friendlyDbError(error));
}

export async function deleteAccount(id: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) throw new Error(friendlyDbError(error));
}

export async function saveCard(input: {
  name: string;
  bank: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  color: string;
}, id?: string): Promise<void> {
  const userId = await requireUserId();
  if (input.name.trim().length < 2) throw new Error("Dê um nome para o cartão.");
  if (input.closingDay < 1 || input.closingDay > 31 || input.dueDay < 1 || input.dueDay > 31) {
    throw new Error("Fechamento e vencimento precisam ser dias entre 1 e 31.");
  }
  const row = {
    user_id: userId,
    name: input.name.trim(),
    bank: input.bank.trim(),
    limit_cents: input.limitCents,
    closing_day: input.closingDay,
    due_day: input.dueDay,
    color: input.color,
  };
  const { error } = id ? await supabase.from("credit_cards").update(row).eq("id", id) : await supabase.from("credit_cards").insert(row);
  if (error) throw new Error(friendlyDbError(error));
}

export async function setCardArchived(id: string, archived: boolean): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from("credit_cards").update({ archived }).eq("id", id);
  if (error) throw new Error(friendlyDbError(error));
}

export async function payInvoice(invoiceId: string, accountId: string, date: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.rpc("pay_invoice", { p_invoice_id: invoiceId, p_account_id: accountId, p_date: date });
  if (error) throw new Error(friendlyDbError(error));
}

export async function undoInvoicePayment(invoiceId: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.rpc("undo_invoice_payment", { p_invoice_id: invoiceId });
  if (error) throw new Error(friendlyDbError(error));
}

export interface RecurrenceInput {
  description: string;
  amountCents: number;
  type: "income" | "expense";
  categoryId?: string | null;
  accountId?: string | null;
  creditCardId?: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  startOn: string;
  endOn?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
}

export async function saveRecurrence(input: RecurrenceInput, id?: string): Promise<void> {
  const userId = await requireUserId();
  if (input.description.trim().length < 2) throw new Error("Informe o nome da recorrência.");
  if (input.amountCents <= 0) throw new Error("Informe um valor maior que zero.");
  if (!input.accountId && !input.creditCardId) throw new Error("Escolha a conta ou o cartão.");
  if (input.accountId && input.creditCardId) throw new Error("Uma recorrência entra na conta ou no cartão, nunca nos dois ao mesmo tempo.");
  if (input.endOn && input.endOn < input.startOn) throw new Error("A data final precisa ser igual ou posterior à data inicial.");
  const row = {
    user_id: userId,
    description: input.description.trim(),
    amount_cents: input.amountCents,
    type: input.creditCardId ? "expense" : input.type,
    category_id: input.categoryId || null,
    account_id: input.creditCardId ? null : input.accountId || null,
    credit_card_id: input.creditCardId || null,
    frequency: input.frequency,
    interval: input.interval,
    start_on: input.startOn,
    end_on: clean(input.endOn),
    day_of_month: Number(input.startOn.slice(8, 10)),
    payment_method: input.creditCardId ? "credit" : clean(input.paymentMethod),
    notes: clean(input.notes),
  };
  const { error } = id ? await supabase.from("recurrences").update(row).eq("id", id) : await supabase.from("recurrences").insert(row);
  if (error) throw new Error(friendlyDbError(error));
  if (id) {
    const { error: futureError } = await supabase
      .from("transactions")
      .update({
        description: input.description.trim(),
        amount_cents: input.amountCents,
        category_id: input.categoryId || null,
        notes: clean(input.notes),
      })
      .eq("recurrence_id", id)
      .in("status", ["planned", "pending"]);
    if (futureError) throw new Error(friendlyDbError(futureError));
  }
}

export async function setRecurrenceStatus(id: string, status: "active" | "paused" | "cancelled"): Promise<void> {
  await requireUserId();
  if (status === "cancelled") {
    const { error: deleteError } = await supabase
      .from("transactions")
      .delete()
      .eq("recurrence_id", id)
      .in("status", ["planned", "pending"])
      .gte("occurred_on", todayISO());
    if (deleteError) throw new Error(friendlyDbError(deleteError));
  }
  const { error } = await supabase.from("recurrences").update({ status }).eq("id", id);
  if (error) throw new Error(friendlyDbError(error));
}

export async function saveCategory(name: string, kind: CategoryKind): Promise<void> {
  const userId = await requireUserId();
  if (name.trim().length < 2) throw new Error("Informe o nome da categoria.");
  const { error } = await supabase.from("categories").insert({ user_id: userId, name: name.trim(), kind, color: kind === "income" ? "#0f766e" : "#1d4ed8" });
  if (error) throw new Error(friendlyDbError(error));
}

export async function deleteCategory(id: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw new Error(friendlyDbError(error));
}

export async function saveGoal(input: {
  name: string;
  targetCents: number;
  deadline?: string | null;
  monthlyContributionCents: number;
  color: string;
}, id?: string): Promise<string> {
  const userId = await requireUserId();
  if (input.name.trim().length < 2) throw new Error("Dê um nome para a meta.");
  if (input.targetCents <= 0) throw new Error("Informe o valor que você quer alcançar.");
  const row = {
    user_id: userId,
    name: input.name.trim(),
    target_cents: input.targetCents,
    deadline: clean(input.deadline),
    monthly_contribution_cents: Math.max(0, input.monthlyContributionCents),
    color: input.color,
  };
  if (id) {
    const { error } = await supabase.from("goals").update(row).eq("id", id);
    if (error) throw new Error(friendlyDbError(error));
    return id;
  }
  const { data, error } = await supabase.from("goals").insert(row).select("id").single();
  if (error) throw new Error(friendlyDbError(error));
  return String((data as Row).id);
}

export async function deleteGoal(id: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) throw new Error(friendlyDbError(error));
}

export async function addContribution(goalId: string, amountCents: number, date: string, notes: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.rpc("add_goal_contribution", {
    p_goal_id: goalId,
    p_amount: amountCents,
    p_date: date,
    p_notes: notes,
  });
  if (error) throw new Error(friendlyDbError(error));
}

export async function removeContribution(id: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.rpc("delete_goal_contribution", { p_id: id });
  if (error) throw new Error(friendlyDbError(error));
}

export async function importStatement(accountId: string, rows: Array<{
  occurredOn: string;
  description: string;
  amountCents: number;
  type: "income" | "expense";
  categoryId: string | null;
  externalId: string | null;
}>): Promise<void> {
  const userId = await requireUserId();
  const payload = rows.map((row) => ({
    user_id: userId,
    account_id: accountId,
    description: row.description.trim(),
    amount_cents: row.amountCents,
    type: row.type,
    occurred_on: row.occurredOn,
    status: row.type === "income" ? "received" : "paid",
    category_id: row.categoryId,
    external_id: row.externalId,
    payment_method: "transfer",
    notes: "Importado do extrato",
  }));
  for (let index = 0; index < payload.length; index += 200) {
    const { error } = await supabase.from("transactions").insert(payload.slice(index, index + 200));
    if (error) throw new Error(friendlyDbError(error));
  }
}

export async function saveProfileName(fullName: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("profiles").update({ full_name: fullName.trim() }).eq("id", userId);
  if (error) throw new Error(friendlyDbError(error));
}

export async function saveAssistantMessage(role: "user" | "assistant", content: string, payload?: unknown): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("assistant_messages").insert({ user_id: userId, role, content, payload: payload ?? null });
  if (error) throw new Error(friendlyDbError(error));
}

export async function loadAssistantMessages(): Promise<Array<{ id: string; role: "user" | "assistant"; content: string; payload: unknown }>> {
  await requireUserId();
  const { data, error } = await supabase.from("assistant_messages").select("*").order("created_at", { ascending: true }).limit(80);
  if (error) throw new Error(friendlyDbError(error));
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    role: row.role === "user" ? "user" : "assistant",
    content: String(row.content ?? ""),
    payload: row.payload ?? null,
  }));
}
