export type AccountType = "checking" | "savings" | "cash" | "digital" | "other";
export type TransactionType = "income" | "expense" | "transfer" | "invoice_payment";
export type TransactionStatus = "planned" | "pending" | "paid" | "received";
export type CategoryKind = "income" | "expense";
export type RecurrenceFrequency = "weekly" | "monthly" | "yearly";
export type RecurrenceStatus = "active" | "paused" | "cancelled";
export type InvoiceStatus = "open" | "paid";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  initialBalanceCents: number;
  color: string;
  archived: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
}

export interface CreditCard {
  id: string;
  name: string;
  bank: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  color: string;
  archived: boolean;
}

export interface Transaction {
  id: string;
  description: string;
  amountCents: number;
  type: TransactionType;
  categoryId: string | null;
  accountId: string | null;
  destinationAccountId: string | null;
  creditCardId: string | null;
  occurredOn: string;
  dueOn: string | null;
  status: TransactionStatus;
  paymentMethod: string | null;
  notes: string | null;
  recurrenceId: string | null;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  invoiceId: string | null;
  purchasedOn: string | null;
  externalId: string | null;
  createdAt: string;
}

export interface Recurrence {
  id: string;
  description: string;
  amountCents: number;
  type: "income" | "expense";
  categoryId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  startOn: string;
  endOn: string | null;
  dayOfMonth: number | null;
  paymentMethod: string | null;
  status: RecurrenceStatus;
  notes: string | null;
}

export interface CardInvoice {
  id: string;
  creditCardId: string;
  referenceMonth: string;
  closingOn: string;
  dueOn: string;
  status: InvoiceStatus;
  paidOn: string | null;
  paymentAccountId: string | null;
  paymentTransactionId: string | null;
}

export interface Goal {
  id: string;
  name: string;
  targetCents: number;
  savedCents: number;
  deadline: string | null;
  monthlyContributionCents: number;
  color: string;
}

export interface GoalContribution {
  id: string;
  goalId: string;
  amountCents: number;
  contributedOn: string;
  notes: string | null;
}

export interface FinanceData {
  accounts: Account[];
  categories: Category[];
  cards: CreditCard[];
  transactions: Transaction[];
  recurrences: Recurrence[];
  invoices: CardInvoice[];
  goals: Goal[];
  contributions: GoalContribution[];
}

export interface Profile {
  id: string;
  fullName: string;
}
