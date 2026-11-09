export const ACCOUNT_TYPES = [
  { value: "checking", label: "Conta corrente" },
  { value: "savings", label: "Poupança ou reserva" },
  { value: "cash", label: "Dinheiro em espécie" },
  { value: "digital", label: "Carteira digital" },
  { value: "other", label: "Outra" },
] as const;

export const PAYMENT_METHODS = [
  { value: "pix", label: "Pix" },
  { value: "debit", label: "Débito" },
  { value: "credit", label: "Crédito" },
  { value: "cash", label: "Dinheiro" },
  { value: "boleto", label: "Boleto" },
  { value: "transfer", label: "Transferência" },
  { value: "other", label: "Outra" },
] as const;

export const FREQUENCIES = [
  { value: "weekly:1", label: "Toda semana" },
  { value: "weekly:2", label: "A cada 15 dias" },
  { value: "monthly:1", label: "Todo mês" },
  { value: "monthly:2", label: "A cada 2 meses" },
  { value: "monthly:3", label: "A cada 3 meses" },
  { value: "yearly:1", label: "Todo ano" },
] as const;

export const COLORS = ["#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#334155", "#15803d"];

export function accountTypeLabel(value: string): string {
  return ACCOUNT_TYPES.find((item) => item.value === value)?.label ?? value;
}

export function paymentMethodLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return PAYMENT_METHODS.find((item) => item.value === value)?.label ?? value;
}

export function statusLabel(status: string, type?: string): string {
  if (status === "paid") return "Pago";
  if (status === "received") return "Recebido";
  if (status === "pending") return "Pendente";
  if (status === "planned") return "Previsto";
  if (type === "income") return "Receita";
  return status;
}

export function typeLabel(type: string): string {
  if (type === "income") return "Receita";
  if (type === "expense") return "Despesa";
  if (type === "transfer") return "Transferência";
  if (type === "invoice_payment") return "Pagamento de fatura";
  return type;
}

export function frequencyLabel(frequency: string, interval: number): string {
  const key = `${frequency}:${interval}`;
  return FREQUENCIES.find((item) => item.value === key)?.label ?? "Recorrente";
}

export function frequencyValue(frequency: string, interval: number): string {
  return `${frequency}:${interval}`;
}

export function parseFrequency(value: string): { frequency: "weekly" | "monthly" | "yearly"; interval: number } {
  const [frequency, interval] = value.split(":");
  if (frequency !== "weekly" && frequency !== "monthly" && frequency !== "yearly") {
    return { frequency: "monthly", interval: 1 };
  }
  return { frequency, interval: Number(interval) || 1 };
}
