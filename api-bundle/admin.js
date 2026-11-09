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
function monthKey(iso) {
  return iso.slice(0, 7);
}
function currentMonth(today = todayISO()) {
  return monthKey(today);
}
function monthRange(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(year, (monthNumber || 1) - 1, 1);
  const end = new Date(year, monthNumber || 1, 0);
  return { start: toISODate(start), end: toISODate(end) };
}
function isWithin(iso, start, end) {
  return iso >= start && iso <= end;
}

// src/lib/money.ts
var moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

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
function cardCommittedCents(cardId, transactions, invoices) {
  const paidInvoiceIds = new Set(invoices.filter((invoice) => invoice.creditCardId === cardId && invoice.status === "paid").map((invoice) => invoice.id));
  return transactions.filter((transaction) => {
    if (transaction.creditCardId !== cardId || transaction.type !== "expense") return false;
    if (transaction.invoiceId && paidInvoiceIds.has(transaction.invoiceId)) return false;
    return transaction.status !== "paid";
  }).reduce((sum, transaction) => sum + transaction.amountCents, 0);
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
function adminClient() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new HttpError(503, "Configure SUPABASE_SERVICE_ROLE_KEY s\xF3 no servidor. Ela limita o uso da IA e n\xE3o vai para o navegador.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// server/admin.ts
function adminEmails() {
  return (process.env.ADMIN_EMAIL ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
}
function isAdminEmail(email) {
  const allow = adminEmails();
  return allow.length > 0 && allow.includes(email.trim().toLowerCase());
}
async function fetchAll(admin, table) {
  const rows = [];
  let from = 0;
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await admin.from(table).select("*").range(from, from + 999);
    if (error) throw new HttpError(500, "N\xE3o consegui ler os dados financeiros dos usu\xE1rios.");
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < 1e3) break;
    from += 1e3;
  }
  return rows;
}
function byUser(rows) {
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const id = String(row.user_id ?? "");
    if (!id) continue;
    const list = grouped.get(id) ?? [];
    list.push(row);
    grouped.set(id, list);
  }
  return grouped;
}
async function handleAdmin(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "Use GET.");
    const user = await requireUser(req);
    if (!adminEmails().length) {
      throw new HttpError(503, "Defina ADMIN_EMAIL no servidor com o e-mail que voc\xEA usa para entrar.");
    }
    if (!isAdminEmail(user.email)) throw new HttpError(403, "Esta \xE1rea mostra os dados s\xF3 para o administrador.");
    const probe = new URL(req.url ?? "/", "http://localhost").searchParams.get("probe") === "1";
    if (probe) {
      sendJson(res, 200, { admin: true });
      return;
    }
    const admin = adminClient();
    const authUsers = [];
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new HttpError(500, "N\xE3o consegui ler os cadastros. Confira a chave service_role no servidor.");
      authUsers.push(...data.users);
      if (data.users.length < 200) break;
    }
    const [profiles, accountRows, cardRows, transactionRows, invoiceRows] = await Promise.all([
      admin.from("profiles").select("id, full_name"),
      fetchAll(admin, "accounts"),
      fetchAll(admin, "credit_cards"),
      fetchAll(admin, "transactions"),
      fetchAll(admin, "card_invoices")
    ]);
    if (profiles.error) throw new HttpError(500, "N\xE3o consegui ler os nomes dos cadastros.");
    const names = new Map((profiles.data ?? []).map((profile) => [String(profile.id), String(profile.full_name ?? "")]));
    const accountsByUser = byUser(accountRows);
    const cardsByUser = byUser(cardRows);
    const transactionsByUser = byUser(transactionRows);
    const invoicesByUser = byUser(invoiceRows);
    const today = todayISO();
    const month = currentMonth(today);
    const monthEnd = monthRange(month).end;
    const users = authUsers.map((account) => {
      const accounts = (accountsByUser.get(account.id) ?? []).map(mapAccount);
      const cards = (cardsByUser.get(account.id) ?? []).map(mapCard);
      const transactions = (transactionsByUser.get(account.id) ?? []).map(mapTransaction);
      const invoices = (invoicesByUser.get(account.id) ?? []).map(mapInvoice);
      const pending = pendingBills(transactions, month, today);
      return {
        id: account.id,
        email: account.email ?? "",
        name: names.get(account.id) || account.user_metadata?.full_name || "",
        createdAt: account.created_at,
        lastSignInAt: account.last_sign_in_at ?? null,
        balanceCents: totalBalance(accounts, transactions, today),
        incomeCents: monthIncome(transactions, month, "received"),
        spendingCents: monthSpending(transactions, month),
        pendingCents: pending.reduce((sum, item) => sum + item.amountCents, 0),
        openInvoicesCents: openInvoicesTotal({ invoices, transactions }),
        projectedEndCents: projectCash({ accounts, transactions, invoices }, monthEnd, today),
        accounts: accounts.map((item) => ({
          name: item.name,
          institution: item.institution,
          type: item.type,
          balanceCents: accountBalance(item, transactions, today),
          archived: item.archived
        })),
        cards: cards.map((item) => ({
          name: item.name,
          bank: item.bank,
          limitCents: item.limitCents,
          committedCents: cardCommittedCents(item.id, transactions, invoices),
          archived: item.archived
        })),
        recent: [...transactions].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)).slice(0, 8).map((item) => ({
          description: item.description,
          amountCents: item.amountCents,
          type: item.type,
          status: item.status,
          occurredOn: item.occurredOn
        }))
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendJson(res, 200, { admin: true, users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "N\xE3o consegui abrir o painel.";
    if (!(error instanceof HttpError)) console.error(error);
    sendJson(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? message : "N\xE3o consegui abrir o painel." });
  }
}
export {
  handleAdmin,
  isAdminEmail
};
