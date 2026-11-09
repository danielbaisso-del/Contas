import { describe, expect, it } from "vitest";
import { conductInterview, readAmountCents } from "@/domain/interview";
import type { FinanceData } from "@/types/models";

const data = {
  accounts: [
    { id: "a", name: "Nubank", institution: "", type: "checking", initialBalanceCents: 0, color: "#000000", archived: false, createdAt: "" },
    { id: "b", name: "Caixa", institution: "", type: "checking", initialBalanceCents: 0, color: "#000000", archived: false, createdAt: "" },
  ],
  categories: [],
  cards: [],
  transactions: [],
  recurrences: [],
  invoices: [],
  goals: [],
  contributions: [],
} satisfies FinanceData;

describe("entrevista da IA", () => {
  it("lê um número solto como reais", () => {
    expect(readAmountCents("3200")).toBe(320000);
    expect(readAmountCents("dia 5")).toBeNull();
  });

  it("pergunta a origem e a data antes de gravar a receita", () => {
    const first = conductInterview("income", "recebi 3200", null, data, "2026-11-09");
    expect(first.ready).toBe(false);
    expect(first.state.amountCents).toBe(320000);
    expect(first.question).toMatch(/De onde veio/i);

    const second = conductInterview("income", "salário", first.state, data, "2026-11-09");
    expect(second.state.description).toBe("Salário");
    expect(second.question).toMatch(/Em que dia/i);

    const third = conductInterview("income", "hoje no Nubank", second.state, data, "2026-11-09");
    expect(third.ready).toBe(true);
    expect(third.state.occurredOn).toBe("2026-11-09");
    expect(third.state.accountId).toBe("a");
  });

  it("aceita valor, origem, data e conta na mesma frase", () => {
    const result = conductInterview("paid", "paguei 150 de internet hoje na Caixa", null, data, "2026-11-09");
    expect(result.ready).toBe(true);
    expect(result.state.amountCents).toBe(15000);
    expect(result.state.description).toBe("Internet");
    expect(result.state.accountId).toBe("b");
    expect(result.state.occurredOn).toBe("2026-11-09");
  });
});
