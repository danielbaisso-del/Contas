const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(cents: number | null | undefined): string {
  const value = Number.isFinite(cents) ? (cents as number) / 100 : 0;
  return moneyFormatter.format(value);
}

export function centsToInput(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseMoneyToCents(input: string): number | null {
  let raw = input.trim().replace(/\s/g, "").replace(/r\$/gi, "");
  if (!raw) return null;
  raw = raw.replace(/[^\d,.-]/g, "");
  if (!raw) return null;
  const negative = raw.includes("-");
  raw = raw.replace(/-/g, "");
  if (!raw) return null;

  let cents: number;
  if (raw.includes(",")) {
    const [integerPart, decimalPart = ""] = raw.split(",");
    const integers = integerPart.replace(/\./g, "");
    if (!/^\d*$/.test(integers) || !/^\d*$/.test(decimalPart)) return null;
    const decimals = `${decimalPart}00`.slice(0, 2);
    cents = Number(integers || "0") * 100 + Number(decimals);
  } else if (raw.includes(".")) {
    const parts = raw.split(".");
    if (!parts.every((part) => /^\d+$/.test(part))) return null;
    const last = parts[parts.length - 1] ?? "";
    const groupedThousands =
      parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
    if (groupedThousands && (parts.length > 2 || last.length === 3)) {
      cents = Number(parts.join("")) * 100;
    } else if (parts.length === 2 && last.length > 0 && last.length <= 2) {
      const decimals = `${last}00`.slice(0, 2);
      cents = Number(parts[0] || "0") * 100 + Number(decimals);
    } else {
      return null;
    }
  } else {
    if (!/^\d+$/.test(raw)) return null;
    cents = Number(raw) * 100;
  }

  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function splitAmount(totalCents: number, count: number): number[] {
  if (count < 1) throw new Error("Quantidade de parcelas inválida.");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function percentLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

export function variationPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
