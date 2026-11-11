import { planBankInstallments } from "@/finance/installments";
import { todayISO } from "@/lib/dates";
import { isTrashedAccount } from "@/lib/trash";
import { supabase } from "@/services/supabase";
import type { Account } from "@/types/models";

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Entre de novo para lançar.");
  return data.user.id;
}

export async function ensureWallet(accounts: Account[]): Promise<string> {
  const existing = accounts.find((account) => !isTrashedAccount(account));
  if (existing) {
    if (existing.archived) {
      const { error } = await supabase.from("accounts").update({ archived: false }).eq("id", existing.id);
      if (error) throw new Error("Não consegui guardar o lançamento.");
    }
    return existing.id;
  }
  const owner = await userId();
  const { data, error } = await supabase.from("accounts").insert({
    user_id: owner,
    name: "Carteira",
    institution: "",
    type: "cash",
    initial_balance_cents: 0,
    color: "#1d4ed8",
  }).select("id").single();
  if (error || !data) throw new Error("Não consegui guardar o lançamento.");
  return String(data.id);
}

export async function updateOpening(accountId: string, amountCents: number, date: string): Promise<void> {
  const localNoon = new Date(`${date}T12:00:00`);
  const { error } = await supabase.from("accounts").update({
    initial_balance_cents: amountCents,
    created_at: localNoon.toISOString(),
  }).eq("id", accountId);
  if (error) throw new Error("Não consegui alterar esse valor.");
}

export async function saveSimpleLaunch(input: {
  kind: "income" | "expense";
  name: string;
  amountCents: number;
  occurredOn: string;
  installments: number;
  id?: string;
}, accounts: Account[]): Promise<void> {
  const accountId = await ensureWallet(accounts);
  const today = todayISO();
  const count = input.id ? 1 : Math.min(48, Math.max(1, input.installments));
  const statusFor = (date: string) => date > today ? "planned" : input.kind === "income" ? "received" : "paid";
  if (input.id || count === 1) {
    const row = {
      description: input.name.trim(),
      amount_cents: input.amountCents,
      type: input.kind,
      occurred_on: input.occurredOn,
      due_on: input.occurredOn,
      status: statusFor(input.occurredOn),
      account_id: accountId,
      category_id: null,
      credit_card_id: null,
      destination_account_id: null,
      payment_method: null,
    };
    const query = input.id
      ? supabase.from("transactions").update(row).eq("id", input.id)
      : supabase.from("transactions").insert({ ...row, user_id: await userId() });
    const { error } = await query;
    if (error) throw new Error("Não consegui salvar o lançamento.");
    return;
  }
  const parts = planBankInstallments({ totalCents: input.amountCents, count, firstDate: input.occurredOn });
  const owner = await userId();
  const groupId = crypto.randomUUID();
  const { error } = await supabase.from("transactions").insert(parts.map((part) => ({
    user_id: owner,
    description: `${input.name.trim()} (${part.number}/${count})`,
    amount_cents: part.amountCents,
    type: input.kind,
    account_id: accountId,
    occurred_on: part.occurredOn,
    due_on: part.dueOn,
    status: statusFor(part.occurredOn),
    installment_group_id: groupId,
    installment_number: part.number,
    installment_total: count,
  })));
  if (error) throw new Error("Não consegui salvar as parcelas.");
}
