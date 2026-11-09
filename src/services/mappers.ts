import type {
  Account,
  AccountType,
  CardInvoice,
  Category,
  CategoryKind,
  CreditCard,
  Goal,
  GoalContribution,
  InvoiceStatus,
  Profile,
  Recurrence,
  RecurrenceFrequency,
  RecurrenceStatus,
  Transaction,
  TransactionStatus,
  TransactionType,
} from "@/types/models";

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  return value == null ? "" : String(value);
}

function optionalText(row: Row, key: string): string | null {
  const value = row[key];
  return value == null || value === "" ? null : String(value);
}

function cents(row: Row, key: string): number {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalInt(row: Row, key: string): number | null {
  const value = row[key];
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapAccount(row: Row): Account {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    institution: text(row, "institution"),
    type: text(row, "type") as AccountType,
    initialBalanceCents: cents(row, "initial_balance_cents"),
    color: text(row, "color") || "#1d4ed8",
    archived: row.archived === true,
    createdAt: text(row, "created_at"),
  };
}

export function mapCategory(row: Row): Category {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    kind: text(row, "kind") as CategoryKind,
    color: text(row, "color") || "#1d4ed8",
  };
}

export function mapCard(row: Row): CreditCard {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    bank: text(row, "bank"),
    limitCents: cents(row, "limit_cents"),
    closingDay: optionalInt(row, "closing_day") ?? 1,
    dueDay: optionalInt(row, "due_day") ?? 1,
    color: text(row, "color") || "#7c3aed",
    archived: row.archived === true,
  };
}

export function mapTransaction(row: Row): Transaction {
  return {
    id: text(row, "id"),
    description: text(row, "description"),
    amountCents: cents(row, "amount_cents"),
    type: text(row, "type") as TransactionType,
    categoryId: optionalText(row, "category_id"),
    accountId: optionalText(row, "account_id"),
    destinationAccountId: optionalText(row, "destination_account_id"),
    creditCardId: optionalText(row, "credit_card_id"),
    occurredOn: text(row, "occurred_on").slice(0, 10),
    dueOn: optionalText(row, "due_on")?.slice(0, 10) ?? null,
    status: text(row, "status") as TransactionStatus,
    paymentMethod: optionalText(row, "payment_method"),
    notes: optionalText(row, "notes"),
    recurrenceId: optionalText(row, "recurrence_id"),
    installmentGroupId: optionalText(row, "installment_group_id"),
    installmentNumber: optionalInt(row, "installment_number"),
    installmentTotal: optionalInt(row, "installment_total"),
    invoiceId: optionalText(row, "invoice_id"),
    purchasedOn: optionalText(row, "purchased_on")?.slice(0, 10) ?? null,
    externalId: optionalText(row, "external_id"),
    createdAt: text(row, "created_at"),
  };
}

export function mapRecurrence(row: Row): Recurrence {
  return {
    id: text(row, "id"),
    description: text(row, "description"),
    amountCents: cents(row, "amount_cents"),
    type: text(row, "type") as "income" | "expense",
    categoryId: optionalText(row, "category_id"),
    accountId: optionalText(row, "account_id"),
    creditCardId: optionalText(row, "credit_card_id"),
    frequency: text(row, "frequency") as RecurrenceFrequency,
    interval: optionalInt(row, "interval") ?? 1,
    startOn: text(row, "start_on").slice(0, 10),
    endOn: optionalText(row, "end_on")?.slice(0, 10) ?? null,
    dayOfMonth: optionalInt(row, "day_of_month"),
    paymentMethod: optionalText(row, "payment_method"),
    status: text(row, "status") as RecurrenceStatus,
    notes: optionalText(row, "notes"),
  };
}

export function mapInvoice(row: Row): CardInvoice {
  return {
    id: text(row, "id"),
    creditCardId: text(row, "credit_card_id"),
    referenceMonth: text(row, "reference_month").slice(0, 10),
    closingOn: text(row, "closing_on").slice(0, 10),
    dueOn: text(row, "due_on").slice(0, 10),
    status: text(row, "status") as InvoiceStatus,
    paidOn: optionalText(row, "paid_on")?.slice(0, 10) ?? null,
    paymentAccountId: optionalText(row, "payment_account_id"),
    paymentTransactionId: optionalText(row, "payment_transaction_id"),
  };
}

export function mapGoal(row: Row): Goal {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    targetCents: cents(row, "target_cents"),
    savedCents: cents(row, "saved_cents"),
    deadline: optionalText(row, "deadline")?.slice(0, 10) ?? null,
    monthlyContributionCents: cents(row, "monthly_contribution_cents"),
    color: text(row, "color") || "#0f766e",
  };
}

export function mapContribution(row: Row): GoalContribution {
  return {
    id: text(row, "id"),
    goalId: text(row, "goal_id"),
    amountCents: cents(row, "amount_cents"),
    contributedOn: text(row, "contributed_on").slice(0, 10),
    notes: optionalText(row, "notes"),
  };
}

export function mapProfile(row: Row): Profile {
  return { id: text(row, "id"), fullName: text(row, "full_name") };
}
