export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = parseISODate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function currentMonth(today = todayISO()): string {
  return monthKey(today);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, (monthNumber || 1) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(year, (monthNumber || 1) - 1, 1);
  const end = new Date(year, monthNumber || 1, 0);
  return { start: toISODate(start), end: toISODate(end) };
}

export function formatMonthLabel(month: string): string {
  const { start } = monthRange(month);
  const label = parseISODate(start).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatMonthShort(month: string): string {
  const { start } = monthRange(month);
  const label = parseISODate(start).toLocaleDateString("pt-BR", { month: "short" });
  return label.replace(".", "");
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function dateWithDay(year: number, monthIndex: number, day: number): string {
  const clamped = Math.min(Math.max(day, 1), daysInMonth(year, monthIndex));
  return toISODate(new Date(year, monthIndex, clamped));
}

export function addMonthsKeepingDay(anchor: string, monthsToAdd: number, dayOfMonth: number): string {
  const base = parseISODate(anchor);
  const target = new Date(base.getFullYear(), base.getMonth() + monthsToAdd, 1);
  return dateWithDay(target.getFullYear(), target.getMonth(), dayOfMonth);
}

export function compareISO(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isWithin(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

export function monthsBetween(start: string, end: string): number {
  const a = parseISODate(start);
  const b = parseISODate(end);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function weekdayOffset(iso: string): number {
  const day = parseISODate(iso).getDay();
  return day === 0 ? 6 : day - 1;
}

export function calendarCells(month: string): Array<{ iso: string; inMonth: boolean }> {
  const { start, end } = monthRange(month);
  const leading = weekdayOffset(start);
  const cells: Array<{ iso: string; inMonth: boolean }> = [];
  for (let index = leading; index > 0; index -= 1) {
    cells.push({ iso: addDays(start, -index), inMonth: false });
  }
  let cursor = start;
  while (cursor <= end) {
    cells.push({ iso: cursor, inMonth: true });
    cursor = addDays(cursor, 1);
  }
  while (cells.length % 7 !== 0) {
    cells.push({ iso: cursor, inMonth: false });
    cursor = addDays(cursor, 1);
  }
  return cells;
}
