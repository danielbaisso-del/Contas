import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BalanceChart, CategoryChart, FlowChart } from "@/components/Charts";
import { Delta, MoneyText } from "@/components/ui";
import { useGuide } from "@/components/GuideCoach";
import { useFinance } from "@/context/FinanceContext";
import { buildDashboard, topCategorySlices } from "@/finance/engine";
import { formatDateBR, formatMonthLabel, monthKey, shiftMonth } from "@/lib/dates";
import { percentLabel } from "@/lib/money";
import { statusLabel, typeLabel } from "@/lib/labels";

export function DashboardPage() {
  const { data, today } = useFinance();
  const { openGuide } = useGuide();
  const [month, setMonth] = useState(monthKey(today));
  const model = useMemo(() => buildDashboard(data, month, today), [data, month, today]);
  const categories = topCategorySlices(model.categories);
  const ratioTone = model.committedRatio == null ? "text-muted" : model.committedRatio >= 80 ? "text-expense" : model.committedRatio >= 60 ? "text-warning" : "text-income";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Esta tela separa o dinheiro que você já tem do dinheiro que ainda está previsto.</p>
        </div>
        <div className="inline-flex items-center rounded-full border border-line bg-surface">
          <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <span className="min-w-40 text-center text-sm font-medium">{formatMonthLabel(month)}</span>
          <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês"><ChevronRight size={16} /></button>
        </div>
      </div>

      <button className="w-full rounded-3xl bg-accent p-5 text-left text-white" onClick={openGuide} type="button">
        <p className="text-lg font-semibold">Organizar meu mês falando</p>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-white/80">A IA pergunta onde está o dinheiro, o que já entrou, o que já foi pago e o que falta pagar. Você só responde, falando ou escrevendo.</p>
      </button>

      {!data.accounts.length ? (
        <div className="rounded-3xl border border-line bg-surface p-5 text-sm leading-6">
          <p className="font-medium">Comece por uma conta.</p>
          <p className="mt-1 text-muted">O saldo disponível só existe depois que você cadastra onde o dinheiro está. Em seguida, lance o que já entrou e saiu.</p>
          <Link className="mt-3 inline-block text-accent" to="/contas">Cadastrar a primeira conta</Link>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Saldo disponível hoje</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.availableCents} tone="auto" /></p>
          <Delta current={model.availableCents} previous={model.previousProjectedEndCents} />
          <p className="mt-3 text-xs leading-5 text-muted">Dinheiro que já está nas contas. Não inclui salário a receber nem fatura a pagar.</p>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Receitas do mês</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.incomeCents} tone="income" /></p>
          <Delta current={model.incomeCents} previous={model.previousIncomeCents} />
          <p className="mt-3 text-xs leading-5 text-muted">Só o que já foi marcado como recebido. Ainda previsto neste mês: <MoneyText cents={Math.max(0, model.incomeExpectedCents - model.incomeCents)} />.</p>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Despesas do mês</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.spendingCents} tone="expense" /></p>
          <Delta current={model.spendingCents} previous={model.previousSpendingCents} positiveIsGood={false} />
          <p className="mt-3 text-xs leading-5 text-muted">Despesas pagas na conta mais compras feitas no cartão. Pagar a fatura não entra de novo.</p>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Contas pendentes</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.pendingCents} tone="expense" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">{model.pendingCount} conta(s) do mês, incluindo vencidas que continuam em aberto. Compras de cartão ficam na fatura, não aqui.</p>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Faturas em aberto</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.openInvoicesCents} tone="expense" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Soma de todas as faturas ainda não pagas, deste mês e dos próximos.</p>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Previsão no fim do mês</p>
          <p className="mt-2 text-3xl font-semibold"><MoneyText cents={model.projectedEndCents} tone="auto" /></p>
          <p className="mt-3 text-xs leading-5 text-muted">Saldo de hoje, mais o que ainda entra, menos contas e faturas até o fim de {formatMonthLabel(month)}.</p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Renda comprometida</h2>
          <p className={`mt-3 text-4xl font-semibold ${ratioTone}`}>{percentLabel(model.committedRatio)}</p>
          <p className="mt-3 text-sm leading-6 text-muted">
            {model.incomeBaseCents <= 0
              ? "Cadastre as receitas do mês para esta conta fazer sentido."
              : `${percentLabel(model.committedRatio)} de ${formatMoney(model.incomeBaseCents)} já estão prometidos entre contas do mês e faturas que vencem nele. Abaixo de 60% fica folgado, entre 60% e 80% aperta, e acima de 80% deixa pouco espaço para imprevisto.`}
          </p>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Previsão financeira</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {model.forecasts.map((item) => (
              <div key={item.days} className="rounded-2xl bg-surface-2 p-3">
                <p className="text-xs text-muted">{item.days} dias · {formatDateBR(item.date)}</p>
                <p className="mt-1 text-lg font-semibold"><MoneyText cents={item.balanceCents} tone="auto" /></p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">Inclui lançamentos futuros, recorrências já geradas, parcelas e faturas. Transferência interna não altera esses totais.</p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="mb-4 font-semibold">Receitas e despesas</h2>
          <FlowChart data={model.history} />
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="mb-4 font-semibold">Despesas por categoria</h2>
          <CategoryChart data={categories.map((item) => ({ name: item.name, totalCents: item.totalCents, color: item.color }))} />
        </article>
      </section>

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="mb-4 font-semibold">Evolução do saldo</h2>
        <BalanceChart data={model.history} />
        <p className="mt-2 text-xs text-muted">A linha contínua é o que já aconteceu. A tracejada mostra a projeção até o fim de cada mês.</p>
      </article>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Próximas contas</h2>
          <div className="mt-4 space-y-3">
            {model.upcoming.length ? model.upcoming.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted">{formatDateBR(item.date)} · {item.kind === "invoice" ? "Fatura" : item.kind === "income" ? "Receita" : "Conta"}</p>
                </div>
                <MoneyText cents={item.amountCents} tone={item.direction === "in" ? "income" : "expense"} />
              </div>
            )) : <p className="text-sm text-muted">Nenhuma conta futura em aberto.</p>}
          </div>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Últimos lançamentos</h2>
          <div className="mt-4 space-y-3">
            {model.latest.length ? model.latest.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{item.description}</p>
                  <p className="text-xs text-muted">{formatDateBR(item.occurredOn)} · {typeLabel(item.type)} · {statusLabel(item.status, item.type)}</p>
                </div>
                <MoneyText cents={item.amountCents} tone={item.type === "income" ? "income" : item.type === "transfer" ? "neutral" : "expense"} />
              </div>
            )) : <p className="text-sm text-muted">Seus lançamentos aparecem aqui.</p>}
          </div>
        </article>
      </section>
    </div>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
