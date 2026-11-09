import { monthIncome } from "@/finance/engine";
import { currentMonth } from "@/lib/dates";
import { normalizeText } from "@/lib/utils";
import type { FinanceData } from "@/types/models";

export const GUIDE_STEPS = ["account", "income", "paid", "upcoming"] as const;
export type GuideStep = (typeof GUIDE_STEPS)[number] | "done";

export function isSkip(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 40) return false;
  return /^(nao|nao tenho|nenhum|nenhuma|nada|so isso|somente isso|pode seguir|proxima|proximo|pular|encerrar|chega|pode parar)( por favor)?$/.test(normalized);
}

export function firstGuideStep(data: FinanceData, today: string): GuideStep {
  if (!data.accounts.some((account) => !account.archived)) return "account";
  if (monthIncome(data.transactions, currentMonth(today), "received") === 0) return "income";
  return "paid";
}
