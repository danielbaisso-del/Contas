import { planBankInstallments, planCardInstallments } from "@/finance/installments";
import { addDays, formatMonthShort, isWithin, monthKey, monthRange, shiftMonth } from "@/lib/dates";
import type { Account, CardInvoice, CreditCard, FinanceData, Goal, Transaction } from "@/types/models";

export interface CashSnapshot {
  accountId: string;
  balanceCents: number;
}

function effectiveDate(transaction: Transaction): string {
  return transaction.dueOn || transaction.occurredOn;
}

export function isRealized(transaction: Transaction, asOf: string): boolean {
  if (transaction.occurredOn > asOf) return false;
  if (transaction.type === "income") return transaction.status === "received";
  if (transaction.type === "expense") return transaction.status === "paid" && !transaction.creditCardId;
  if (transaction.type === "transfer" || transaction.type === "invoice_payment") return transaction.status === "paid";
  return false;
}

export function accountBalance(account: Account, transactions: Transaction[], asOf: string): number {
  let balance = account.initialBalanceCents;
  for (const transaction of transactions) {
    if (!isRealized(transaction, asOf)) continue;
    if (transaction.accountId === account.id && (transaction.type === "income")) balance += transaction.amountCents;
    if (transaction.accountId === account.id && (transaction.type === "expense" || transaction.type === "transfer" || transaction.type === "invoice_payment")) {
      balance -= transaction.amountCents;
    }
    if (transaction.type === "transfer" && transaction.destinationAccountId === account.id) balance += transaction.amountCents;
  }
  return balance;
}

export function totalBalance(accounts: Account[], transactions: Transaction[], asOf: string, includeArchived = false): number {
  return accounts
    .filter((account) => includeArchived || !account.archived)
    .reduce((sum, account) => sum + accountBalance(account, transactions, asOf), 0);
}

export function invoiceTotal(invoiceId: string, transactions: Transaction[]): number {
  return transactions
    .filter((transaction) => transaction.invoiceId === invoiceId && transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);
}

export function cardCommittedCents(cardId: string, transactions: Transaction[], invoices: CardInvoice[]): number {
  const paidInvoiceIds = new Set(invoices.filter((invoice) => invoice.creditCardId === cardId && invoice.status === "paid").map((invoice) => invoice.id));
  return transactions
    .filter((transaction) => {
      if (transaction.creditCardId !== cardId || transaction.type !== "expense") return false;
      if (transaction.invoiceId && paidInvoiceIds.has(transaction.invoiceId)) return false;
      return transaction.status !== "paid";
    })
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);
}

export interface UpcomingItem {
  id: string;
  date: string;
  title: string;
  amountCents: number;
  direction: "in" | "out";
  kind: "income" | "expense" | "invoice";
}

export function projectCash(data: Pick<FinanceData, "accounts" | "transactions" | "invoices">, target: string, today: string): number {
  if (target < today) return totalBalance(data.accounts, data.transactions, target);

  let balance = totalBalance(data.accounts, data.transactions, today);
  for (const transaction of data.transactions) {
    const when = effectiveDate(transaction);
    if (when > target) continue;
    if (transaction.type === "income" && transaction.status !== "received") balance += transaction.amountCents;
    if (transaction.type === "expense" && !transaction.creditCardId && transaction.status !== "paid") balance -= transaction.amountCents;
  }
  for (const invoice of data.invoices) {
    if (invoice.status === "paid" || invoice.dueOn > target) continue;
    balance -= invoiceTotal(invoice.id, data.transactions);
  }
  return balance;
}

export function monthIncome(transactions: Transaction[], month: string, mode: "received" | "expected"): number {
  const { start, end } = monthRange(month);
  return transactions.reduce((sum, transaction) => {
    if (transaction.type !== "income" || !isWithin(transaction.occurredOn, start, end)) return sum;
    if (mode === "received" && transaction.status !== "received") return sum;
    return sum + transaction.amountCents;
  }, 0);
}

export function unpaidInstallmentCents(transactions: Transaction[], month: string): number {
  const { start, end } = monthRange(month);
  return transactions.reduce((sum, transaction) => {
    if (transaction.type !== "expense" || transaction.creditCardId || (!transaction.installmentGroupId && !transaction.recurrenceId)) return sum;
    if (transaction.status === "paid") return sum;
    if (!isWithin(transaction.occurredOn, start, end)) return sum;
    return sum + transaction.amountCents;
  }, 0);
}

export function appendInstallmentMonths(data: FinanceData, history: HistoryPoint[], today: string, limit = 12): HistoryPoint[] {
  const last = history[history.length - 1]?.month ?? "";
  const future = [...new Set(data.transactions
    .filter((item) => (item.installmentGroupId || item.recurrenceId) && item.occurredOn.slice(0, 7) > last)
    .map((item) => item.occurredOn.slice(0, 7)))]
    .sort()
    .slice(0, limit);
  return [...history, ...future.flatMap((month) => monthlyHistory(data, month, today, 1))];
}

export function monthSpending(transactions: Transaction[], month: string): number {
  const { start, end } = monthRange(month);
  return transactions.reduce((sum, transaction) => {
    if (transaction.type !== "expense" || !isWithin(transaction.occurredOn, start, end)) return sum;
    if (transaction.creditCardId) return sum + transaction.amountCents;
    if (transaction.status === "paid") return sum + transaction.amountCents;
    return sum;
  }, 0);
}

export function pendingBills(transactions: Transaction[], month: string, today: string): Transaction[] {
  const { start, end } = monthRange(month);
  return transactions
    .filter((transaction) => {
      if (transaction.type !== "expense" || transaction.creditCardId) return false;
      if (transaction.status === "paid") return false;
      const when = effectiveDate(transaction);
      const inMonth = isWithin(when, start, end);
      const overdue = month >= monthKey(today) && when < today && when < start;
      return inMonth || overdue;
    })
    .sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)));
}

export function openInvoicesTotal(data: Pick<FinanceData, "invoices" | "transactions">): number {
  return data.invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce((sum, invoice) => sum + invoiceTotal(invoice.id, data.transactions), 0);
}

export function committedRatio(data: FinanceData, month: string): { committedCents: number; incomeBaseCents: number; ratio: number | null } {
  const { start, end } = monthRange(month);
  const bankBills = data.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "expense" || transaction.creditCardId) return sum;
    if (!isWithin(effectiveDate(transaction), start, end)) return sum;
    return sum + transaction.amountCents;
  }, 0);
  const invoices = data.invoices.reduce((sum, invoice) => {
    if (!isWithin(invoice.dueOn, start, end)) return sum;
    return sum + invoiceTotal(invoice.id, data.transactions);
  }, 0);
  const committedCents = bankBills + invoices;
  const incomeBaseCents = monthIncome(data.transactions, month, "expected");
  return {
    committedCents,
    incomeBaseCents,
    ratio: incomeBaseCents > 0 ? (committedCents / incomeBaseCents) * 100 : null,
  };
}

export interface HistoryPoint {
  month: string;
  label: string;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  projectedCents: number;
}

export function monthlyHistory(data: FinanceData, month: string, today: string, count = 6): HistoryPoint[] {
  const start = shiftMonth(month, -(count - 1));
  const points: HistoryPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = shiftMonth(start, index);
    const range = monthRange(key);
    const isCurrent = monthKey(today) === key;
    const isFuture = key > monthKey(today);
    points.push({
      month: key,
      label: `${formatMonthShort(key)}/${key.slice(2, 4)}`,
      incomeCents: monthIncome(data.transactions, key, "received"),
      expenseCents: monthSpending(data.transactions, key) + unpaidInstallmentCents(data.transactions, key),
      balanceCents: totalBalance(data.accounts, data.transactions, isCurrent ? today : range.end),
      projectedCents: isFuture || isCurrent ? projectCash(data, range.end, today) : totalBalance(data.accounts, data.transactions, range.end),
    });
  }
  return points;
}

export interface CategorySlice {
  id: string;
  name: string;
  totalCents: number;
  color: string;
}

export function expensesByCategory(data: FinanceData, month: string): CategorySlice[] {
  const { start, end } = monthRange(month);
  const totals = new Map<string, number>();
  for (const transaction of data.transactions) {
    if (transaction.type !== "expense" || !isWithin(transaction.occurredOn, start, end)) continue;
    const key = transaction.categoryId ?? "none";
    totals.set(key, (totals.get(key) ?? 0) + transaction.amountCents);
  }
  return [...totals.entries()]
    .map(([id, totalCents]) => {
      const category = data.categories.find((item) => item.id === id);
      return {
        id,
        name: category?.name ?? "Sem categoria",
        totalCents,
        color: category?.color ?? "#64748b",
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
}

export function topCategorySlices(slices: CategorySlice[], limit = 6): CategorySlice[] {
  if (slices.length <= limit) return slices;
  const head = slices.slice(0, limit - 1);
  const rest = slices.slice(limit - 1).reduce((sum, slice) => sum + slice.totalCents, 0);
  return [...head, { id: "others", name: "Outras", totalCents: rest, color: "#64748b" }];
}

export function upcomingItems(data: FinanceData, today: string, limit = 6): UpcomingItem[] {
  const items: UpcomingItem[] = [];
  for (const transaction of data.transactions) {
    const when = effectiveDate(transaction);
    if (when < today) continue;
    if (transaction.type === "income" && transaction.status !== "received") {
      items.push({ id: transaction.id, date: when, title: transaction.description, amountCents: transaction.amountCents, direction: "in", kind: "income" });
    }
    if (transaction.type === "expense" && !transaction.creditCardId && transaction.status !== "paid") {
      items.push({ id: transaction.id, date: when, title: transaction.description, amountCents: transaction.amountCents, direction: "out", kind: "expense" });
    }
  }
  for (const invoice of data.invoices) {
    if (invoice.status === "paid" || invoice.dueOn < today) continue;
    const total = invoiceTotal(invoice.id, data.transactions);
    if (total <= 0) continue;
    const card = data.cards.find((item) => item.id === invoice.creditCardId);
    items.push({
      id: invoice.id,
      date: invoice.dueOn,
      title: `Fatura ${card?.name ?? "do cartão"}`,
      amountCents: total,
      direction: "out",
      kind: "invoice",
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)).slice(0, limit);
}

export interface DashboardModel {
  availableCents: number;
  incomeCents: number;
  previousIncomeCents: number;
  incomeExpectedCents: number;
  spendingCents: number;
  previousSpendingCents: number;
  pendingCents: number;
  pendingCount: number;
  openInvoicesCents: number;
  projectedEndCents: number;
  previousProjectedEndCents: number;
  committedCents: number;
  incomeBaseCents: number;
  committedRatio: number | null;
  previousCommittedRatio: number | null;
  history: HistoryPoint[];
  categories: CategorySlice[];
  upcoming: UpcomingItem[];
  latest: Transaction[];
  forecasts: Array<{ days: number; date: string; balanceCents: number }>;
  accountSnapshots: CashSnapshot[];
}

export function buildDashboard(data: FinanceData, month: string, today: string): DashboardModel {
  const previous = shiftMonth(month, -1);
  const pending = pendingBills(data.transactions, month, today);
  const commitment = committedRatio(data, month);
  const previousCommitment = committedRatio(data, previous);
  const end = monthRange(month).end;
  return {
    availableCents: totalBalance(data.accounts, data.transactions, today),
    incomeCents: monthIncome(data.transactions, month, "received"),
    previousIncomeCents: monthIncome(data.transactions, previous, "received"),
    incomeExpectedCents: monthIncome(data.transactions, month, "expected"),
    spendingCents: monthSpending(data.transactions, month),
    previousSpendingCents: monthSpending(data.transactions, previous),
    pendingCents: pending.reduce((sum, transaction) => sum + transaction.amountCents, 0),
    pendingCount: pending.length,
    openInvoicesCents: openInvoicesTotal(data),
    projectedEndCents: projectCash(data, end, today),
    previousProjectedEndCents: totalBalance(data.accounts, data.transactions, monthRange(previous).end),
    committedCents: commitment.committedCents,
    incomeBaseCents: commitment.incomeBaseCents,
    committedRatio: commitment.ratio,
    previousCommittedRatio: previousCommitment.ratio,
    history: monthlyHistory(data, month, today, 6),
    categories: expensesByCategory(data, month),
    upcoming: upcomingItems(data, today, 6),
    latest: [...data.transactions].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    forecasts: [30, 60, 90].map((days) => {
      const date = addDays(today, days);
      return { days, date, balanceCents: projectCash(data, date, today) };
    }),
    accountSnapshots: data.accounts
      .filter((account) => !account.archived)
      .map((account) => ({ accountId: account.id, balanceCents: accountBalance(account, data.transactions, today) })),
  };
}

export function spendingByCategoryRange(data: FinanceData, start: string, end: string, categoryId: string | null): number {
  return data.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "expense" || transaction.occurredOn < start || transaction.occurredOn > end) return sum;
    if (categoryId && transaction.categoryId !== categoryId) return sum;
    if (!transaction.creditCardId && transaction.status !== "paid") return sum;
    return sum + transaction.amountCents;
  }, 0);
}

export function cardSpending(data: FinanceData, cardId: string, start?: string, end?: string): number {
  return data.transactions.reduce((sum, transaction) => {
    if (transaction.creditCardId !== cardId || transaction.type !== "expense") return sum;
    if (start && transaction.occurredOn < start) return sum;
    if (end && transaction.occurredOn > end) return sum;
    return sum + transaction.amountCents;
  }, 0);
}

export function accountActivity(data: FinanceData, accountId: string, start?: string, end?: string): { incomeCents: number; expenseCents: number } {
  return data.transactions.reduce(
    (totals, transaction) => {
      if (start && transaction.occurredOn < start) return totals;
      if (end && transaction.occurredOn > end) return totals;
      if (transaction.type === "income" && transaction.accountId === accountId && transaction.status === "received") {
        totals.incomeCents += transaction.amountCents;
      }
      if (transaction.type === "expense" && transaction.accountId === accountId && !transaction.creditCardId && transaction.status === "paid") {
        totals.expenseCents += transaction.amountCents;
      }
      if (transaction.type === "invoice_payment" && transaction.accountId === accountId && transaction.status === "paid") {
        totals.expenseCents += transaction.amountCents;
      }
      return totals;
    },
    { incomeCents: 0, expenseCents: 0 },
  );
}

export function monthsToGoal(goal: Pick<Goal, "targetCents" | "savedCents" | "monthlyContributionCents">): number | null {
  const remaining = goal.targetCents - goal.savedCents;
  if (remaining <= 0) return 0;
  if (goal.monthlyContributionCents <= 0) return null;
  return Math.ceil(remaining / goal.monthlyContributionCents);
}

export function neededMonthly(goal: Pick<Goal, "targetCents" | "savedCents" | "deadline">, today: string): number | null {
  if (!goal.deadline || goal.deadline < today) return null;
  const remaining = goal.targetCents - goal.savedCents;
  if (remaining <= 0) return 0;
  const start = new Date(`${today.slice(0, 7)}-01T00:00:00`);
  const end = new Date(`${goal.deadline.slice(0, 7)}-01T00:00:00`);
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (months <= 0) return remaining;
  return Math.ceil(remaining / months);
}

export interface SimulationMonth {
  month: string;
  label: string;
  withoutCents: number;
  withCents: number;
  installmentCents: number;
}

export interface SimulationResult {
  installmentCents: number;
  totalCents: number;
  count: number;
  months: SimulationMonth[];
  committedRatio: number | null;
  ratioAfter: number | null;
  verdict: "ok" | "tight" | "risk" | "unknown";
  verdictText: string;
  schedule: Array<{ date: string; amountCents: number; label: string }>;
}

export function simulatePurchase(input: {
  data: FinanceData;
  today: string;
  totalCents: number;
  count: number;
  firstDate: string;
  mode: "cash" | "credit";
  closingDay?: number;
  dueDay?: number;
}): SimulationResult {
  const count = Math.max(1, input.count);
  const schedule =
    input.mode === "credit"
      ? planCreditImpact(input.totalCents, count, input.firstDate, input.closingDay ?? 28, input.dueDay ?? 5)
      : planBankInstallments({ totalCents: input.totalCents, count, firstDate: input.firstDate }).map((item) => ({
          date: item.dueOn,
          amountCents: item.amountCents,
          label: count === 1 ? "Pagamento à vista" : `Parcela ${item.number}/${count}`,
        }));

  const affected = new Map<string, number>();
  for (const item of schedule) {
    const key = monthKey(item.date);
    affected.set(key, (affected.get(key) ?? 0) + item.amountCents);
  }
  const months: SimulationMonth[] = [];
  const horizon = Math.max(count, 3);
  for (let index = 0; index < horizon; index += 1) {
    const key = shiftMonth(monthKey(input.firstDate), index);
    const end = monthRange(key).end;
    const point = end < input.today ? input.today : end;
    const withoutCents = projectCash(input.data, point, input.today);
    const cumulativeCents = schedule.reduce((sum, item) => (item.date <= point ? sum + item.amountCents : sum), 0);
    months.push({
      month: key,
      label: formatMonthShort(key),
      withoutCents,
      withCents: withoutCents - cumulativeCents,
      installmentCents: affected.get(key) ?? 0,
    });
  }

  const base = committedRatio(input.data, monthKey(input.today));
  const extraThisMonth = affected.get(monthKey(input.today)) ?? 0;
  const ratioAfter = base.incomeBaseCents > 0 ? ((base.committedCents + extraThisMonth) / base.incomeBaseCents) * 100 : null;
  const negative = months.some((month) => month.withCents < 0);
  const high = (ratioAfter ?? 0) >= 80;
  const tight = (ratioAfter ?? 0) >= 60 || months.some((month) => month.withoutCents > 0 && month.withCents < month.withoutCents * 0.25);
  let verdict: SimulationResult["verdict"] = "ok";
  let verdictText = "A compra cabe no planejamento atual. Nenhum mês da simulação fica negativo e a renda comprometida permanece confortável.";
  if (base.incomeBaseCents <= 0) {
    verdict = "unknown";
    verdictText = "Ainda não há receitas previstas neste mês. Dá para ver o efeito no saldo, mas o percentual da renda só aparece depois que você cadastrar o que vai receber.";
  } else if (negative) {
    verdict = "risk";
    verdictText = "Essa compra deixa pelo menos um mês com saldo negativo. O dinheiro disponível não cobre as parcelas junto com o que você já tem a pagar.";
  } else if (high || tight) {
    verdict = "tight";
    verdictText = "A compra não zera o saldo, mas aperta o mês. A renda comprometida fica alta e sobra pouco espaço para imprevistos.";
  }

  return {
    installmentCents: schedule[0]?.amountCents ?? input.totalCents,
    totalCents: input.totalCents,
    count,
    months,
    committedRatio: base.ratio,
    ratioAfter,
    verdict,
    verdictText,
    schedule,
  };
}

function planCreditImpact(totalCents: number, count: number, firstDate: string, closingDay: number, dueDay: number) {
  return planCardInstallments({ totalCents, count, purchasedOn: firstDate, closingDay, dueDay }).map((item) => ({
    date: item.dueOn,
    amountCents: item.amountCents,
    label: count === 1 ? "Fatura do cartão" : `Parcela ${item.number}/${count} na fatura`,
  }));
}

export function invoiceDisplayStatus(invoice: CardInvoice, today: string): "open" | "closed" | "paid" {
  if (invoice.status === "paid") return "paid";
  if (invoice.closingOn < today) return "closed";
  return "open";
}

export function calendarCashEvents(data: FinanceData, iso: string): Transaction[] {
  return data.transactions.filter((transaction) => {
    if (transaction.creditCardId && transaction.type === "expense") return false;
    return effectiveDate(transaction) === iso;
  });
}

export function calendarCardEvents(data: FinanceData, iso: string): Transaction[] {
  return data.transactions.filter((transaction) => transaction.creditCardId && transaction.type === "expense" && transaction.occurredOn === iso);
}

export interface ReportBundle {
  months: HistoryPoint[];
  categories: CategorySlice[];
  cards: Array<{ id: string; name: string; totalCents: number }>;
  accounts: Array<{ id: string; name: string; incomeCents: number; expenseCents: number; balanceCents: number }>;
  recurringCents: number;
  futureCommitmentsCents: number;
}

export function buildReport(data: FinanceData, fromMonth: string, toMonth: string, today: string): ReportBundle {
  const months: HistoryPoint[] = [];
  let cursor = fromMonth;
  let guard = 0;
  while (cursor <= toMonth && guard < 36) {
    months.push(...monthlyHistory(data, cursor, today, 1));
    cursor = shiftMonth(cursor, 1);
    guard += 1;
  }
  const start = monthRange(fromMonth).start;
  const end = monthRange(toMonth).end;
  const categoryTotals = new Map<string, number>();
  let recurringCents = 0;
  let futureCommitmentsCents = 0;
  for (const transaction of data.transactions) {
    if (transaction.occurredOn < start || transaction.occurredOn > end) continue;
    if (transaction.type === "expense") {
      const key = transaction.categoryId ?? "none";
      categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + transaction.amountCents);
      if (transaction.recurrenceId) recurringCents += transaction.amountCents;
    }
  }
  for (const transaction of data.transactions) {
    const when = effectiveDate(transaction);
    if (when < today) continue;
    if (transaction.type === "expense" && !transaction.creditCardId && transaction.status !== "paid") futureCommitmentsCents += transaction.amountCents;
  }
  for (const invoice of data.invoices) {
    if (invoice.status !== "paid" && invoice.dueOn >= today) futureCommitmentsCents += invoiceTotal(invoice.id, data.transactions);
  }
  return {
    months,
    categories: [...categoryTotals.entries()]
      .map(([id, totalCents]) => ({
        id,
        name: data.categories.find((category) => category.id === id)?.name ?? "Sem categoria",
        totalCents,
        color: data.categories.find((category) => category.id === id)?.color ?? "#64748b",
      }))
      .sort((a, b) => b.totalCents - a.totalCents),
    cards: data.cards.map((card) => ({ id: card.id, name: card.name, totalCents: cardSpending(data, card.id, start, end) })),
    accounts: data.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      ...accountActivity(data, account.id, start, end),
      balanceCents: accountBalance(account, data.transactions, today),
    })),
    recurringCents,
    futureCommitmentsCents,
  };
}

export function findDuplicate(transactions: Transaction[], accountId: string, occurredOn: string, amountCents: number, description: string, externalId?: string | null): string | null {
  const normalized = description.trim().toLowerCase().slice(0, 24);
  const match = transactions.find((transaction) => {
    if (externalId && transaction.externalId === externalId) return true;
    return (
      transaction.accountId === accountId &&
      transaction.occurredOn === occurredOn &&
      transaction.amountCents === amountCents &&
      transaction.description.trim().toLowerCase().slice(0, 24) === normalized
    );
  });
  if (!match) return null;
  if (externalId && match.externalId === externalId) return "Este identificador do extrato já foi importado.";
  return "Existe um lançamento com a mesma conta, data, valor e descrição parecida.";
}

export function activeCards(cards: CreditCard[]): CreditCard[] {
  return cards.filter((card) => !card.archived);
}
