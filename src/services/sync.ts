import { planCardInstallments } from "@/finance/installments";
import { generatedStatus, generationWindow, recurrenceDates } from "@/finance/recurrence";
import { friendlyDbError } from "@/lib/utils";
import { mapInvoice } from "@/services/mappers";
import { requireUserId } from "@/services/session";
import { supabase } from "@/services/supabase";
import type { FinanceData } from "@/types/models";

export async function syncRecurrences(data: FinanceData, today: string): Promise<number> {
  const userId = await requireUserId();
  const { from, until } = generationWindow(today);
  const existing = new Set(data.transactions.filter((item) => item.recurrenceId).map((item) => `${item.recurrenceId}|${item.occurredOn}`));
  const invoices = [...data.invoices];
  const newInvoices: Array<Record<string, string>> = [];
  const pending: Array<{ invoiceKey: string | null; row: Record<string, unknown> }> = [];

  for (const recurrence of data.recurrences) {
    if (recurrence.status !== "active" || (!recurrence.accountId && !recurrence.creditCardId)) continue;
    for (const date of recurrenceDates(recurrence, from, until)) {
      const occurrenceKey = `${recurrence.id}|${date}`;
      if (existing.has(occurrenceKey)) continue;
      if (recurrence.creditCardId) {
        const card = data.cards.find((item) => item.id === recurrence.creditCardId && !item.archived);
        if (!card) continue;
        const plan = planCardInstallments({
          totalCents: recurrence.amountCents,
          count: 1,
          purchasedOn: date,
          closingDay: card.closingDay,
          dueDay: card.dueDay,
        })[0];
        if (!plan) continue;
        const invoiceKey = `${card.id}|${plan.referenceMonth}`;
        const known = invoices.find((invoice) => invoice.creditCardId === card.id && invoice.referenceMonth.slice(0, 7) === plan.referenceMonth.slice(0, 7));
        if (known?.status === "paid") continue;
        if (!known && !newInvoices.some((invoice) => invoice.key === invoiceKey)) {
          newInvoices.push({
            key: invoiceKey,
            user_id: userId,
            credit_card_id: card.id,
            reference_month: plan.referenceMonth,
            closing_on: plan.closingOn,
            due_on: plan.dueOn,
            status: "open",
          });
        }
        pending.push({
          invoiceKey,
          row: {
            user_id: userId,
            description: recurrence.description,
            amount_cents: recurrence.amountCents,
            type: "expense",
            category_id: recurrence.categoryId,
            credit_card_id: card.id,
            occurred_on: date,
            due_on: plan.dueOn,
            status: generatedStatus(date, today),
            payment_method: recurrence.paymentMethod ?? "credit",
            notes: recurrence.notes,
            recurrence_id: recurrence.id,
            purchased_on: date,
          },
        });
      } else {
        pending.push({
          invoiceKey: null,
          row: {
            user_id: userId,
            description: recurrence.description,
            amount_cents: recurrence.amountCents,
            type: recurrence.type,
            category_id: recurrence.categoryId,
            account_id: recurrence.accountId,
            occurred_on: date,
            due_on: date,
            status: generatedStatus(date, today),
            payment_method: recurrence.paymentMethod,
            notes: recurrence.notes,
            recurrence_id: recurrence.id,
          },
        });
      }
      existing.add(occurrenceKey);
    }
  }

  if (!pending.length) return 0;
  if (newInvoices.length) {
    const { error } = await supabase.from("card_invoices").upsert(
      newInvoices.map(({ key: _key, ...invoice }) => invoice),
      { onConflict: "credit_card_id,reference_month", ignoreDuplicates: true },
    );
    if (error) throw new Error(friendlyDbError(error));
  }

  let invoiceRows = invoices;
  if (pending.some((item) => item.invoiceKey)) {
    const { data: fresh, error } = await supabase.from("card_invoices").select("*");
    if (error) throw new Error(friendlyDbError(error));
    invoiceRows = (fresh ?? []).map((row) => mapInvoice(row as Record<string, unknown>));
  }

  const rows = pending.map((item) => {
    if (!item.invoiceKey) return item.row;
    const [cardId, reference] = item.invoiceKey.split("|");
    const invoice = invoiceRows.find((entry) => entry.creditCardId === cardId && entry.referenceMonth.slice(0, 7) === (reference ?? "").slice(0, 7));
    if (!invoice) throw new Error("Não encontrei a fatura de uma recorrência do cartão.");
    return { ...item.row, invoice_id: invoice.id };
  });

  const { error } = await supabase.from("transactions").insert(rows);
  if (error) throw new Error(friendlyDbError(error));
  return rows.length;
}
