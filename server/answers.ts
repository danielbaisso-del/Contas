import { accountBalance, buildDashboard, projectCash, simulatePurchase, spendingByCategoryRange, totalBalance, upcomingItems } from "@/finance/engine";
import { addDays, formatDateBR, formatMonthLabel, monthKey, monthRange, shiftMonth } from "@/lib/dates";
import { formatBRL, percentLabel } from "@/lib/money";
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
      return `A conta ${account.name} está com ${formatBRL(balance)} disponíveis. Esse saldo parte do valor inicial e só muda com o que já foi recebido, pago, transferido ou usado para quitar fatura.`;
    }
    const balance = totalBalance(data.accounts, data.transactions, today);
    return `Seu saldo disponível hoje é ${formatBRL(balance)}. Ele soma o dinheiro que já está nas contas. Receita prevista e fatura em aberto não entram nesse número.`;
  }

  if (metric === "month_overview") {
    const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : monthKey(today);
    const dashboard = buildDashboard(data, month, today);
    return [
      `Em ${formatMonthLabel(month)}:`,
      `Receitas já recebidas: ${formatBRL(dashboard.incomeCents)}.`,
      `Receitas do mês, incluindo as que ainda vão entrar: ${formatBRL(dashboard.incomeExpectedCents)}.`,
      `Despesas já pagas e compras no cartão: ${formatBRL(dashboard.spendingCents)}.`,
      `Contas em aberto: ${formatBRL(dashboard.pendingCents)}.`,
      `Faturas de cartão ainda não pagas, somando todos os meses: ${formatBRL(dashboard.openInvoicesCents)}.`,
      `Projeção para o fim do mês: ${formatBRL(dashboard.projectedEndCents)}.`,
      dashboard.committedRatio == null
        ? "Ainda não há receita neste mês para calcular quanto da renda está comprometida."
        : `Renda comprometida: ${percentLabel(dashboard.committedRatio)}.`,
    ].join(" ");
  }

  if (metric === "forecast") {
    const named = text.match(/\b(30|60|90)\s*dias\b/);
    const days = named ? Number(named[1]) : query.days;
    if (days === 30 || days === 60 || days === 90) {
      const date = addDays(today, days);
      return `Em ${days} dias, no dia ${formatDateBR(date)}, o saldo projetado é ${formatBRL(projectCash(data, date, today))}. A conta junta o saldo de hoje, receitas ainda não recebidas e desconta contas e faturas até essa data. Transferência entre suas contas não muda o total.`;
    }
    const end = monthRange(monthKey(today)).end;
    return `No fim de ${formatMonthLabel(monthKey(today))}, a projeção é ${formatBRL(projectCash(data, end, today))}. Ela considera o que já aconteceu e o que ainda está previsto até ${formatDateBR(end)}.`;
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
    return `Em ${category.name}, de ${formatDateBR(start)} até ${formatDateBR(today)}, o total é ${formatBRL(total)}. Entrei com despesas pagas na conta e compras de cartão. O pagamento da fatura não é somado de novo.`;
  }

  if (metric === "upcoming") {
    const items = upcomingItems(data, today, 5);
    if (!items.length) return "Não há contas, receitas ou faturas futuras em aberto.";
    const lines = items.map((item) => `${formatDateBR(item.date)}: ${item.title} (${formatBRL(item.amountCents)})`);
    return `Próximos compromissos: ${lines.join("; ")}.`;
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
    ].filter(Boolean).join(" ");
  }

  return "Posso dizer seu saldo, o resumo do mês, uma previsão, gastos por categoria ou simular uma compra.";
}
