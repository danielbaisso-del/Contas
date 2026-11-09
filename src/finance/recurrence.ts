import { addDays, addMonthsKeepingDay, parseISODate, todayISO } from "@/lib/dates";
import type { Recurrence } from "@/types/models";

export function recurrenceDates(recurrence: Pick<Recurrence, "frequency" | "interval" | "startOn" | "endOn" | "dayOfMonth">, from: string, until: string): string[] {
  const dates: string[] = [];
  const dayOfMonth = recurrence.dayOfMonth ?? parseISODate(recurrence.startOn).getDate();
  const interval = Math.max(1, recurrence.interval);

  if (recurrence.frequency === "weekly") {
    let cursor = recurrence.startOn;
    let guard = 0;
    while (cursor < from && guard < 3000) {
      cursor = addDays(cursor, 7 * interval);
      guard += 1;
    }
    guard = 0;
    while (cursor <= until && guard < 800) {
      if (recurrence.endOn && cursor > recurrence.endOn) break;
      if (cursor >= recurrence.startOn) dates.push(cursor);
      cursor = addDays(cursor, 7 * interval);
      guard += 1;
    }
    return dates;
  }

  const monthStep = recurrence.frequency === "yearly" ? 12 * interval : interval;
  let index = 0;
  let guard = 0;
  while (guard < 800) {
    const cursor = addMonthsKeepingDay(recurrence.startOn, index * monthStep, dayOfMonth);
    if (recurrence.endOn && cursor > recurrence.endOn) break;
    if (cursor > until && index > 0) break;
    if (cursor >= from && cursor >= recurrence.startOn && (!recurrence.endOn || cursor <= recurrence.endOn) && cursor <= until) {
      dates.push(cursor);
    }
    if (cursor > until) break;
    index += 1;
    guard += 1;
  }
  return dates;
}

export function defaultStatusFor(type: "income" | "expense", occurredOn: string, today = todayISO()): "planned" | "pending" | "paid" | "received" {
  if (occurredOn > today) return "planned";
  return type === "income" ? "received" : "paid";
}

export function generatedStatus(occurredOn: string, today = todayISO()): "planned" | "pending" {
  return occurredOn > today ? "planned" : "pending";
}

export function generationWindow(today = todayISO()): { from: string; until: string } {
  return {
    from: `${today.slice(0, 7)}-01`,
    until: addMonthsKeepingDay(today, 12, parseISODate(today).getDate()),
  };
}
