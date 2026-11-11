import { openingOn } from "@/finance/engine";
import { isTrashedAccount } from "@/lib/trash";
import type { FinanceData } from "@/types/models";

export interface LaunchItem {
  id: string;
  name: string;
  amountCents: number;
  date: string;
  kind: "income" | "expense";
  groupId: string | null;
  synthetic: boolean;
  accountId: string | null;
}

export function launchItems(data: FinanceData): LaunchItem[] {
  const rows: LaunchItem[] = data.transactions
    .filter((item) => item.type === "income" || item.type === "expense")
    .map((item) => ({
      id: item.id,
      name: item.description,
      amountCents: item.amountCents,
      date: item.dueOn || item.occurredOn,
      kind: item.type === "income" ? "income" : "expense",
      groupId: item.installmentGroupId,
      synthetic: false,
      accountId: item.accountId,
    }));
  const openings: LaunchItem[] = data.accounts
    .filter((account) => account.initialBalanceCents > 0 && !isTrashedAccount(account))
    .map((account) => ({
      id: `open-${account.id}`,
      name: "Valor recebido",
      amountCents: account.initialBalanceCents,
      date: openingOn(account),
      kind: "income",
      groupId: null,
      synthetic: true,
      accountId: account.id,
    }));
  return [...rows, ...openings].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function plainName(name: string): string {
  return name.replace(/\s*\(\d+\/\d+\)\s*$/, "").trim();
}

export function amountLines(cents: number, kind: "income" | "expense"): string[] {
  const sign = kind === "income" ? "+" : "−";
  const reais = Math.abs(cents) / 100;
  if (reais >= 1000) {
    const mil = Math.round((reais / 1000) * 10) / 10;
    return [`${sign}${String(mil).replace(".", ",").replace(",0", "")}`, "mil"];
  }
  return [`${sign}${reais.toLocaleString("pt-BR", { maximumFractionDigits: reais % 1 === 0 ? 0 : 2 })}`];
}
