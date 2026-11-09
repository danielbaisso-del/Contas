import { accountBalance, buildDashboard, cardCommittedCents, invoiceTotal, projectCash, simulatePurchase, spendingByCategoryRange, totalBalance, upcomingItems } from "@/finance/engine";
import { addDays, formatDateBR, formatMonthLabel, monthKey, monthRange, shiftMonth } from "@/lib/dates";
import { formatBRL, percentLabel } from "@/lib/money";
import { normalizeText } from "@/lib/utils";
import type { AssistantChart, AssistantPlace } from "@/domain/assistant";
import type { FinanceData } from "@/types/models";

interface QueryDraft {
  metric?: string | null;
  category_name?: string | null;
  account_name?: string | null;
  month?: string | null;
  months?: number | null;
  days?: number | null;
  amount_cents?: number | null;
  installments?: number | null;
  payment?: "cash" | "credit" | null;
  starting_on?: string | null;
}

function openMoney(data: FinanceData) {
  const receive = data.transactions.filter((item) => item.type === "income" && item.status !== "received");
  const pay = data.transactions.filter((item) => item.type === "expense" && !item.creditCardId && item.status !== "paid");
  const invoices = data.invoices.filter((invoice) => invoice.status !== "paid" && invoiceTotal(invoice.id, data.transactions) > 0);
  const receiveCents = receive.reduce((sum, item) => sum + item.amountCents, 0);
  const billCents = pay.reduce((sum, item) => sum + item.amountCents, 0);
  const invoiceCents = invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice.id, data.transactions), 0);
  return { receive, pay, invoices, receiveCents, billCents, invoiceCents, debtCents: billCents + invoiceCents };
}

function categoryByName(data: FinanceData, name: string | null | undefined, kind?: "income" | "expense") {
  const target = (name ?? "").trim().toLocaleLowerCase("pt-BR");
  if (!target) return null;
  return data.categories.find((category) => (kind ? category.kind === kind : true) && category.name.toLocaleLowerCase("pt-BR") === target)
    ?? data.categories.find((category) => category.name.toLocaleLowerCase("pt-BR").includes(target));
}

export function answerQuery(query: QueryDraft, data: FinanceData, today: string, text: string): string {
  const metric = query.metric || "available_balance";
  if (metric === "available_balance" || metric === "account_balance") {
    if (query.account_name) {
      const account = data.accounts.find((item) => item.name.toLocaleLowerCase("pt-BR").includes(query.account_name!.toLocaleLowerCase("pt-BR")));
      if (!account) return `Não encontrei essa conta. Você tem: ${data.accounts.map((item) => item.name).join(", ") || "nenhuma conta ainda"}.`;
      const balance = accountBalance(account, data.transactions, today);
      return [
        `Relatório da conta ${account.name}`,
        "",
        `Disponível agora: ${formatBRL(balance)}.`,
        "Esse saldo parte do valor inicial e só muda com o que já foi recebido, pago, transferido ou usado para quitar fatura.",
        "",
        "A tela Contas mostra esta conta junto com as outras, já com o saldo de hoje.",
      ].join("\n");
    }
    const balance = totalBalance(data.accounts, data.transactions, today);
    const lines = data.accounts.filter((item) => !item.archived).map((item) => `${item.name}: ${formatBRL(accountBalance(item, data.transactions, today))}`);
    return [
      "Relatório de saldo",
      "",
      `Disponível hoje, somando as contas: ${formatBRL(balance)}.`,
      lines.length ? lines.join("\n") : "Ainda não há conta cadastrada.",
      "",
      "Receita que ainda vai entrar e conta que ainda vai pagar não entram nesse número.",
    ].join("\n");
  }

  if (metric === "month_overview") {
    const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : monthKey(today);
    const dashboard = buildDashboard(data, month, today);
    return [
      `Relatório de ${formatMonthLabel(month)}`,
      "",
      `Já recebi: ${formatBRL(dashboard.incomeCents)}.`,
      `Ainda vai entrar neste mês: ${formatBRL(Math.max(0, dashboard.incomeExpectedCents - dashboard.incomeCents))}.`,
      `Já paguei, com as compras do cartão: ${formatBRL(dashboard.spendingCents)}.`,
      `Contas em aberto: ${formatBRL(dashboard.pendingCents)}.`,
      `Faturas ainda não pagas, somando todos os meses: ${formatBRL(dashboard.openInvoicesCents)}.`,
      `Projeção no fim do mês: ${formatBRL(dashboard.projectedEndCents)}.`,
      dashboard.committedRatio == null
        ? "Ainda não há receita neste mês para calcular a renda comprometida."
        : `Renda comprometida: ${percentLabel(dashboard.committedRatio)}.`,
      "",
      "A visão geral mostra estes mesmos números e os gráficos do mês.",
    ].join("\n");
  }

  if (metric === "forecast") {
    const named = text.match(/\b(30|60|90)\s*dias\b/);
    const days = named ? Number(named[1]) : query.days;
    if (days === 30 || days === 60 || days === 90) {
      const date = addDays(today, days);
      const rows = [30, 60, 90].map((span) => `${span} dias, ${formatDateBR(addDays(today, span))}: ${formatBRL(projectCash(data, addDays(today, span), today))}`);
      return [
        "Relatório de previsão",
        "",
        `Em ${days} dias, no dia ${formatDateBR(date)}, o saldo projetado é ${formatBRL(projectCash(data, date, today))}.`,
        ...rows,
        "",
        "A conta junta o saldo de hoje, o que ainda entra e desconta contas e faturas até a data. Transferência entre suas contas não muda o total. A visão geral mostra estes três prazos.",
      ].join("\n");
    }
    const month = monthKey(today);
    const end = monthRange(month).end;
    const projected = buildDashboard(data, month, today).projectedEndCents;
    return [
      `No fim de ${formatMonthLabel(month)} vão sobrar ${formatBRL(projected)}.`,
      `A data desse cálculo é ${formatDateBR(end)}.`,
      "Esse valor junta o saldo de hoje, soma o que ainda entra até o fim do mês e tira o que ainda sai.",
    ].join("\n");
  }

  if (metric === "debt") {
    const open = openMoney(data);
    const lines = [
      ...open.pay.map((item) => `${item.description}: ${formatBRL(item.amountCents)}`),
      ...open.invoices.map((invoice) => {
        const card = data.cards.find((item) => item.id === invoice.creditCardId);
        return `Fatura ${card?.name ?? "do cartão"}: ${formatBRL(invoiceTotal(invoice.id, data.transactions))}`;
      }),
    ];
    return [
      `Você está devendo ${formatBRL(open.debtCents)}.`,
      open.billCents ? `Contas em aberto: ${formatBRL(open.billCents)}.` : "Não há conta bancária em aberto.",
      open.invoiceCents ? `Faturas de cartão: ${formatBRL(open.invoiceCents)}.` : "Não há fatura em aberto.",
      lines.length ? lines.join("\n") : "",
      "A tela A pagar e receber lista cada uma. Em uma conta, o botão Paguei tira o valor do saldo.",
    ].filter(Boolean).join("\n");
  }

  if (metric === "open_items") {
    const open = openMoney(data);
    const incoming = open.receive.map((item) => `${item.description}: ${formatBRL(item.amountCents)}`);
    return [
      `Ainda vai receber ${formatBRL(open.receiveCents)}.`,
      `Ainda vai pagar ${formatBRL(open.debtCents)}.`,
      incoming.length ? `A receber:\n${incoming.join("\n")}` : "Não há receita pendente.",
      "O que vai pagar está em Contas a pagar, junto com as faturas.",
    ].join("\n");
  }

  if (metric === "cards") {
    const cards = data.cards.filter((card) => !card.archived);
    if (!cards.length) return "Você ainda não cadastrou cartão. Na tela Cartões dá para colocar o limite, o fechamento e o vencimento.";
    const lines = cards.map((card) => {
      const used = cardCommittedCents(card.id, data.transactions, data.invoices);
      return `${card.name}: limite ${formatBRL(card.limitCents)}, disponível ${formatBRL(card.limitCents - used)}, fecha dia ${card.closingDay}, vence dia ${card.dueDay}.`;
    });
    return ["Seus cartões:", ...lines, "A compra no cartão não sai da conta. O dinheiro sai quando a fatura é paga."].join("\n");
  }

  if (metric === "category_total") {
    const months = Math.min(24, Math.max(1, Math.round(query.months || (/\btr[eê]s meses\b/i.test(text) ? 3 : 1))));
    const category = categoryByName(data, query.category_name, "expense") ?? categoryByName(data, text, "expense");
    if (!category) {
      const names = data.categories.filter((item) => item.kind === "expense").map((item) => item.name);
      return `Não identifiquei a categoria. Você pode perguntar usando um destes nomes: ${names.join(", ")}.`;
    }
    const start = monthRange(shiftMonth(monthKey(today), -(months - 1))).start;
    const total = spendingByCategoryRange(data, start, today, category.id);
    const all = spendingByCategoryRange(data, start, today, null);
    return [
      `Relatório de ${category.name}`,
      "",
      `De ${formatDateBR(start)} até ${formatDateBR(today)}: ${formatBRL(total)}.`,
      `Todos os gastos no mesmo período: ${formatBRL(all)}.`,
      "Entrei com despesas pagas na conta e compras de cartão. O pagamento da fatura não entra de novo.",
      "",
      "O relatório completo do período lista todas as categorias, os cartões e as contas. A linha desta categoria fica destacada.",
    ].join("\n");
  }

  if (metric === "upcoming") {
    const items = upcomingItems(data, today, 5);
    if (!items.length) return "Não há contas, receitas ou faturas futuras em aberto.\n\nA tela A pagar e receber mostra o que ainda falta.";
    const lines = items.map((item) => `${formatDateBR(item.date)}: ${item.title} (${formatBRL(item.amountCents)})`);
    return [
      "Relatório das próximas contas",
      "",
      ...lines,
      "",
      "A tela A pagar e receber abre essa lista, com o botão para marcar como pago ou recebido.",
    ].join("\n");
  }

  if (metric === "can_afford") {
    const amount = query.amount_cents && query.amount_cents > 0 ? Math.round(query.amount_cents) : null;
    if (!amount) return "Me diga o valor da compra. Exemplo: posso comprar um celular de R$ 3.000?";
    const count = Math.min(48, Math.max(1, Math.round(query.installments || 1)));
    const card = data.cards.find((item) => !item.archived);
    const result = simulatePurchase({
      data,
      today,
      totalCents: amount,
      count,
      firstDate: query.starting_on && /^\d{4}-\d{2}-\d{2}$/.test(query.starting_on) ? query.starting_on : today,
      mode: query.payment === "credit" ? "credit" : "cash",
      closingDay: card?.closingDay,
      dueDay: card?.dueDay,
    });
    const first = result.months[0];
    return [
      result.verdictText,
      `Total: ${formatBRL(result.totalCents)}.`,
      `Parcela: ${formatBRL(result.installmentCents)} em ${result.count}x.`,
      first ? `No primeiro mês, o saldo iria de ${formatBRL(first.withoutCents)} para ${formatBRL(first.withCents)}.` : "",
      result.committedRatio == null ? "Cadastre receitas para eu calcular a renda comprometida." : `Renda comprometida: de ${percentLabel(result.committedRatio)} para ${percentLabel(result.ratioAfter)}.`,
      "Isto é só uma simulação. Nada foi lançado.",
      "",
      "O simulador abre com este valor, estas parcelas e o resultado já calculado.",
    ].filter(Boolean).join("\n");
  }

  return "Eu respondo quanto você tem, quanto deve, o que ainda falta e quanto sobra no fim do mês.";
}

function withPoints(title: string, kind: "pie" | "bars", points: Array<{ name: string; totalCents: number }>): AssistantChart | null {
  const visible = points.filter((point) => point.totalCents > 0);
  if (!visible.length) return null;
  return { title, kind, points: visible };
}

export function chartForQuery(query: QueryDraft, data: FinanceData, today: string, text: string): AssistantChart | null {
  const metric = query.metric || "available_balance";
  if (metric === "available_balance" || metric === "account_balance") {
    const accounts = data.accounts.filter((account) => !account.archived);
    return withPoints("Saldo por conta", "pie", accounts.map((account) => ({
      name: account.name,
      totalCents: Math.max(0, accountBalance(account, data.transactions, today)),
    })));
  }
  if (metric === "month_overview") {
    const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : monthKey(today);
    const dashboard = buildDashboard(data, month, today);
    return withPoints(`Como está ${formatMonthLabel(month)}`, "pie", [
      { name: "Já recebi", totalCents: dashboard.incomeCents },
      { name: "Já paguei", totalCents: dashboard.spendingCents },
      { name: "Ainda vou pagar", totalCents: dashboard.pendingCents },
    ]);
  }
  if (metric === "forecast") {
    const named = text.match(/\b(30|60|90)\s*dias\b/);
    if (named) {
      return withPoints("Saldo projetado", "bars", [30, 60, 90].map((days) => ({
        name: `${days} dias`,
        totalCents: Math.max(0, projectCash(data, addDays(today, days), today)),
      })));
    }
    return withPoints("Saldo previsto", "bars", [{
      name: "Fim do mês",
      totalCents: Math.max(0, buildDashboard(data, monthKey(today), today).projectedEndCents),
    }]);
  }
  if (metric === "category_total") {
    const months = Math.min(24, Math.max(1, Math.round(query.months || (/\btr[eê]s meses\b/i.test(text) ? 3 : 1))));
    const start = monthRange(shiftMonth(monthKey(today), -(months - 1))).start;
    const category = categoryByName(data, query.category_name, "expense") ?? categoryByName(data, text, "expense");
    if (category) {
      const focus = spendingByCategoryRange(data, start, today, category.id);
      const all = spendingByCategoryRange(data, start, today, null);
      return withPoints(category.name, "pie", [
        { name: category.name, totalCents: focus },
        { name: "Outros gastos", totalCents: Math.max(0, all - focus) },
      ]);
    }
    return withPoints("Gastos por categoria", "pie", data.categories
      .filter((category) => category.kind === "expense")
      .map((category) => ({ name: category.name, totalCents: spendingByCategoryRange(data, start, today, category.id) }))
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 6));
  }
  if (metric === "upcoming" || metric === "debt" || metric === "open_items") {
    const open = openMoney(data);
    const points = metric === "open_items"
      ? [{ name: "A receber", totalCents: open.receiveCents }, { name: "A pagar", totalCents: open.debtCents }]
      : [
          ...open.pay.map((item) => ({ name: item.description, totalCents: item.amountCents })),
          ...open.invoices.map((invoice) => ({ name: `Fatura ${data.cards.find((card) => card.id === invoice.creditCardId)?.name ?? "cartão"}`, totalCents: invoiceTotal(invoice.id, data.transactions) })),
        ];
    return withPoints(metric === "open_items" ? "O que ainda falta" : "Quanto você deve", metric === "open_items" ? "pie" : "bars", points);
  }
  if (metric === "cards") {
    return withPoints("Limite disponível", "bars", data.cards.filter((card) => !card.archived).map((card) => ({
      name: card.name,
      totalCents: Math.max(0, card.limitCents - cardCommittedCents(card.id, data.transactions, data.invoices)),
    })));
  }
  if (metric === "can_afford" && query.amount_cents && query.amount_cents > 0) {
    const card = data.cards.find((item) => !item.archived);
    const result = simulatePurchase({
      data,
      today,
      totalCents: Math.round(query.amount_cents),
      count: Math.min(48, Math.max(1, Math.round(query.installments || 1))),
      firstDate: query.starting_on && /^\d{4}-\d{2}-\d{2}$/.test(query.starting_on) ? query.starting_on : today,
      mode: query.payment === "credit" ? "credit" : "cash",
      closingDay: card?.closingDay,
      dueDay: card?.dueDay,
    });
    const first = result.months[0];
    if (!first) return null;
    return withPoints("Efeito da compra no mês", "bars", [
      { name: "Sem a compra", totalCents: Math.max(0, first.withoutCents) },
      { name: "Com a compra", totalCents: Math.max(0, first.withCents) },
    ]);
  }
  return null;
}

function search(path: string, values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function placeForQuery(query: QueryDraft, data: FinanceData, today: string, text: string): AssistantPlace {
  const metric = query.metric || "available_balance";
  if (metric === "available_balance" || metric === "account_balance") {
    const account = query.account_name
      ? data.accounts.find((item) => item.name.toLocaleLowerCase("pt-BR").includes(query.account_name!.toLocaleLowerCase("pt-BR")))
      : null;
    return account
      ? { label: "Ver no gráfico", to: search("/contas", { conta: account.id }) }
      : { label: "Ver no gráfico", to: "/contas" };
  }
  if (metric === "month_overview") {
    const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : monthKey(today);
    return { label: "Ver no gráfico", to: `/?mes=${month}#graficos` };
  }
  if (metric === "forecast") {
    return { label: "Ver no gráfico", to: `/?mes=${monthKey(today)}#previsao` };
  }
  if (metric === "category_total") {
    const months = Math.min(24, Math.max(1, Math.round(query.months || (/\btr[eê]s meses\b/i.test(text) ? 3 : 1))));
    const start = shiftMonth(monthKey(today), -(months - 1));
    const category = categoryByName(data, query.category_name, "expense") ?? categoryByName(data, text, "expense");
    return {
      label: "Ver no gráfico",
      to: search("/relatorios", { de: start, ate: monthKey(today), foco: category?.name ?? null }),
    };
  }
  if (metric === "upcoming" || metric === "debt" || metric === "open_items") {
    return { label: "Ver as contas", to: "/compromissos" };
  }
  if (metric === "cards") {
    return { label: "Abrir cartões", to: "/cartoes" };
  }
  if (metric === "can_afford") {
    const count = Math.min(48, Math.max(1, Math.round(query.installments || 1)));
    return {
      label: "Abrir a simulação completa",
      to: search("/simulador", {
        valor: query.amount_cents && query.amount_cents > 0 ? Math.round(query.amount_cents) : null,
        parcelas: count,
        forma: query.payment === "credit" ? "credit" : "cash",
        data: query.starting_on && /^\d{4}-\d{2}-\d{2}$/.test(query.starting_on) ? query.starting_on : today,
      }),
    };
  }
  return { label: "Ver na visão geral", to: "/" };
}

export function placeFromText(text: string): AssistantPlace | null {
  const normalized = normalizeText(text);
  if (/meta/.test(normalized)) return { label: "Abrir Metas", to: "/metas" };
  if (/recorr/.test(normalized)) return { label: "Abrir recorrências", to: "/recorrencias" };
  if (/cartao|fatura/.test(normalized)) return { label: "Abrir cartões", to: "/cartoes" };
  if (/import/.test(normalized)) return { label: "Abrir importação", to: "/importar" };
  if (/calend|pagar|receber|venc/.test(normalized)) return { label: "Ver as contas", to: "/compromissos" };
  if (/relatorio|grafico/.test(normalized)) return { label: "Abrir relatórios", to: "/relatorios" };
  if (/simul|posso comprar/.test(normalized)) return { label: "Abrir o simulador", to: "/simulador" };
  if (/receita|recebi|salario/.test(normalized)) return { label: "Abrir receitas", to: "/receitas" };
  if (/lancament|despesa|gastei|paguei/.test(normalized)) return { label: "Abrir despesas", to: "/despesas" };
  return null;
}

export function placeAfterSave(kind: string, draft: { occurred_on?: string; type?: string; category_id?: string | null; card_id?: string | null }): AssistantPlace {
  if (kind === "account" || kind === "transfer") return { label: "Ver as contas", to: "/contas" };
  if (kind === "card_purchase" && draft.card_id) return { label: "Ver este cartão", to: `/cartoes/${draft.card_id}` };
  const month = draft.occurred_on && /^\d{4}-\d{2}-\d{2}$/.test(draft.occurred_on) ? draft.occurred_on.slice(0, 7) : "";
  if (!month) return { label: "Ver no gráfico", to: "/#graficos" };
  return { label: "Ver no gráfico", to: `/?mes=${month}#graficos` };
}
