import { addMonthsKeepingDay, dateWithDay, monthKey, parseISODate } from "@/lib/dates";
import { splitAmount } from "@/lib/money";

export interface PlannedInstallment {
  number: number;
  total: number;
  amountCents: number;
  occurredOn: string;
  dueOn: string;
  closingOn: string;
  referenceMonth: string;
}

export function planCardInstallments(input: {
  totalCents: number;
  count: number;
  purchasedOn: string;
  closingDay: number;
  dueDay: number;
}): PlannedInstallment[] {
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
    const dueBase =
      input.dueDay > input.closingDay ? cursor : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const dueOn = dateWithDay(dueBase.getFullYear(), dueBase.getMonth(), input.dueDay);
    const referenceMonth = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
    return {
      number: index + 1,
      total: input.count,
      amountCents,
      occurredOn: closingOn,
      dueOn,
      closingOn,
      referenceMonth,
    };
  });
}

export function planBankInstallments(input: {
  totalCents: number;
  count: number;
  firstDate: string;
}): Array<{ number: number; total: number; amountCents: number; occurredOn: string; dueOn: string }> {
  const amounts = splitAmount(input.totalCents, input.count);
  const day = parseISODate(input.firstDate).getDate();
  return amounts.map((amountCents, index) => {
    const occurredOn =
      index === 0 ? input.firstDate : addMonthsKeepingDay(input.firstDate, index, day);
    return {
      number: index + 1,
      total: input.count,
      amountCents,
      occurredOn,
      dueOn: occurredOn,
    };
  });
}

export function invoiceReferenceKey(creditCardId: string, referenceMonth: string): string {
  return `${creditCardId}:${monthKey(referenceMonth)}`;
}

export function installmentsForDatabase(items: PlannedInstallment[]) {
  return items.map((item) => ({
    number: item.number,
    amount_cents: item.amountCents,
    occurred_on: item.occurredOn,
    due_on: item.dueOn,
    closing_on: item.closingOn,
    reference_month: item.referenceMonth,
  }));
}
