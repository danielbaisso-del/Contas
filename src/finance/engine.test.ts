import { describe, expect, it } from "vitest";
import { balanceParts, buildDashboard, monthlyHistory, projectCash, totalBalance } from "@/finance/engine";
import { planCardInstallments } from "@/finance/installments";
import { recurrenceDates } from "@/finance/recurrence";
import { parseMoneyToCents, splitAmount } from "@/lib/money";
import type { Account, CardInvoice, FinanceData, Transaction } from "@/types/models";

const today = "2026-11-09";

function account(partial: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Principal",
    institution: "Banco",
    type: "checking",
    initialBalanceCents: 100_000,
    color: "#1d4ed8",
    archived: false,
    createdAt: today,
    ...partial,
  };
}

function transaction(partial: Partial<Transaction>): Transaction {
  return {
    id: partial.id ?? "tx",
    description: partial.description ?? "Lançamento",
    amountCents: partial.amountCents ?? 0,
    type: partial.type ?? "expense",
    categoryId: partial.categoryId ?? null,
    accountId: partial.accountId ?? null,
    destinationAccountId: partial.destinationAccountId ?? null,
    creditCardId: partial.creditCardId ?? null,
    occurredOn: partial.occurredOn ?? today,
    dueOn: partial.dueOn ?? null,
    status: partial.status ?? "paid",
    paymentMethod: partial.paymentMethod ?? null,
    notes: null,
    recurrenceId: null,
    installmentGroupId: partial.installmentGroupId ?? null,
    installmentNumber: null,
    installmentTotal: null,
    invoiceId: partial.invoiceId ?? null,
    purchasedOn: null,
    externalId: null,
    createdAt: today,
  };
}

function emptyData(overrides: Partial<FinanceData> = {}): FinanceData {
  return {
    accounts: [account()],
    categories: [],
    cards: [],
    transactions: [],
    recurrences: [],
    invoices: [],
    goals: [],
    contributions: [],
    ...overrides,
  };
}

describe("dinheiro em centavos", () => {
  it("entende os formatos brasileiros", () => {
    expect(parseMoneyToCents("1.500,50")).toBe(150050);
    expect(parseMoneyToCents("1500.50")).toBe(150050);
    expect(parseMoneyToCents("1.500")).toBe(150000);
    expect(parseMoneyToCents("10,5")).toBe(1050);
    expect(parseMoneyToCents("R$ 85")).toBe(8500);
  });

  it("distribui o resto das parcelas sem perder centavos", () => {
    expect(splitAmount(100, 3)).toEqual([34, 33, 33]);
    expect(splitAmount(100, 3).reduce((sum, value) => sum + value, 0)).toBe(100);
  });
});

describe("parcelas de cartão", () => {
  it("joga a compra para a fatura seguinte quando passa do fechamento", () => {
    const early = planCardInstallments({
      totalCents: 30000,
      count: 2,
      purchasedOn: "2026-11-09",
      closingDay: 25,
      dueDay: 5,
    });
    expect(early[0]?.closingOn).toBe("2026-11-25");
    expect(early[0]?.dueOn).toBe("2026-12-05");
    expect(early[1]?.dueOn).toBe("2027-01-05");

    const late = planCardInstallments({
      totalCents: 10000,
      count: 1,
      purchasedOn: "2026-11-28",
      closingDay: 25,
      dueDay: 5,
    });
    expect(late[0]?.closingOn).toBe("2026-12-25");
    expect(late[0]?.dueOn).toBe("2027-01-05");
  });
});

describe("saldos", () => {
  it("ignora compra no cartão e conta o pagamento da fatura uma vez", () => {
    const invoice: CardInvoice = {
      id: "inv-1",
      creditCardId: "card-1",
      referenceMonth: "2026-11-01",
      closingOn: "2026-11-25",
      dueOn: "2026-12-05",
      status: "open",
      paidOn: null,
      paymentAccountId: null,
      paymentTransactionId: null,
    };
    const purchase = transaction({
      id: "purchase",
      type: "expense",
      amountCents: 30_000,
      creditCardId: "card-1",
      invoiceId: "inv-1",
      occurredOn: "2026-11-25",
      status: "pending",
    });
    const paidExpense = transaction({
      id: "market",
      type: "expense",
      amountCents: 20_000,
      accountId: "acc-1",
      occurredOn: "2026-11-08",
      status: "paid",
    });
    const data = emptyData({ invoices: [invoice], transactions: [purchase, paidExpense] });
    expect(totalBalance(data.accounts, data.transactions, today)).toBe(80_000);
    expect(projectCash(data, "2026-12-05", today)).toBe(50_000);

    const paidInvoice: CardInvoice = { ...invoice, status: "paid", paidOn: "2026-11-09" };
    const payment = transaction({
      id: "payment",
      type: "invoice_payment",
      amountCents: 30_000,
      accountId: "acc-1",
      creditCardId: "card-1",
      occurredOn: "2026-11-09",
      status: "paid",
    });
    const settled = emptyData({
      invoices: [paidInvoice],
      transactions: [{ ...purchase, status: "paid" }, paidExpense, payment],
    });
    expect(totalBalance(settled.accounts, settled.transactions, today)).toBe(50_000);
    const dashboard = buildDashboard(settled, "2026-11", today);
    expect(dashboard.spendingCents).toBe(50_000);
    expect(dashboard.openInvoicesCents).toBe(0);
  });

  it("não trata transferência como receita nem despesa", () => {
    const data = emptyData({
      accounts: [account(), account({ id: "acc-2", name: "Reserva", initialBalanceCents: 0 })],
      transactions: [
        transaction({
          id: "transfer",
          type: "transfer",
          amountCents: 20_000,
          accountId: "acc-1",
          destinationAccountId: "acc-2",
          status: "paid",
        }),
      ],
    });
    expect(totalBalance(data.accounts, data.transactions, today)).toBe(100_000);
    const dashboard = buildDashboard(data, "2026-11", today);
    expect(dashboard.incomeCents).toBe(100_000);
    expect(dashboard.spendingCents).toBe(0);
    expect(dashboard.accountSnapshots).toEqual([
      { accountId: "acc-1", balanceCents: 80_000 },
      { accountId: "acc-2", balanceCents: 20_000 },
    ]);
  });

  it("projeta pendências vencidas e receitas futuras", () => {
    const data = emptyData({
      transactions: [
        transaction({
          id: "bill",
          type: "expense",
          amountCents: 10_000,
          accountId: "acc-1",
          occurredOn: "2026-11-01",
          dueOn: "2026-11-20",
          status: "pending",
        }),
        transaction({
          id: "salary",
          type: "income",
          amountCents: 40_000,
          accountId: "acc-1",
          occurredOn: "2026-11-30",
          status: "planned",
        }),
      ],
    });
    expect(projectCash(data, "2026-11-30", today)).toBe(130_000);
    const dashboard = buildDashboard(data, "2026-11", today);
    expect(dashboard.pendingCents).toBe(10_000);
    expect(dashboard.forecasts[0]?.balanceCents).toBe(130_000);
  });

  it("começa no saldo inicial, soma o recebido e subtrai o pago", () => {
    const data = emptyData({
      accounts: [account({ archived: true, initialBalanceCents: 300_000 })],
      transactions: [
        transaction({ id: "in", type: "income", amountCents: 50_000, status: "received", accountId: "acc-1" }),
        transaction({ id: "out", type: "expense", amountCents: 20_000, status: "paid", accountId: "acc-1" }),
        transaction({ id: "later", type: "expense", amountCents: 10_000, status: "pending", accountId: "acc-1", occurredOn: "2026-11-20" }),
      ],
    });
    expect(balanceParts(data.accounts[0]!, data.transactions, today)).toEqual({
      initialCents: 300_000,
      inCents: 50_000,
      outCents: 20_000,
      balanceCents: 330_000,
    });
    expect(totalBalance(data.accounts, data.transactions, today)).toBe(330_000);
    expect(projectCash(data, "2026-11-30", today)).toBe(320_000);
  });

  it("coloca entrada futura e conta pendente no gráfico do mês", () => {
    const data = emptyData({
      transactions: [
        transaction({ id: "in", type: "income", amountCents: 50_000, status: "planned", occurredOn: "2026-11-20", accountId: "acc-1" }),
        transaction({ id: "out", type: "expense", amountCents: 12_000, status: "pending", occurredOn: "2026-11-25", accountId: "acc-1" }),
      ],
    });
    const point = monthlyHistory(data, "2026-11", today, 1)[0];
    expect(point?.incomeCents).toBe(150_000);
    expect(point?.expenseCents).toBe(12_000);
    expect(projectCash(data, "2026-11-30", today)).toBe(100_000 + 50_000 - 12_000);
  });
});

describe("recorrências", () => {
  it("não deixa o dia 31 escorregar para o mês seguinte", () => {
    const dates = recurrenceDates(
      { frequency: "monthly", interval: 1, startOn: "2024-01-31", endOn: "2024-04-30", dayOfMonth: 31 },
      "2024-01-01",
      "2024-04-30",
    );
    expect(dates).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
  });
});
