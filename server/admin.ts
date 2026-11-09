import { cardCommittedCents, monthIncome, monthSpending, openInvoicesTotal, pendingBills, projectCash, totalBalance, accountBalance } from "@/finance/engine";
import { currentMonth, monthRange, todayISO } from "@/lib/dates";
import { mapAccount, mapCard, mapInvoice, mapTransaction } from "@/services/mappers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, sendJson, type NodeRequest, type NodeResponse } from "./http";
import { adminClient, requireUser } from "./supabase";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  const allow = adminEmails();
  return allow.length > 0 && allow.includes(email.trim().toLowerCase());
}

async function fetchAll(admin: SupabaseClient, table: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await admin.from(table).select("*").range(from, from + 999);
    if (error) throw new HttpError(500, "Não consegui ler os dados financeiros dos usuários.");
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return rows;
}

function byUser(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = String(row.user_id ?? "");
    if (!id) continue;
    const list = grouped.get(id) ?? [];
    list.push(row);
    grouped.set(id, list);
  }
  return grouped;
}

export async function handleAdmin(req: NodeRequest, res: NodeResponse): Promise<void> {
  try {
    if (req.method !== "GET") throw new HttpError(405, "Use GET.");
    const user = await requireUser(req);
    if (!adminEmails().length) {
      throw new HttpError(503, "Defina ADMIN_EMAIL no servidor com o e-mail que você usa para entrar.");
    }
    if (!isAdminEmail(user.email)) throw new HttpError(403, "Esta área mostra os dados só para o administrador.");
    const probe = new URL(req.url ?? "/", "http://localhost").searchParams.get("probe") === "1";
    if (probe) {
      sendJson(res, 200, { admin: true });
      return;
    }

    const admin = adminClient();
    const authUsers: Array<{ id: string; email?: string; created_at: string; last_sign_in_at?: string | null; user_metadata?: { full_name?: string } }> = [];
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new HttpError(500, "Não consegui ler os cadastros. Confira a chave service_role no servidor.");
      authUsers.push(...data.users);
      if (data.users.length < 200) break;
    }
    const [profiles, accountRows, cardRows, transactionRows, invoiceRows] = await Promise.all([
      admin.from("profiles").select("id, full_name"),
      fetchAll(admin, "accounts"),
      fetchAll(admin, "credit_cards"),
      fetchAll(admin, "transactions"),
      fetchAll(admin, "card_invoices"),
    ]);
    if (profiles.error) throw new HttpError(500, "Não consegui ler os nomes dos cadastros.");
    const names = new Map((profiles.data ?? []).map((profile) => [String(profile.id), String(profile.full_name ?? "")]));
    const accountsByUser = byUser(accountRows);
    const cardsByUser = byUser(cardRows);
    const transactionsByUser = byUser(transactionRows);
    const invoicesByUser = byUser(invoiceRows);
    const today = todayISO();
    const month = currentMonth(today);
    const monthEnd = monthRange(month).end;

    const users = authUsers
      .map((account) => {
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
            archived: item.archived,
          })),
          cards: cards.map((item) => ({
            name: item.name,
            bank: item.bank,
            limitCents: item.limitCents,
            committedCents: cardCommittedCents(item.id, transactions, invoices),
            archived: item.archived,
          })),
          recent: [...transactions]
            .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
            .slice(0, 8)
            .map((item) => ({
              description: item.description,
              amountCents: item.amountCents,
              type: item.type,
              status: item.status,
              occurredOn: item.occurredOn,
            })),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    sendJson(res, 200, { admin: true, users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não consegui abrir o painel.";
    if (!(error instanceof HttpError)) console.error(error);
    sendJson(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? message : "Não consegui abrir o painel." });
  }
}
