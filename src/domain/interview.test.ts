import { describe, expect, it } from "vitest";
import { conductInterview, inferEntry, readAmountCents } from "@/domain/interview";
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

  it("entende uma conta a pagar e separa o nome da categoria", () => {
    expect(inferEntry("devo R$ 450 de aluguel")).toBe("upcoming");
    expect(inferEntry("quanto estou devendo")).toBeNull();
    const result = conductInterview("upcoming", "devo R$ 450 de aluguel", null, {
      ...data,
      categories: [{ id: "moradia", name: "Moradia", kind: "expense", color: "#1d4ed8" }],
    }, "2026-11-09");
    expect(result.state.amountCents).toBe(45000);
    expect(result.state.description).toBe("Aluguel");
    expect(result.question).toMatch(/Moradia/);
    expect(result.question).toMatch(/vence/i);
    expect(result.ready).toBe(false);
  });

  it("avisa que vai criar a categoria quando ela não existe", () => {
    const result = conductInterview("upcoming", "devo 80 de petshop", null, data, "2026-11-09");
    expect(result.state.description).toBe("Petshop");
    expect(result.question).toMatch(/criar a categoria Petshop/i);
  });

  it("guarda conta fixa e o número de parcelas sem confundir com o valor", () => {
    const fixed = conductInterview("upcoming", "conta fixa de internet 120", null, data, "2026-11-09");
    expect(fixed.state.fixed).toBe(true);
    expect(fixed.state.amountCents).toBe(12000);
    expect(fixed.state.description).toBe("Internet");
    const parts = conductInterview("upcoming", "geladeira em 3 parcelas de 1200", null, data, "2026-11-09");
    expect(parts.state.installments).toBe(3);
    expect(parts.state.fixed).toBe(false);
    expect(parts.state.amountCents).toBe(120000);
    expect(parts.state.description).toBe("Geladeira");
  });

  it("lança o salário na conta dita, com valor e data", () => {
    const mercado = {
      ...data,
      accounts: [{ id: "mp", name: "Mercado pago", institution: "", type: "digital" as const, initialBalanceCents: 320000, color: "#000000", archived: false, createdAt: "" }],
    };
    const result = conductInterview("income", "lance meu salario na conta do mercado pago, recebi hoje 4110 reais", null, mercado, "2026-11-09");
    expect(result.ready).toBe(true);
    expect(result.state.amountCents).toBe(411000);
    expect(result.state.occurredOn).toBe("2026-11-09");
    expect(result.state.accountId).toBe("mp");
    expect(result.state.description?.toLowerCase()).toContain("sal");
  });

  it("cria a conta que ainda não existe e não esquece o valor", () => {
    const empty = { ...data, accounts: [] };
    const result = conductInterview("income", "já falei", null, empty, "2026-11-09", "lance meu salario na conta do mercado pago, recebi hoje 4110 reais");
    expect(result.ready).toBe(true);
    expect(result.state.amountCents).toBe(411000);
    expect(result.state.occurredOn).toBe("2026-11-09");
    expect(result.state.pendingAccountName?.toLowerCase()).toContain("mercado pago");
  });

  it("lança 3000 na única conta sem pedir de novo onde está o dinheiro", () => {
    const only = {
      ...data,
      accounts: [{ id: "mp", name: "Mercado pago", institution: "", type: "digital" as const, initialBalanceCents: 0, color: "#000000", archived: true, createdAt: "" }],
    };
    const result = conductInterview("income", "recebi 3000 de salario hoje", null, only, "2026-11-09");
    expect(result.ready).toBe(true);
    expect(result.state.amountCents).toBe(300000);
    expect(result.state.accountId).toBe("mp");
    expect(result.state.occurredOn).toBe("2026-11-09");
    expect(result.state.description?.toLowerCase()).toContain("sal");
  });

  it("reconhece a conta arquivada e avisa que vai reativar", () => {
    const archived = {
      ...data,
      accounts: [{ id: "mp", name: "Mercado pago", institution: "", type: "digital" as const, initialBalanceCents: 320000, color: "#000000", archived: true, createdAt: "" }],
    };
    const result = conductInterview("income", "lance meu salario na conta do mercado pago", null, archived, "2026-11-09");
    expect(result.ready).toBe(false);
    expect(result.state.accountId).toBe("mp");
    expect(result.question).toMatch(/Mercado pago/i);
    expect(result.question).toMatch(/reativo/i);
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
