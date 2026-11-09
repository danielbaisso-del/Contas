// src/domain/assistant.ts
import { z } from "zod";
var paymentMethodSchema = z.enum(["pix", "debit", "credit", "cash", "boleto", "transfer", "other"]);
var transactionDraftSchema = z.object({
  description: z.string().trim().min(2).max(140),
  amount_cents: z.number().int().positive().max(1e10),
  type: z.enum(["income", "expense"]),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(["planned", "pending", "paid", "received"]),
  category_id: z.string().uuid().nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  card_id: z.string().uuid().nullable().optional(),
  payment_method: paymentMethodSchema.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  installments: z.number().int().min(1).max(48).optional()
});
var accountDraftSchema = z.object({
  name: z.string().trim().min(2).max(80),
  institution: z.string().trim().max(80),
  type: z.enum(["checking", "savings", "cash", "digital", "other"]),
  initial_balance_cents: z.number().int().min(0).max(1e10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});
var transferDraftSchema = z.object({
  description: z.string().trim().min(2).max(140),
  amount_cents: z.number().int().positive().max(1e10),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid()
});
var intentSchema = z.object({
  action: z.enum(["chat", "clarify", "create_transaction", "create_transfer", "query"]),
  message: z.string().optional().nullable(),
  missing: z.array(z.string()).optional().nullable(),
  draft: z.object({
    description: z.string().optional().nullable(),
    amount_cents: z.number().optional().nullable(),
    type: z.enum(["income", "expense"]).optional().nullable(),
    occurred_on: z.string().optional().nullable(),
    due_on: z.string().optional().nullable(),
    category_name: z.string().optional().nullable(),
    account_name: z.string().optional().nullable(),
    card_name: z.string().optional().nullable(),
    payment_method: paymentMethodSchema.optional().nullable(),
    notes: z.string().optional().nullable(),
    status: z.enum(["planned", "pending", "paid", "received"]).optional().nullable(),
    installments: z.number().optional().nullable()
  }).optional().nullable(),
  transfer: z.object({
    description: z.string().optional().nullable(),
    amount_cents: z.number().optional().nullable(),
    occurred_on: z.string().optional().nullable(),
    from_account_name: z.string().optional().nullable(),
    to_account_name: z.string().optional().nullable()
  }).optional().nullable(),
  query: z.object({
    metric: z.enum(["available_balance", "month_overview", "forecast", "category_total", "upcoming", "can_afford", "account_balance"]).optional().nullable(),
    category_name: z.string().optional().nullable(),
    account_name: z.string().optional().nullable(),
    month: z.string().optional().nullable(),
    months: z.number().optional().nullable(),
    days: z.number().optional().nullable(),
    amount_cents: z.number().optional().nullable(),
    installments: z.number().optional().nullable(),
    payment: z.enum(["cash", "credit"]).optional().nullable(),
    starting_on: z.string().optional().nullable()
  }).optional().nullable()
});

// src/lib/dates.ts
function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function todayISO(now = /* @__PURE__ */ new Date()) {
  return toISODate(now);
}
function parseISODate(iso) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}
function formatDateBR(iso) {
  if (!iso) return "\u2014";
  const date = parseISODate(iso);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return date.toLocaleDateString("pt-BR");
}
function addDays(iso, days) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}
function monthKey(iso) {
  return iso.slice(0, 7);
}
function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, (monthNumber || 1) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthRange(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(year, (monthNumber || 1) - 1, 1);
  const end = new Date(year, monthNumber || 1, 0);
  return { start: toISODate(start), end: toISODate(end) };
}
function formatMonthLabel(month) {
  const { start } = monthRange(month);
  const label = parseISODate(start).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric"
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function formatMonthShort(month) {
  const { start } = monthRange(month);
  const label = parseISODate(start).toLocaleDateString("pt-BR", { month: "short" });
  return label.replace(".", "");
}
function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}
function dateWithDay(year, monthIndex, day) {
  const clamped = Math.min(Math.max(day, 1), daysInMonth(year, monthIndex));
  return toISODate(new Date(year, monthIndex, clamped));
}
function addMonthsKeepingDay(anchor, monthsToAdd, dayOfMonth) {
  const base = parseISODate(anchor);
  const target = new Date(base.getFullYear(), base.getMonth() + monthsToAdd, 1);
  return dateWithDay(target.getFullYear(), target.getMonth(), dayOfMonth);
}
function isWithin(iso, start, end) {
  return iso >= start && iso <= end;
}

// src/lib/money.ts
var moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});
function formatBRL(cents2) {
  const value = Number.isFinite(cents2) ? cents2 / 100 : 0;
  return moneyFormatter.format(value);
}
function parseMoneyToCents(input) {
  let raw = input.trim().replace(/\s/g, "").replace(/r\$/gi, "");
  if (!raw) return null;
  raw = raw.replace(/[^\d,.-]/g, "");
  if (!raw) return null;
  const negative = raw.includes("-");
  raw = raw.replace(/-/g, "");
  if (!raw) return null;
  let cents2;
  if (raw.includes(",")) {
    const [integerPart, decimalPart = ""] = raw.split(",");
    const integers = integerPart.replace(/\./g, "");
    if (!/^\d*$/.test(integers) || !/^\d*$/.test(decimalPart)) return null;
    const decimals = `${decimalPart}00`.slice(0, 2);
    cents2 = Number(integers || "0") * 100 + Number(decimals);
  } else if (raw.includes(".")) {
    const parts = raw.split(".");
    if (!parts.every((part) => /^\d+$/.test(part))) return null;
    const last = parts[parts.length - 1] ?? "";
    const groupedThousands = parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
    if (groupedThousands && (parts.length > 2 || last.length === 3)) {
      cents2 = Number(parts.join("")) * 100;
    } else if (parts.length === 2 && last.length > 0 && last.length <= 2) {
      const decimals = `${last}00`.slice(0, 2);
      cents2 = Number(parts[0] || "0") * 100 + Number(decimals);
    } else {
      return null;
    }
  } else {
    if (!/^\d+$/.test(raw)) return null;
    cents2 = Number(raw) * 100;
  }
  if (!Number.isSafeInteger(cents2)) return null;
  return negative ? -cents2 : cents2;
}
function splitAmount(totalCents, count) {
  if (count < 1) throw new Error("Quantidade de parcelas inv\xE1lida.");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
function percentLabel(value) {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

// src/lib/statements.ts
function pad(value) {
  return String(value).padStart(2, "0");
}
function isoFromParts(year, month, day) {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}
function parseFlexibleDate(value) {
  const text2 = value.trim();
  const br = text2.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (br) {
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    return isoFromParts(year, Number(br[2]), Number(br[1]));
  }
  const iso = text2.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const compact = text2.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return isoFromParts(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  return null;
}

// src/lib/utils.ts
function normalizeText(value) {
  return value.normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").toLowerCase().trim();
}
function matchByName(items, name) {
  if (!name?.trim()) return null;
  const target = normalizeText(name);
  return items.find((item) => normalizeText(item.name) === target) ?? items.find((item) => {
    const current = normalizeText(item.name);
    return current.includes(target) || target.includes(current);
  }) ?? null;
}

// src/domain/resolveText.ts
var EXPENSE_HINTS = [
  { category: "Mercado", words: ["mercado", "supermercado", "feira", "hortifruti"] },
  { category: "Alimenta\xE7\xE3o", words: ["restaurante", "ifood", "lanche", "almoco", "jantar", "padaria", "cafe", "comida"] },
  { category: "Transporte", words: ["uber", "combustivel", "gasolina", "onibus", "metro", "estacionamento"] },
  { category: "Moradia", words: ["aluguel", "condominio"] },
  { category: "Contas da casa", words: ["luz", "energia", "agua", "internet", "telefone"] },
  { category: "Assinaturas", words: ["netflix", "spotify", "assinatura", "mensalidade"] },
  { category: "Sa\xFAde", words: ["farmacia", "medico", "hospital", "consulta"] },
  { category: "Lazer", words: ["cinema", "show", "viagem"] },
  { category: "Educa\xE7\xE3o", words: ["curso", "faculdade", "escola", "livro"] }
];
var INCOME_HINTS = [
  { category: "Sal\xE1rio", words: ["salario", "holerite"] },
  { category: "Freelance", words: ["freelance", "cliente"] }
];
function extractExplicitAmounts(text2) {
  const patterns = [
    /R\$\s*[\d.]+(?:,\d{1,2})?/gi,
    /\b\d{1,3}(?:\.\d{3})+(?:,\d{2})\b/g,
    /\b\d+(?:,\d{2})\s*reais\b/gi,
    /\b\d+(?:[\.,]\d{3})*(?:,\d{2})?\s*reais\b/gi
  ];
  const found = /* @__PURE__ */ new Set();
  for (const pattern of patterns) {
    for (const match of text2.matchAll(pattern)) {
      const cents2 = parseMoneyToCents(match[0]);
      if (cents2 && cents2 > 0) found.add(cents2);
    }
  }
  return [...found];
}
function bareNumbers(text2) {
  const found = /* @__PURE__ */ new Set();
  for (const match of text2.matchAll(/(?<![\d/.-])(\d{1,7})(?![\d/.-])/g)) {
    found.add(Number(match[1]));
  }
  return [...found];
}
function resolveAmountCents(text2, modelValue) {
  const extracted = extractExplicitAmounts(text2);
  if (extracted.length === 1) return extracted[0] ?? null;
  if (modelValue == null || !Number.isFinite(modelValue) || modelValue <= 0) return null;
  let cents2 = Number.isInteger(modelValue) ? Math.round(modelValue) : Math.round(modelValue * 100);
  if (extracted.includes(cents2)) return cents2;
  if (extracted.length > 1) return null;
  if (!/centavo/i.test(text2) && bareNumbers(text2).includes(cents2) && cents2 < 1e7) cents2 *= 100;
  return cents2 > 0 ? cents2 : null;
}
function resolveOccurredOn(text2, today, modelDate) {
  const lower = normalizeText(text2);
  if (/\bhoje\b/.test(lower)) return { date: today, assumed: false };
  if (/\bontem\b/.test(lower)) return { date: addDays(today, -1), assumed: false };
  if (/\bamanha\b/.test(lower)) return { date: addDays(today, 1), assumed: false };
  const numeric = text2.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (numeric) {
    const source = numeric[3] ? numeric[0] : `${numeric[1]}/${numeric[2]}/${today.slice(0, 4)}`;
    const parsed = parseFlexibleDate(source);
    if (parsed) return { date: parsed, assumed: false };
  }
  const dayOnly = lower.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnly) {
    const parsed = parseFlexibleDate(`${dayOnly[1]}/${today.slice(5, 7)}/${today.slice(0, 4)}`);
    if (parsed) return { date: parsed, assumed: false };
  }
  if (modelDate && /^\d{4}-\d{2}-\d{2}$/.test(modelDate)) return { date: modelDate, assumed: false };
  return { date: today, assumed: true };
}
function suggestCategory(text2, categories, type, modelName) {
  const matchedModel = matchByName(categories.filter((category) => category.kind === type), modelName);
  if (matchedModel) return matchedModel;
  const normalized = normalizeText(text2);
  const hints = type === "income" ? INCOME_HINTS : EXPENSE_HINTS;
  const hint = hints.find((item) => item.words.some((word) => normalized.includes(normalizeText(word))));
  if (!hint) return null;
  return matchByName(categories.filter((category) => category.kind === type), hint.category);
}

// src/finance/installments.ts
function planCardInstallments(input) {
  const amounts = splitAmount(input.totalCents, input.count);
  const purchase = parseISODate(input.purchasedOn);
  let year = purchase.getFullYear();
  let monthIndex = purchase.getMonth();
  if (purchase.getDate() > input.closingDay) {
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }
  return amounts.map((amountCents, index) => {
    const cursor = new Date(year, monthIndex + index, 1);
    const closingOn = dateWithDay(cursor.getFullYear(), cursor.getMonth(), input.closingDay);
    const dueBase = input.dueDay > input.closingDay ? cursor : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const dueOn = dateWithDay(dueBase.getFullYear(), dueBase.getMonth(), input.dueDay);
    const referenceMonth = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
    return {
      number: index + 1,
      total: input.count,
      amountCents,
      occurredOn: closingOn,
      dueOn,
      closingOn,
      referenceMonth
    };
  });
}
function planBankInstallments(input) {
  const amounts = splitAmount(input.totalCents, input.count);
  const day = parseISODate(input.firstDate).getDate();
  return amounts.map((amountCents, index) => {
    const occurredOn = index === 0 ? input.firstDate : addMonthsKeepingDay(input.firstDate, index, day);
    return {
      number: index + 1,
      total: input.count,
      amountCents,
      occurredOn,
      dueOn: occurredOn
    };
  });
}
function installmentsForDatabase(items) {
  return items.map((item) => ({
    number: item.number,
    amount_cents: item.amountCents,
    occurred_on: item.occurredOn,
    due_on: item.dueOn,
    closing_on: item.closingOn,
    reference_month: item.referenceMonth
  }));
}

// src/lib/labels.ts
var ACCOUNT_TYPES = [
  { value: "checking", label: "Conta corrente" },
  { value: "savings", label: "Poupan\xE7a ou reserva" },
  { value: "cash", label: "Dinheiro em esp\xE9cie" },
  { value: "digital", label: "Carteira digital" },
  { value: "other", label: "Outra" }
];
var PAYMENT_METHODS = [
  { value: "pix", label: "Pix" },
  { value: "debit", label: "D\xE9bito" },
  { value: "credit", label: "Cr\xE9dito" },
  { value: "cash", label: "Dinheiro" },
  { value: "boleto", label: "Boleto" },
  { value: "transfer", label: "Transfer\xEAncia" },
  { value: "other", label: "Outra" }
];
var COLORS = ["#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#334155", "#15803d"];
function accountTypeLabel(value) {
  return ACCOUNT_TYPES.find((item) => item.value === value)?.label ?? value;
}
function paymentMethodLabel(value) {
  if (!value) return "\u2014";
  return PAYMENT_METHODS.find((item) => item.value === value)?.label ?? value;
}
function statusLabel(status, type) {
  if (status === "paid") return "Pago";
  if (status === "received") return "Recebido";
  if (status === "pending") return "Pendente";
  if (status === "planned") return "Previsto";
  if (type === "income") return "Receita";
  return status;
}

// src/services/mappers.ts
function text(row, key) {
  const value = row[key];
  return value == null ? "" : String(value);
}
function optionalText(row, key) {
  const value = row[key];
  return value == null || value === "" ? null : String(value);
}
function cents(row, key) {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function optionalInt(row, key) {
  const value = row[key];
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function mapAccount(row) {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    institution: text(row, "institution"),
    type: text(row, "type"),
    initialBalanceCents: cents(row, "initial_balance_cents"),
    color: text(row, "color") || "#1d4ed8",
    archived: row.archived === true,
    createdAt: text(row, "created_at")
  };
}
function mapCategory(row) {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    kind: text(row, "kind"),
    color: text(row, "color") || "#1d4ed8"
  };
}
function mapCard(row) {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    bank: text(row, "bank"),
    limitCents: cents(row, "limit_cents"),
    closingDay: optionalInt(row, "closing_day") ?? 1,
    dueDay: optionalInt(row, "due_day") ?? 1,
    color: text(row, "color") || "#7c3aed",
    archived: row.archived === true
  };
}
function mapTransaction(row) {
  return {
    id: text(row, "id"),
    description: text(row, "description"),
    amountCents: cents(row, "amount_cents"),
    type: text(row, "type"),
    categoryId: optionalText(row, "category_id"),
    accountId: optionalText(row, "account_id"),
    destinationAccountId: optionalText(row, "destination_account_id"),
    creditCardId: optionalText(row, "credit_card_id"),
    occurredOn: text(row, "occurred_on").slice(0, 10),
    dueOn: optionalText(row, "due_on")?.slice(0, 10) ?? null,
    status: text(row, "status"),
    paymentMethod: optionalText(row, "payment_method"),
    notes: optionalText(row, "notes"),
    recurrenceId: optionalText(row, "recurrence_id"),
    installmentGroupId: optionalText(row, "installment_group_id"),
    installmentNumber: optionalInt(row, "installment_number"),
    installmentTotal: optionalInt(row, "installment_total"),
    invoiceId: optionalText(row, "invoice_id"),
    purchasedOn: optionalText(row, "purchased_on")?.slice(0, 10) ?? null,
    externalId: optionalText(row, "external_id"),
    createdAt: text(row, "created_at")
  };
}
function mapRecurrence(row) {
  return {
    id: text(row, "id"),
    description: text(row, "description"),
    amountCents: cents(row, "amount_cents"),
    type: text(row, "type"),
    categoryId: optionalText(row, "category_id"),
    accountId: optionalText(row, "account_id"),
    creditCardId: optionalText(row, "credit_card_id"),
    frequency: text(row, "frequency"),
    interval: optionalInt(row, "interval") ?? 1,
    startOn: text(row, "start_on").slice(0, 10),
    endOn: optionalText(row, "end_on")?.slice(0, 10) ?? null,
    dayOfMonth: optionalInt(row, "day_of_month"),
    paymentMethod: optionalText(row, "payment_method"),
    status: text(row, "status"),
    notes: optionalText(row, "notes")
  };
}
function mapInvoice(row) {
  return {
    id: text(row, "id"),
    creditCardId: text(row, "credit_card_id"),
    referenceMonth: text(row, "reference_month").slice(0, 10),
    closingOn: text(row, "closing_on").slice(0, 10),
    dueOn: text(row, "due_on").slice(0, 10),
    status: text(row, "status"),
    paidOn: optionalText(row, "paid_on")?.slice(0, 10) ?? null,
    paymentAccountId: optionalText(row, "payment_account_id"),
    paymentTransactionId: optionalText(row, "payment_transaction_id")
  };
}

// src/finance/engine.ts
function effectiveDate(transaction) {
  return transaction.dueOn || transaction.occurredOn;
}
function isRealized(transaction, asOf) {
  if (transaction.occurredOn > asOf) return false;
  if (transaction.type === "income") return transaction.status === "received";
  if (transaction.type === "expense") return transaction.status === "paid" && !transaction.creditCardId;
  if (transaction.type === "transfer" || transaction.type === "invoice_payment") return transaction.status === "paid";
  return false;
}
function accountBalance(account, transactions, asOf) {
  let balance = account.initialBalanceCents;
  for (const transaction of transactions) {
    if (!isRealized(transaction, asOf)) continue;
    if (transaction.accountId === account.id && transaction.type === "income") balance += transaction.amountCents;
    if (transaction.accountId === account.id && (transaction.type === "expense" || transaction.type === "transfer" || transaction.type === "invoice_payment")) {
      balance -= transaction.amountCents;
    }
    if (transaction.type === "transfer" && transaction.destinationAccountId === account.id) balance += transaction.amountCents;
  }
  return balance;
}
function totalBalance(accounts, transactions, asOf, includeArchived = false) {
  return accounts.filter((account) => includeArchived || !account.archived).reduce((sum, account) => sum + accountBalance(account, transactions, asOf), 0);
}
function invoiceTotal(invoiceId, transactions) {
  return transactions.filter((transaction) => transaction.invoiceId === invoiceId && transaction.type === "expense").reduce((sum, transaction) => sum + transaction.amountCents, 0);
}
function projectCash(data, target, today) {
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
function monthIncome(transactions, month, mode) {
  const { start, end } = monthRange(month);
  return transactions.reduce((sum, transaction) => {
    if (transaction.type !== "income" || !isWithin(transaction.occurredOn, start, end)) return sum;
    if (mode === "received" && transaction.status !== "received") return sum;
    return sum + transaction.amountCents;
  }, 0);
}
function monthSpending(transactions, month) {
  const { start, end } = monthRange(month);
  return transactions.reduce((sum, transaction) => {
    if (transaction.type !== "expense" || !isWithin(transaction.occurredOn, start, end)) return sum;
    if (transaction.creditCardId) return sum + transaction.amountCents;
    if (transaction.status === "paid") return sum + transaction.amountCents;
    return sum;
  }, 0);
}
function pendingBills(transactions, month, today) {
  const { start, end } = monthRange(month);
  return transactions.filter((transaction) => {
    if (transaction.type !== "expense" || transaction.creditCardId) return false;
    if (transaction.status === "paid") return false;
    const when = effectiveDate(transaction);
    const inMonth = isWithin(when, start, end);
    const overdue = month >= monthKey(today) && when < today && when < start;
    return inMonth || overdue;
  }).sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)));
}
function openInvoicesTotal(data) {
  return data.invoices.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoiceTotal(invoice.id, data.transactions), 0);
}
function committedRatio(data, month) {
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
    ratio: incomeBaseCents > 0 ? committedCents / incomeBaseCents * 100 : null
  };
}
function monthlyHistory(data, month, today, count = 6) {
  const start = shiftMonth(month, -(count - 1));
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const key = shiftMonth(start, index);
    const range = monthRange(key);
    const isCurrent = monthKey(today) === key;
    const isFuture = key > monthKey(today);
    points.push({
      month: key,
      label: formatMonthShort(key),
      incomeCents: monthIncome(data.transactions, key, "received"),
      expenseCents: monthSpending(data.transactions, key),
      balanceCents: totalBalance(data.accounts, data.transactions, isCurrent ? today : range.end),
      projectedCents: isFuture || isCurrent ? projectCash(data, range.end, today) : totalBalance(data.accounts, data.transactions, range.end)
    });
  }
  return points;
}
function expensesByCategory(data, month) {
  const { start, end } = monthRange(month);
  const totals = /* @__PURE__ */ new Map();
  for (const transaction of data.transactions) {
    if (transaction.type !== "expense" || !isWithin(transaction.occurredOn, start, end)) continue;
    if (!transaction.creditCardId && transaction.status !== "paid") continue;
    const key = transaction.categoryId ?? "none";
    totals.set(key, (totals.get(key) ?? 0) + transaction.amountCents);
  }
  return [...totals.entries()].map(([id, totalCents]) => {
    const category = data.categories.find((item) => item.id === id);
    return {
      id,
      name: category?.name ?? "Sem categoria",
      totalCents,
      color: category?.color ?? "#64748b"
    };
  }).sort((a, b) => b.totalCents - a.totalCents);
}
function upcomingItems(data, today, limit = 6) {
  const items = [];
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
      title: `Fatura ${card?.name ?? "do cart\xE3o"}`,
      amountCents: total,
      direction: "out",
      kind: "invoice"
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)).slice(0, limit);
}
function buildDashboard(data, month, today) {
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
    accountSnapshots: data.accounts.filter((account) => !account.archived).map((account) => ({ accountId: account.id, balanceCents: accountBalance(account, data.transactions, today) }))
  };
}
function spendingByCategoryRange(data, start, end, categoryId) {
  return data.transactions.reduce((sum, transaction) => {
    if (transaction.type !== "expense" || transaction.occurredOn < start || transaction.occurredOn > end) return sum;
    if (categoryId && transaction.categoryId !== categoryId) return sum;
    if (!transaction.creditCardId && transaction.status !== "paid") return sum;
    return sum + transaction.amountCents;
  }, 0);
}
function simulatePurchase(input) {
  const count = Math.max(1, input.count);
  const schedule = input.mode === "credit" ? planCreditImpact(input.totalCents, count, input.firstDate, input.closingDay ?? 28, input.dueDay ?? 5) : planBankInstallments({ totalCents: input.totalCents, count, firstDate: input.firstDate }).map((item) => ({
    date: item.dueOn,
    amountCents: item.amountCents,
    label: count === 1 ? "Pagamento \xE0 vista" : `Parcela ${item.number}/${count}`
  }));
  const affected = /* @__PURE__ */ new Map();
  for (const item of schedule) {
    const key = monthKey(item.date);
    affected.set(key, (affected.get(key) ?? 0) + item.amountCents);
  }
  const months = [];
  const horizon = Math.max(count, 3);
  for (let index = 0; index < horizon; index += 1) {
    const key = shiftMonth(monthKey(input.firstDate), index);
    const end = monthRange(key).end;
    const point = end < input.today ? input.today : end;
    const withoutCents = projectCash(input.data, point, input.today);
    const cumulativeCents = schedule.reduce((sum, item) => item.date <= point ? sum + item.amountCents : sum, 0);
    months.push({
      month: key,
      label: formatMonthShort(key),
      withoutCents,
      withCents: withoutCents - cumulativeCents,
      installmentCents: affected.get(key) ?? 0
    });
  }
  const base = committedRatio(input.data, monthKey(input.today));
  const extraThisMonth = affected.get(monthKey(input.today)) ?? 0;
  const ratioAfter = base.incomeBaseCents > 0 ? (base.committedCents + extraThisMonth) / base.incomeBaseCents * 100 : null;
  const negative = months.some((month) => month.withCents < 0);
  const high = (ratioAfter ?? 0) >= 80;
  const tight = (ratioAfter ?? 0) >= 60 || months.some((month) => month.withoutCents > 0 && month.withCents < month.withoutCents * 0.25);
  let verdict = "ok";
  let verdictText = "A compra cabe no planejamento atual. Nenhum m\xEAs da simula\xE7\xE3o fica negativo e a renda comprometida permanece confort\xE1vel.";
  if (base.incomeBaseCents <= 0) {
    verdict = "unknown";
    verdictText = "Ainda n\xE3o h\xE1 receitas previstas neste m\xEAs. D\xE1 para ver o efeito no saldo, mas o percentual da renda s\xF3 aparece depois que voc\xEA cadastrar o que vai receber.";
  } else if (negative) {
    verdict = "risk";
    verdictText = "Essa compra deixa pelo menos um m\xEAs com saldo negativo. O dinheiro dispon\xEDvel n\xE3o cobre as parcelas junto com o que voc\xEA j\xE1 tem a pagar.";
  } else if (high || tight) {
    verdict = "tight";
    verdictText = "A compra n\xE3o zera o saldo, mas aperta o m\xEAs. A renda comprometida fica alta e sobra pouco espa\xE7o para imprevistos.";
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
    schedule
  };
}
function planCreditImpact(totalCents, count, firstDate, closingDay, dueDay) {
  return planCardInstallments({ totalCents, count, purchasedOn: firstDate, closingDay, dueDay }).map((item) => ({
    date: item.dueOn,
    amountCents: item.amountCents,
    label: count === 1 ? "Fatura do cart\xE3o" : `Parcela ${item.number}/${count} na fatura`
  }));
}

// server/answers.ts
function categoryByName(data, name, kind) {
  const target = (name ?? "").trim().toLocaleLowerCase("pt-BR");
  if (!target) return null;
  return data.categories.find((category) => (kind ? category.kind === kind : true) && category.name.toLocaleLowerCase("pt-BR") === target) ?? data.categories.find((category) => category.name.toLocaleLowerCase("pt-BR").includes(target));
}
function answerQuery(query, data, today, text2) {
  const metric = query.metric || "available_balance";
  if (metric === "available_balance" || metric === "account_balance") {
    if (query.account_name) {
      const account = data.accounts.find((item) => item.name.toLocaleLowerCase("pt-BR").includes(query.account_name.toLocaleLowerCase("pt-BR")));
      if (!account) return `N\xE3o encontrei essa conta. Voc\xEA tem: ${data.accounts.map((item) => item.name).join(", ") || "nenhuma conta ainda"}.`;
      const balance2 = accountBalance(account, data.transactions, today);
      return `A conta ${account.name} est\xE1 com ${formatBRL(balance2)} dispon\xEDveis. Esse saldo parte do valor inicial e s\xF3 muda com o que j\xE1 foi recebido, pago, transferido ou usado para quitar fatura.`;
    }
    const balance = totalBalance(data.accounts, data.transactions, today);
    return `Seu saldo dispon\xEDvel hoje \xE9 ${formatBRL(balance)}. Ele soma o dinheiro que j\xE1 est\xE1 nas contas. Receita prevista e fatura em aberto n\xE3o entram nesse n\xFAmero.`;
  }
  if (metric === "month_overview") {
    const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : monthKey(today);
    const dashboard = buildDashboard(data, month, today);
    return [
      `Em ${formatMonthLabel(month)}:`,
      `Receitas j\xE1 recebidas: ${formatBRL(dashboard.incomeCents)}.`,
      `Receitas do m\xEAs, incluindo as que ainda v\xE3o entrar: ${formatBRL(dashboard.incomeExpectedCents)}.`,
      `Despesas j\xE1 pagas e compras no cart\xE3o: ${formatBRL(dashboard.spendingCents)}.`,
      `Contas em aberto: ${formatBRL(dashboard.pendingCents)}.`,
      `Faturas de cart\xE3o ainda n\xE3o pagas, somando todos os meses: ${formatBRL(dashboard.openInvoicesCents)}.`,
      `Proje\xE7\xE3o para o fim do m\xEAs: ${formatBRL(dashboard.projectedEndCents)}.`,
      dashboard.committedRatio == null ? "Ainda n\xE3o h\xE1 receita neste m\xEAs para calcular quanto da renda est\xE1 comprometida." : `Renda comprometida: ${percentLabel(dashboard.committedRatio)}.`
    ].join(" ");
  }
  if (metric === "forecast") {
    const named = text2.match(/\b(30|60|90)\s*dias\b/);
    const days = named ? Number(named[1]) : query.days;
    if (days === 30 || days === 60 || days === 90) {
      const date = addDays(today, days);
      return `Em ${days} dias, no dia ${formatDateBR(date)}, o saldo projetado \xE9 ${formatBRL(projectCash(data, date, today))}. A conta junta o saldo de hoje, receitas ainda n\xE3o recebidas e desconta contas e faturas at\xE9 essa data. Transfer\xEAncia entre suas contas n\xE3o muda o total.`;
    }
    const end = monthRange(monthKey(today)).end;
    return `No fim de ${formatMonthLabel(monthKey(today))}, a proje\xE7\xE3o \xE9 ${formatBRL(projectCash(data, end, today))}. Ela considera o que j\xE1 aconteceu e o que ainda est\xE1 previsto at\xE9 ${formatDateBR(end)}.`;
  }
  if (metric === "category_total") {
    const months = Math.min(24, Math.max(1, Math.round(query.months || (/\btr[eê]s meses\b/i.test(text2) ? 3 : 1))));
    const category = categoryByName(data, query.category_name, "expense") ?? categoryByName(data, text2, "expense");
    if (!category) {
      const names = data.categories.filter((item) => item.kind === "expense").map((item) => item.name);
      return `N\xE3o identifiquei a categoria. Voc\xEA pode perguntar usando um destes nomes: ${names.join(", ")}.`;
    }
    const start = monthRange(shiftMonth(monthKey(today), -(months - 1))).start;
    const total = spendingByCategoryRange(data, start, today, category.id);
    return `Em ${category.name}, de ${formatDateBR(start)} at\xE9 ${formatDateBR(today)}, o total \xE9 ${formatBRL(total)}. Entrei com despesas pagas na conta e compras de cart\xE3o. O pagamento da fatura n\xE3o \xE9 somado de novo.`;
  }
  if (metric === "upcoming") {
    const items = upcomingItems(data, today, 5);
    if (!items.length) return "N\xE3o h\xE1 contas, receitas ou faturas futuras em aberto.";
    const lines = items.map((item) => `${formatDateBR(item.date)}: ${item.title} (${formatBRL(item.amountCents)})`);
    return `Pr\xF3ximos compromissos: ${lines.join("; ")}.`;
  }
  if (metric === "can_afford") {
    const amount = query.amount_cents && query.amount_cents > 0 ? Math.round(query.amount_cents) : null;
    if (!amount) return "Me diga o valor da compra. Exemplo: posso comprar um celular de R$ 3.000?";
    const count = Math.min(48, Math.max(1, Math.round(query.installments || 1)));
    const card = data.cards.find((item) => !item.archived);
    const result = simulatePurchase({
      data,
      today,
      totalCents: amount,
      count,
      firstDate: query.starting_on && /^\d{4}-\d{2}-\d{2}$/.test(query.starting_on) ? query.starting_on : today,
      mode: query.payment === "credit" ? "credit" : "cash",
      closingDay: card?.closingDay,
      dueDay: card?.dueDay
    });
    const first = result.months[0];
    return [
      result.verdictText,
      `Total: ${formatBRL(result.totalCents)}.`,
      `Parcela: ${formatBRL(result.installmentCents)} em ${result.count}x.`,
      first ? `No primeiro m\xEAs, o saldo iria de ${formatBRL(first.withoutCents)} para ${formatBRL(first.withCents)}.` : "",
      result.committedRatio == null ? "Cadastre receitas para eu calcular a renda comprometida." : `Renda comprometida: de ${percentLabel(result.committedRatio)} para ${percentLabel(result.ratioAfter)}.`,
      "Isto \xE9 s\xF3 uma simula\xE7\xE3o. Nada foi lan\xE7ado."
    ].filter(Boolean).join(" ");
  }
  return "Posso dizer seu saldo, o resumo do m\xEAs, uma previs\xE3o, gastos por categoria ou simular uma compra.";
}
function withPoints(title, kind, points) {
  const visible = points.filter((point) => point.totalCents > 0);
  if (!visible.length) return null;
  return { title, kind, points: visible };
}
function chartForQuery(query, data, today, text2) {
  const metric = query.metric || "available_balance";
  if (metric === "available_balance" || metric === "account_balance") {
    const accounts = data.accounts.filter((account) => !account.archived);
    return withPoints("Saldo por conta", "pie", accounts.map((account) => ({
      name: account.name,
      totalCents: Math.max(0, accountBalance(account, data.transactions, today))
    })));
  }
  if (metric === "month_overview") {
    const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : monthKey(today);
    const dashboard = buildDashboard(data, month, today);
    return withPoints(`Como est\xE1 ${formatMonthLabel(month)}`, "pie", [
      { name: "J\xE1 recebi", totalCents: dashboard.incomeCents },
      { name: "J\xE1 paguei", totalCents: dashboard.spendingCents },
      { name: "Ainda vou pagar", totalCents: dashboard.pendingCents }
    ]);
  }
  if (metric === "forecast") {
    return withPoints("Saldo projetado", "bars", [30, 60, 90].map((days) => ({
      name: `${days} dias`,
      totalCents: Math.max(0, projectCash(data, addDays(today, days), today))
    })));
  }
  if (metric === "category_total") {
    const months = Math.min(24, Math.max(1, Math.round(query.months || (/\btr[eê]s meses\b/i.test(text2) ? 3 : 1))));
    const start = monthRange(shiftMonth(monthKey(today), -(months - 1))).start;
    const category = categoryByName(data, query.category_name, "expense") ?? categoryByName(data, text2, "expense");
    if (category) {
      const focus = spendingByCategoryRange(data, start, today, category.id);
      const all = spendingByCategoryRange(data, start, today, null);
      return withPoints(category.name, "pie", [
        { name: category.name, totalCents: focus },
        { name: "Outros gastos", totalCents: Math.max(0, all - focus) }
      ]);
    }
    return withPoints("Gastos por categoria", "pie", data.categories.filter((category2) => category2.kind === "expense").map((category2) => ({ name: category2.name, totalCents: spendingByCategoryRange(data, start, today, category2.id) })).sort((a, b) => b.totalCents - a.totalCents).slice(0, 6));
  }
  if (metric === "upcoming") {
    return withPoints("Pr\xF3ximas contas", "bars", upcomingItems(data, today, 6).map((item) => ({
      name: item.title,
      totalCents: item.amountCents
    })));
  }
  if (metric === "can_afford" && query.amount_cents && query.amount_cents > 0) {
    const card = data.cards.find((item) => !item.archived);
    const result = simulatePurchase({
      data,
      today,
      totalCents: Math.round(query.amount_cents),
      count: Math.min(48, Math.max(1, Math.round(query.installments || 1))),
      firstDate: query.starting_on && /^\d{4}-\d{2}-\d{2}$/.test(query.starting_on) ? query.starting_on : today,
      mode: query.payment === "credit" ? "credit" : "cash",
      closingDay: card?.closingDay,
      dueDay: card?.dueDay
    });
    const first = result.months[0];
    if (!first) return null;
    return withPoints("Efeito da compra no m\xEAs", "bars", [
      { name: "Sem a compra", totalCents: Math.max(0, first.withoutCents) },
      { name: "Com a compra", totalCents: Math.max(0, first.withCents) }
    ]);
  }
  return null;
}

// server/http.ts
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function readHeader(req, name) {
  const headers = req.headers;
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function jsonRecord(value) {
  if (!value.trim()) return {};
  if (value.length > 6e4) throw new HttpError(413, "O pedido est\xE1 grande demais.");
  return JSON.parse(value);
}
async function readJson(req) {
  try {
    if (typeof req.body === "string") return jsonRecord(req.body);
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(req.body)) return jsonRecord(req.body.toString("utf8"));
    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return jsonRecord(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "N\xE3o consegui ler o pedido.");
  }
}
function sendJson(res, status, body) {
  if (typeof res.status === "function") {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function envValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return "";
}

// server/gemini.ts
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
async function geminiJson(prompt, system) {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) {
    throw new HttpError(503, "A chave GEMINI_API_KEY ainda n\xE3o est\xE1 no servidor. O resto do sistema funciona. Coloque a chave no .env, sem o prefixo VITE_, e reinicie.");
  }
  const models = unique([process.env.GEMINI_MODEL ?? "", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]);
  let lastError = "A IA n\xE3o respondeu.";
  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 404) {
      lastError = `O modelo ${model} n\xE3o est\xE1 dispon\xEDvel nesta chave.`;
      continue;
    }
    if (response.status === 429) throw new HttpError(429, "A cota gratuita do Gemini acabou por enquanto. Espere um pouco e tente de novo.");
    if (!response.ok) {
      lastError = "O Gemini recusou o pedido. Confira se a chave gratuita est\xE1 ativa.";
      continue;
    }
    const text2 = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text2) {
      if (payload?.promptFeedback?.blockReason) throw new HttpError(422, "A IA bloqueou essa mensagem. Reformule o pedido.");
      throw new HttpError(422, "A IA voltou sem conte\xFAdo.");
    }
    return text2;
  }
  throw new HttpError(502, lastError);
}
function parseModelJson(text2) {
  const trimmed = text2.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new HttpError(422, "N\xE3o entendi a resposta da IA. Tente uma frase mais direta.");
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new HttpError(422, "N\xE3o entendi a resposta da IA. Tente uma frase mais direta.");
    }
  }
}

// server/supabase.ts
import { createClient } from "@supabase/supabase-js";
function supabaseUrl() {
  return envValue("SUPABASE_URL", "VITE_SUPABASE_URL");
}
function anonKey() {
  return envValue("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
}
async function requireUser(req) {
  const header = readHeader(req, "authorization");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Fa\xE7a login novamente.");
  const url = supabaseUrl();
  const anon = anonKey();
  if (!url || !anon) throw new HttpError(500, "Configure a URL e a chave anon do Supabase no servidor.");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sua sess\xE3o expirou. Entre novamente.");
  return { id: data.user.id, email: data.user.email ?? "", token };
}
function userClient(token) {
  const url = supabaseUrl();
  const anon = anonKey();
  if (!url || !anon) throw new HttpError(500, "Configure a URL e a chave anon do Supabase no servidor.");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}
function adminClient() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new HttpError(503, "Configure SUPABASE_SERVICE_ROLE_KEY s\xF3 no servidor. Ela limita o uso da IA e n\xE3o vai para o navegador.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function consumeAiQuota(userId) {
  const admin = adminClient();
  const since = new Date(Date.now() - 60 * 60 * 1e3).toISOString();
  const usage = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  if (usage.error) throw new HttpError(500, "N\xE3o consegui verificar o limite de uso da IA.");
  if ((usage.count ?? 0) >= 30) {
    throw new HttpError(429, "Voc\xEA chegou a 30 pedidos de IA nesta hora. Esse limite protege a cota gratuita.");
  }
  const inserted = await admin.from("ai_usage").insert({ user_id: userId });
  if (inserted.error) throw new HttpError(500, "N\xE3o consegui registrar o uso da IA.");
}

// server/assistant.ts
var SYSTEM = `Voc\xEA interpreta pedidos do Assistente Financeiro do aplicativo Contas.
Devolva somente JSON. N\xE3o calcule saldo, n\xE3o invente valor e n\xE3o escreva SQL.
Datas em YYYY-MM-DD. amount_cents \xE9 inteiro em centavos: R$ 85 vira 8500 e R$ 1.500,50 vira 150050.
Recebi ou sal\xE1rio = income. Gastei, paguei ou comprei = expense. Transferi entre contas = create_transfer.
Pergunta sobre saldo, gasto, sobra, categoria, previs\xE3o ou "posso comprar" = query. N\xE3o responda o n\xFAmero. Qualquer pergunta sobre os dados da pessoa \xE9 query, mesmo que n\xE3o pe\xE7a para lan\xE7ar.
Se faltar dado para lan\xE7ar, use action clarify.
Formato:
{"action":"chat|clarify|create_transaction|create_transfer|query","message":"","missing":[],"draft":{"description":"","amount_cents":0,"type":"expense","occurred_on":"","due_on":null,"category_name":null,"account_name":null,"card_name":null,"payment_method":null,"notes":null,"status":null,"installments":1},"transfer":{"description":"Transfer\xEAncia","amount_cents":0,"occurred_on":"","from_account_name":"","to_account_name":""},"query":{"metric":"available_balance|month_overview|forecast|category_total|upcoming|can_afford|account_balance","category_name":null,"account_name":null,"month":null,"months":null,"days":null,"amount_cents":null,"installments":null,"payment":null,"starting_on":null}}`;
function forcedQuery(text2) {
  const lower = normalizeText(text2);
  if (/posso comprar|se eu comprar|cabe no orcamento/.test(lower)) return { metric: "can_afford" };
  if (/vai sobrar|fim do mes|previsao|proximos dias|\b30 dias\b|\b60 dias\b|\b90 dias\b/.test(lower)) return { metric: "forecast" };
  if (/quanto gastei|gastos com|gastei com/.test(lower)) return { metric: "category_total" };
  if (/proximas contas|contas a pagar|o que tenho para pagar/.test(lower)) return { metric: "upcoming" };
  if (/quanto tenho|quanto eu tenho|saldo|dinheiro tenho/.test(lower)) return { metric: "available_balance" };
  return null;
}
function inferType(text2) {
  const lower = normalizeText(text2);
  if (/recebi|receber|salario|cliente pagou|entrou/.test(lower)) return "income";
  if (/gastei|gasto|paguei|pagar|comprei|compra|despesa/.test(lower)) return "expense";
  return null;
}
function inferInstallments(text2) {
  const match = text2.match(/\b(\d{1,2})\s*x\b/i) ?? text2.match(/\b(\d{1,2})\s*parcelas?\b/i);
  if (!match) return null;
  const count = Number(match[1]);
  return count >= 1 && count <= 48 ? count : null;
}
async function loadData(token) {
  const client = userClient(token);
  const tables = ["accounts", "categories", "credit_cards", "transactions", "recurrences", "card_invoices"];
  const result = await Promise.all(tables.map(async (table) => {
    const rows = [];
    let from = 0;
    for (; ; ) {
      const { data, error } = await client.from(table).select("*").range(from, from + 999);
      if (error) {
        if (/relation|schema cache/i.test(error.message)) throw new HttpError(500, "O banco ainda n\xE3o tem as tabelas. Execute a migration SQL do projeto.");
        throw new HttpError(500, "N\xE3o consegui ler seus dados para responder com seguran\xE7a.");
      }
      const batch = data ?? [];
      rows.push(...batch);
      if (batch.length < 1e3) break;
      from += 1e3;
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
    contributions: []
  };
}
function buildTransaction(text2, draft, data, today) {
  const type = draft?.type ?? inferType(text2);
  if (!type) return { reply: "Isso \xE9 uma receita ou uma despesa?", confirmation: null };
  const amount = resolveAmountCents(text2, draft?.amount_cents);
  if (!amount) return { reply: "Qual \xE9 o valor? Escreva, por exemplo, R$ 85,00.", confirmation: null };
  const description = (draft?.description ?? "").trim() || text2.replace(/R\$\s*[\d.,]+/g, "").trim();
  if (description.trim().length < 2) return { reply: "Como voc\xEA quer chamar esse lan\xE7amento?", confirmation: null };
  const occurred = resolveOccurredOn(text2, today, draft?.occurred_on);
  const installments = Math.min(48, Math.max(1, Math.round(draft?.installments || inferInstallments(text2) || 1)));
  const accounts = data.accounts.filter((account2) => !account2.archived);
  const cards = data.cards.filter((card2) => !card2.archived);
  const wantsCard = draft?.payment_method === "credit" || Boolean(draft?.card_name) || /cart[aã]o/i.test(text2);
  let card = matchByName(cards, draft?.card_name);
  let account = matchByName(accounts, draft?.account_name);
  if (wantsCard && !card && cards.length === 1) card = cards[0] ?? null;
  if (!card && !account && accounts.length === 1) account = accounts[0] ?? null;
  if (type === "income" && !account) {
    return { reply: accounts.length ? `Entendi uma receita de ${formatBRL(amount)}. Em qual conta ela entra? Voc\xEA tem: ${accounts.map((item) => item.name).join(", ")}.` : "Cadastre uma conta antes. A receita precisa ter onde entrar.", confirmation: null };
  }
  if (type === "expense" && wantsCard && !card) {
    return { reply: cards.length ? `Entendi a compra de ${formatBRL(amount)}. Qual cart\xE3o? Voc\xEA tem: ${cards.map((item) => item.name).join(", ")}.` : "Voc\xEA ainda n\xE3o cadastrou um cart\xE3o. Pode lan\xE7ar em uma conta ou criar o cart\xE3o antes.", confirmation: null };
  }
  if (type === "expense" && !card && !account) {
    return { reply: accounts.length ? `Entendi a despesa de ${formatBRL(amount)}. De qual conta saiu? Voc\xEA tem: ${accounts.map((item) => item.name).join(", ")}.` : "Cadastre uma conta antes de lan\xE7ar essa despesa.", confirmation: null };
  }
  const category = suggestCategory(text2, data.categories, type, draft?.category_name);
  const requested = draft?.status;
  const status = type === "income" ? requested === "planned" || requested === "pending" || requested === "received" ? requested : occurred.date > today ? "planned" : "received" : requested === "planned" || requested === "pending" || requested === "paid" ? requested : occurred.date > today ? "planned" : "paid";
  const safeDescription = description.trim().slice(0, 140);
  const transaction = {
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
    installments
  };
  const lines = [
    `${type === "income" ? "Receita" : "Despesa"} de ${formatBRL(amount)}`,
    `Descri\xE7\xE3o: ${safeDescription}`,
    `Data: ${formatDateBR(occurred.date)}${occurred.assumed ? " \u2014 usei hoje porque a frase n\xE3o trouxe outra data" : ""}`,
    `Categoria: ${category?.name ?? "sem categoria"}`,
    card ? `Cart\xE3o: ${card.name}. A compra n\xE3o sai da conta agora; ela entra na fatura.` : `Conta: ${account?.name ?? "\u2014"}`,
    installments > 1 ? `${installments} parcelas` : "\xC0 vista",
    `Status: ${statusLabel(status, type)}`,
    transaction.payment_method ? `Forma: ${paymentMethodLabel(transaction.payment_method)}` : ""
  ].filter(Boolean);
  return {
    reply: "Separei a pr\xE9via abaixo. Nada foi salvo. Confira os campos e confirme s\xF3 se estiver certo.",
    confirmation: {
      kind: card ? "card_purchase" : installments > 1 ? "bank_installments" : "transaction",
      title: "Pr\xE9via do lan\xE7amento",
      lines,
      draft: transaction
    }
  };
}
async function interpretIntent(prompt) {
  const first = parseModelJson(await geminiJson(prompt, SYSTEM));
  const parsed = intentSchema.safeParse(first);
  if (parsed.success) return parsed.data;
  const second = parseModelJson(await geminiJson(`${prompt}

O JSON anterior era inv\xE1lido. Responda s\xF3 o JSON no formato pedido.`, SYSTEM));
  const again = intentSchema.safeParse(second);
  if (!again.success) throw new HttpError(422, "N\xE3o consegui organizar esse pedido. Tente uma frase direta, como: gastei R$ 85 no mercado hoje.");
  return again.data;
}
function buildTransfer(text2, raw, data, today) {
  const amount = resolveAmountCents(text2, raw?.amount_cents);
  if (!amount) return { reply: "Qual valor voc\xEA quer transferir?", confirmation: null };
  const accounts = data.accounts.filter((account) => !account.archived);
  const from = matchByName(accounts, raw?.from_account_name);
  const to = matchByName(accounts, raw?.to_account_name);
  if (!from || !to) {
    return { reply: `Entre quais contas? Voc\xEA tem: ${accounts.map((account) => account.name).join(", ") || "nenhuma conta"}.`, confirmation: null };
  }
  if (from.id === to.id) return { reply: "Escolha duas contas diferentes. Transfer\xEAncia n\xE3o \xE9 receita nem despesa.", confirmation: null };
  const occurred = resolveOccurredOn(text2, today, raw?.occurred_on);
  return {
    reply: "A transfer\xEAncia s\xF3 muda o lugar do dinheiro. Ela n\xE3o entra como receita nem como despesa. Confirme para salvar.",
    confirmation: {
      kind: "transfer",
      title: "Pr\xE9via da transfer\xEAncia",
      lines: [`${formatBRL(amount)} de ${from.name} para ${to.name}`, `Data: ${formatDateBR(occurred.date)}`],
      draft: {
        description: raw?.description?.trim() || `Transfer\xEAncia para ${to.name}`,
        amount_cents: amount,
        occurred_on: occurred.date,
        from_account_id: from.id,
        to_account_id: to.id
      }
    }
  };
}
function amountFromSpeech(text2) {
  const normalized = normalizeText(text2);
  if (/\b(zero|zerada|zerado|sem saldo)\b/.test(normalized)) return 0;
  const explicit = resolveAmountCents(text2, null);
  if (explicit) return explicit;
  const match = text2.match(/\b\d{1,3}(?:\.\d{3})+(?:,\d{2})?\b|\b\d+(?:,\d{2})\b|\b\d{1,7}\b/);
  if (!match) return null;
  const cents2 = parseMoneyToCents(match[0]);
  if (cents2 == null || cents2 < 0) return null;
  return cents2;
}
function accountNameFrom(text2) {
  return text2.replace(/R\$\s*[\d.]+(?:,\d{1,2})?/gi, " ").replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d{2})?\b/g, " ").replace(/\b\d+(?:,\d{2})\b/g, " ").replace(/\b\d{1,7}\b/g, " ").replace(/\b(tenho|tem|tinha|com|saldo|reais|real|minha|meu|uns|cerca|de|da|do|na|no|em|a|o|hoje|agora|conta|banco)\b/gi, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
function inferAccountType(text2) {
  const normalized = normalizeText(text2);
  if (/dinheiro|especie|bolso|carteira fisica/.test(normalized)) return "cash";
  if (/poupanca|reserva/.test(normalized)) return "savings";
  if (/mercado pago|picpay|paypal|carteira digital/.test(normalized)) return "digital";
  return "checking";
}
function buildAccount(text2, data, earlier) {
  const corpus = `${earlier}
${text2}`;
  const amount = amountFromSpeech(text2) ?? amountFromSpeech(corpus);
  const name = accountNameFrom(text2) || accountNameFrom(earlier);
  if (!name || name.length < 2) {
    return { reply: "Qual \xE9 o nome dessa conta? Exemplo: Nubank com R$ 1.200.", confirmation: null };
  }
  if (amount == null) {
    return { reply: `Quanto tem na conta ${name} agora? Pode ser zero.`, confirmation: null };
  }
  const existing = data.accounts.find((account) => normalizeText(account.name) === normalizeText(name));
  if (existing) {
    return { reply: `A conta ${existing.name} j\xE1 existe. Fale outra conta ou diga: s\xF3 isso.`, confirmation: null };
  }
  const type = inferAccountType(`${name} ${text2}`);
  return {
    reply: "Vou criar a conta com esse saldo inicial. Esse valor \xE9 o dinheiro que j\xE1 est\xE1 l\xE1, n\xE3o uma receita nova. Confirme se estiver certo.",
    confirmation: {
      kind: "account",
      title: "Nova conta",
      lines: [name, `Saldo inicial: ${formatBRL(amount)}`, `Tipo: ${accountTypeLabel(type)}`],
      draft: {
        name,
        institution: name,
        type,
        initial_balance_cents: amount,
        color: COLORS[data.accounts.length % COLORS.length] ?? COLORS[0]
      }
    }
  };
}
async function confirmDraft(token, body, data) {
  const client = userClient(token);
  const today = todayISO();
  const { data: auth } = await client.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) throw new HttpError(401, "Sua sess\xE3o expirou. Entre novamente.");
  if (body.kind === "account") {
    const parsed2 = accountDraftSchema.safeParse(body.draft);
    if (!parsed2.success) throw new HttpError(400, "A pr\xE9via da conta est\xE1 incompleta. Fale o nome e o saldo de novo.");
    const draft2 = parsed2.data;
    if (data.accounts.some((account) => normalizeText(account.name) === normalizeText(draft2.name))) {
      throw new HttpError(400, "J\xE1 existe uma conta com esse nome.");
    }
    const { error: error2 } = await client.from("accounts").insert({
      user_id: userId,
      name: draft2.name,
      institution: draft2.institution,
      type: draft2.type,
      initial_balance_cents: draft2.initial_balance_cents,
      color: draft2.color
    });
    if (error2) throw new HttpError(400, "N\xE3o consegui criar a conta.");
    return `Conta ${draft2.name} criada com saldo inicial de ${formatBRL(draft2.initial_balance_cents)}.`;
  }
  if (body.kind === "transfer") {
    const parsed2 = transferDraftSchema.safeParse(body.draft);
    if (!parsed2.success) throw new HttpError(400, "A pr\xE9via da transfer\xEAncia est\xE1 incompleta. Monte o pedido novamente.");
    const draft2 = parsed2.data;
    if (draft2.from_account_id === draft2.to_account_id) throw new HttpError(400, "Escolha duas contas diferentes.");
    if (!data.accounts.some((account) => account.id === draft2.from_account_id) || !data.accounts.some((account) => account.id === draft2.to_account_id)) {
      throw new HttpError(400, "Uma das contas n\xE3o pertence a voc\xEA.");
    }
    const { error: error2 } = await client.from("transactions").insert({
      user_id: userId,
      description: draft2.description,
      amount_cents: draft2.amount_cents,
      type: "transfer",
      account_id: draft2.from_account_id,
      destination_account_id: draft2.to_account_id,
      occurred_on: draft2.occurred_on,
      status: draft2.occurred_on > today ? "planned" : "paid",
      payment_method: "transfer"
    });
    if (error2) throw new HttpError(400, "N\xE3o consegui salvar a transfer\xEAncia.");
    return `Transfer\xEAncia de ${formatBRL(draft2.amount_cents)} salva. O total das suas contas n\xE3o muda.`;
  }
  const parsed = transactionDraftSchema.safeParse(body.draft);
  if (!parsed.success) throw new HttpError(400, "A pr\xE9via do lan\xE7amento est\xE1 incompleta. Monte o pedido novamente.");
  const draft = parsed.data;
  if (draft.category_id && !data.categories.some((category) => category.id === draft.category_id)) throw new HttpError(400, "A categoria escolhida n\xE3o existe.");
  if (draft.account_id && !data.accounts.some((account) => account.id === draft.account_id)) throw new HttpError(400, "A conta escolhida n\xE3o existe.");
  const card = draft.card_id ? data.cards.find((item) => item.id === draft.card_id && !item.archived) : null;
  if (draft.card_id && !card) throw new HttpError(400, "O cart\xE3o escolhido n\xE3o existe.");
  const count = draft.installments ?? 1;
  if (card) {
    const { error: error2 } = await client.rpc("create_card_purchase", {
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
          dueDay: card.dueDay
        }))
      }
    });
    if (error2) throw new HttpError(400, "N\xE3o consegui lan\xE7ar a compra no cart\xE3o. Se a fatura do m\xEAs j\xE1 estiver paga, desfa\xE7a o pagamento antes.");
    return `Compra de ${formatBRL(draft.amount_cents)} lan\xE7ada no cart\xE3o ${card.name}. O saldo da conta s\xF3 muda quando voc\xEA pagar a fatura.`;
  }
  if (!draft.account_id) throw new HttpError(400, "Escolha a conta desse lan\xE7amento.");
  if (count > 1) {
    if (draft.type !== "expense") throw new HttpError(400, "Parcelamento em conta vale para despesas.");
    const parts = planBankInstallments({ totalCents: draft.amount_cents, count, firstDate: draft.occurred_on });
    const groupId = crypto.randomUUID();
    const { error: error2 } = await client.from("transactions").insert(parts.map((part) => ({
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
      installment_total: count
    })));
    if (error2) throw new HttpError(400, "N\xE3o consegui salvar as parcelas.");
    return `${count} parcelas salvas. A soma continua ${formatBRL(draft.amount_cents)}.`;
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
    notes: draft.notes ?? null
  });
  if (error) throw new HttpError(400, "N\xE3o consegui salvar o lan\xE7amento.");
  return `${draft.type === "income" ? "Receita" : "Despesa"} de ${formatBRL(draft.amount_cents)} salva.`;
}
function isQuestion(text2) {
  if (text2.includes("?")) return true;
  const normalized = normalizeText(text2);
  return /^(quanto|qual|quais|como|posso|mostra|mostre|me mostra|me diga|explica|onde)/.test(normalized) || /\b(saldo|sobra|previsao|grafico|posso comprar|gastei com|quanto tenho|quanto gastei|quanto recebi)\b/.test(normalized);
}
async function handleAssistant(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Use POST.");
    const user = await requireUser(req);
    const body = await readJson(req);
    const data = await loadData(user.token);
    if (body.mode === "confirm") {
      const reply = await confirmDraft(user.token, body, data);
      sendJson(res, 200, { reply, confirmation: null });
      return;
    }
    const text2 = String(body.text ?? "").trim();
    const asking = isQuestion(text2);
    const guide = asking ? null : body.guide === "account" || body.guide === "income" || body.guide === "paid" || body.guide === "upcoming" ? body.guide : null;
    if (text2.length < 2) throw new HttpError(400, "Escreva o que voc\xEA quer fazer.");
    if (text2.length > 2e3) throw new HttpError(400, "A mensagem pode ter no m\xE1ximo 2000 caracteres.");
    const today = todayISO();
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const historyText = history.map((item) => {
      const entry = item;
      return `${entry.role === "user" ? "Pessoa" : "Assistente"}: ${String(entry.content ?? "").slice(0, 300)}`;
    }).join("\n");
    if (guide === "account") {
      const earlier = history.filter((item) => item.role === "user").map((item) => String(item.content ?? "")).join(" ");
      sendJson(res, 200, buildAccount(text2, data, earlier));
      return;
    }
    await consumeAiQuota(user.id);
    const forced = guide ? null : forcedQuery(text2);
    if (forced) {
      const amount = forced.metric === "can_afford" ? resolveAmountCents(text2, null) : null;
      const installments = inferInstallments(text2);
      const category = suggestCategory(text2, data.categories, "expense");
      const query = {
        ...forced,
        amount_cents: amount,
        installments,
        category_name: category?.name ?? null,
        payment: /cart[aã]o|cr[eé]dito/i.test(text2) ? "credit" : "cash",
        months: /tr[eê]s meses/i.test(text2) ? 3 : /dois meses/i.test(text2) ? 2 : 1
      };
      sendJson(res, 200, { reply: answerQuery(query, data, today, text2), chart: chartForQuery(query, data, today, text2), confirmation: null });
      return;
    }
    const guideNote = guide === "income" ? "A pessoa est\xE1 informando uma receita que j\xE1 entrou. Use action create_transaction, type income e status received." : guide === "paid" ? "A pessoa est\xE1 informando uma despesa que j\xE1 pagou. Use action create_transaction, type expense e status paid." : guide === "upcoming" ? "A pessoa est\xE1 informando uma conta que ainda vai pagar. Use action create_transaction, type expense e status pending. Se citar um dia, use esse dia." : "";
    const context = {
      hoje: today,
      contas: data.accounts.filter((account) => !account.archived).map((account) => account.name),
      cartoes: data.cards.filter((card) => !card.archived).map((card) => card.name),
      categorias: data.categories.map((category) => `${category.name} (${category.kind === "income" ? "receita" : "despesa"})`)
    };
    const intent = await interpretIntent(`Contexto:
${JSON.stringify(context)}
${guideNote}

Conversa recente:
${historyText || "(vazia)"}

Pedido:
${text2}`);
    if (!guide && intent.action === "query" && intent.query?.metric) {
      const amount = intent.query.metric === "can_afford" ? resolveAmountCents(text2, intent.query.amount_cents) : intent.query.amount_cents;
      const query = { ...intent.query, amount_cents: amount };
      sendJson(res, 200, { reply: answerQuery(query, data, today, text2), chart: chartForQuery(query, data, today, text2), confirmation: null });
      return;
    }
    if (!guide && intent.action === "create_transfer") {
      sendJson(res, 200, buildTransfer(text2, intent.transfer, data, today));
      return;
    }
    if (!guide && intent.action === "chat") {
      const message = intent.message ?? "";
      sendJson(res, 200, {
        reply: /R\$\s*\d/.test(message) ? "Posso responder com os n\xFAmeros reais dos seus lan\xE7amentos. Pergunte, por exemplo, qual \xE9 o saldo ou quanto vai sobrar no fim do m\xEAs." : message.trim() || "Posso lan\xE7ar receitas e despesas e explicar seu saldo. Nada \xE9 salvo sem a sua confirma\xE7\xE3o.",
        confirmation: null
      });
      return;
    }
    const guidedDate = resolveOccurredOn(text2, today, intent.draft?.occurred_on).date;
    const guidedFuture = guidedDate > today;
    const guidedDraft = guide ? {
      ...intent.draft ?? {},
      type: guide === "income" ? "income" : "expense",
      status: guide === "income" ? guidedFuture ? "planned" : "received" : guide === "paid" ? guidedFuture ? "planned" : "paid" : guidedFuture ? "planned" : "pending"
    } : intent.draft;
    sendJson(res, 200, buildTransaction(text2, guidedDraft, data, today));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const message = error instanceof Error ? error.message : "N\xE3o consegui concluir o pedido.";
    if (!(error instanceof HttpError)) console.error(error);
    sendJson(res, error instanceof HttpError ? status : 500, { error: error instanceof HttpError ? message : "N\xE3o consegui concluir o pedido. Tente novamente." });
  }
}
export {
  handleAssistant
};
