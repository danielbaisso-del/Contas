import { describe, expect, it } from "vitest";
import { continuesInterview } from "@/domain/interview";
import { groundLaunch, groundTransfer } from "@/domain/ground";
import type { FinanceData } from "@/types/models";

const data = {
  accounts: [
    { id: "a", name: "Mercado pago", institution: "", type: "digital", initialBalanceCents: 0, color: "#000000", archived: false, createdAt: "" },
  ],
  categories: [{ id: "moradia", name: "Moradia", kind: "expense", color: "#1d4ed8" }],
  cards: [],
  transactions: [],
  recurrences: [],
  invoices: [],
  goals: [],
  contributions: [],
} satisfies FinanceData;

describe("leitura livre do chat", () => {
  it("acha a conta e avisa a categoria que falta antes de lançar", () => {
    const result = groundLaunch("anota que paguei 40 de pão hoje", data, "2026-11-09", "Entendi um gasto de pão.", {
      description: "Pão",
      type: "expense",
      status: "paid",
    });
    expect(result.ready).toBe(true);
    expect(result.reply).toMatch(/Achei a conta Mercado pago/);
    expect(result.reply).toMatch(/Não achei a categoria Pão/);
    expect(result.reply).toMatch(/Lancei/);
    expect(result.draft?.amountCents).toBe(4000);
    expect(result.draft?.createCategory).toBe("Pão");
    expect(result.draft?.accountId).toBe("a");
  });

  it("não lança quando a conta pedida não existe", () => {
    const result = groundLaunch("paguei 40 de pão hoje na Nubank", data, "2026-11-09", "Entendi.", {
      description: "Pão",
      type: "expense",
      status: "paid",
      account_name: "Nubank",
    });
    expect(result.ready).toBe(false);
    expect(result.reply).toMatch(/Não achei a conta Nubank/);
    expect(result.draft).toBeNull();
  });

  it("usa a categoria que já existe e espera o vencimento", () => {
    const result = groundLaunch("devo R$ 450 de aluguel", data, "2026-11-09", "Você deve o aluguel.", {
      description: "Aluguel",
      type: "expense",
      status: "pending",
      category_name: "Moradia",
    });
    expect(result.ready).toBe(false);
    expect(result.reply).toMatch(/Achei a categoria Moradia/);
    expect(result.reply).toMatch(/vence/i);
    expect(result.interview?.amountCents).toBe(45000);
    expect(result.interview?.description).toBe("Aluguel");
  });

  it("só transfere se achar as duas contas", () => {
    const missing = groundTransfer("transfere 100 hoje para Nubank", data, "2026-11-09", "Mercado pago", "Nubank");
    expect(missing.ready).toBe(false);
    expect(missing.reply).toMatch(/Não achei a conta de destino/);
    const found = groundTransfer("transfere 100 hoje do Mercado pago para Caixa", {
      ...data,
      accounts: [
        ...data.accounts,
        { id: "b", name: "Caixa", institution: "", type: "checking", initialBalanceCents: 0, color: "#000", archived: false, createdAt: "" },
      ],
    }, "2026-11-09", "Mercado pago", "Caixa");
    expect(found.ready).toBe(true);
    expect(found.amountCents).toBe(10000);
  });

  it("deixa uma frase nova sair do lançamento que estava aberto", () => {
    const open = { kind: "upcoming" as const, amountCents: 45000, occurredOn: null, description: "Aluguel", accountId: "a" };
    expect(continuesInterview("dia 10", open, data, "2026-11-09")).toBe(true);
    expect(continuesInterview("anota também 20 de pão", open, data, "2026-11-09")).toBe(false);
  });
});
