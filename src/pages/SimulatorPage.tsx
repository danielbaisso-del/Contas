import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Field, Input, MoneyField, MoneyText, PageHeader, Select } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { simulatePurchase, type SimulationResult } from "@/finance/engine";
import { formatDateBR, todayISO } from "@/lib/dates";
import { percentLabel } from "@/lib/money";
import type { FinanceData } from "@/types/models";

function simulationFromQuery(params: URLSearchParams, data: FinanceData, today: string): { amount: number | null; count: number; date: string; mode: "cash" | "credit"; result: SimulationResult | null } {
  const raw = Number(params.get("valor"));
  const amount = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  const count = Math.min(48, Math.max(1, Number(params.get("parcelas")) || 1));
  const date = params.get("data") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("data") ?? "") ? params.get("data")! : todayISO();
  const mode = params.get("forma") === "credit" ? "credit" : "cash";
  if (!amount) return { amount, count, date, mode, result: null };
  const card = data.cards.find((item) => !item.archived);
  return {
    amount,
    count,
    date,
    mode,
    result: simulatePurchase({
      data,
      today,
      totalCents: amount,
      count,
      firstDate: date,
      mode,
      closingDay: card?.closingDay ?? 28,
      dueDay: card?.dueDay ?? 5,
    }),
  };
}

export function SimulatorPage() {
  const { data, today } = useFinance();
  const [params] = useSearchParams();
  const seeded = useMemo(() => simulationFromQuery(params, data, today), [data, params, today]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<number | null>(seeded.amount);
  const [count, setCount] = useState(seeded.count);
  const [date, setDate] = useState(seeded.date);
  const [mode, setMode] = useState<"cash" | "credit">(seeded.mode);
  const [cardId, setCardId] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(seeded.result);
  useEffect(() => {
    if (!params.get("valor")) return;
    setAmount(seeded.amount);
    setCount(seeded.count);
    setDate(seeded.date);
    setMode(seeded.mode);
    setResult(seeded.result);
  }, [params, seeded]);
  const card = data.cards.find((item) => item.id === cardId);

  function run() {
    if (!amount) return;
    setResult(simulatePurchase({
      data, today, totalCents: amount, count, firstDate: date, mode,
      closingDay: card?.closingDay ?? 28, dueDay: card?.dueDay ?? 5,
    }));
  }

  return (
    <div>
      <PageHeader title="E se eu comprar?" description="A simulação mostra o efeito nos próximos meses e não cria nenhum lançamento. Só uma confirmação em Lançamentos ou no cartão grava a compra." />
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <form className="space-y-4 rounded-3xl border border-line bg-surface p-5" onSubmit={(event) => { event.preventDefault(); run(); }}>
          <Field label="Nome da compra"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Celular, viagem, computador..." /></Field>
          <MoneyField label="Valor" value={amount} onChange={setAmount} />
          <Field label="Parcelas" hint="Use 1 para pagamento à vista."><Input type="number" min={1} max={48} value={count} onChange={(event) => setCount(Number(event.target.value))} /></Field>
          <Field label="Primeira data"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <Field label="Forma"><Select value={mode} onChange={(event) => setMode(event.target.value as "cash" | "credit")}><option value="cash">Conta, Pix ou dinheiro</option><option value="credit">Cartão de crédito</option></Select></Field>
          {mode === "credit" ? <Field label="Cartão" hint="Sem cartão, a simulação usa fechamento no dia 28 e vencimento no dia 5."><Select value={cardId} onChange={(event) => setCardId(event.target.value)}><option value="">Estimativa geral</option>{data.cards.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : null}
          <Button type="submit">Simular</Button>
        </form>
        <section className="rounded-3xl border border-line bg-surface p-5">
          {!result ? <p className="text-sm leading-6 text-muted">Preencha a compra e simule. O resultado compara o saldo com e sem esse compromisso.</p> : (
            <div className="space-y-4">
              <p className="text-lg font-semibold">{name || "Compra simulada"}</p>
              <p className={`text-sm leading-6 ${result.verdict === "risk" ? "text-expense" : result.verdict === "tight" ? "text-warning" : "text-ink"}`}>{result.verdictText}</p>
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <p>Parcela<br /><strong><MoneyText cents={result.installmentCents} /></strong></p>
                <p>Total<br /><strong><MoneyText cents={result.totalCents} /></strong></p>
                <p>Renda comprometida<br /><strong>{percentLabel(result.committedRatio)} → {percentLabel(result.ratioAfter)}</strong></p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted"><tr><th>Mês</th><th>Parcela</th><th>Sem a compra</th><th>Com a compra</th></tr></thead>
                  <tbody>{result.months.map((month) => <tr key={month.month} className="border-t border-line"><td className="py-2">{month.label}</td><td><MoneyText cents={month.installmentCents} /></td><td><MoneyText cents={month.withoutCents} tone="auto" /></td><td><MoneyText cents={month.withCents} tone="auto" /></td></tr>)}</tbody>
                </table>
              </div>
              <div className="text-xs leading-5 text-muted">{result.schedule.map((item) => <p key={`${item.date}-${item.label}`}>{formatDateBR(item.date)} · {item.label} · <MoneyText cents={item.amountCents} /></p>)}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
