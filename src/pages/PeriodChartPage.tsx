import { useMemo, useState } from "react";
import { CategoryChart } from "@/components/Charts";
import { DateBRField, MoneyText } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { launchItems, plainName } from "@/domain/launches";
import { formatDateBR, monthRange } from "@/lib/dates";
import { COLORS } from "@/lib/labels";

export function PeriodChartPage() {
  const { data, today } = useFinance();
  const initial = monthRange(today.slice(0, 7));
  const [from, setFrom] = useState(initial.start);
  const [to, setTo] = useState(initial.end);
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const items = useMemo(() => launchItems(data).filter((item) => item.date >= start && item.date <= end), [data, end, start]);
  const received = items.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amountCents, 0);
  const receivedOn = items.filter((item) => item.kind === "income").map((item) => formatDateBR(item.date)).filter((date, index, all) => all.indexOf(date) === index).join(" · ");
  const slices = useMemo(() => {
    const totals = new Map<string, { total: number; date: string }>();
    for (const item of items) {
      if (item.kind !== "expense") continue;
      const name = plainName(item.name);
      const current = totals.get(name);
      totals.set(name, { total: (current?.total ?? 0) + item.amountCents, date: current && current.date < item.date ? current.date : item.date });
    }
    return [...totals.entries()]
      .map(([name, value], index) => ({ name, totalCents: value.total, date: value.date, color: COLORS[index % COLORS.length] }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [items]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Gráfico</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <DateBRField label="De" value={from} onChange={setFrom} />
        <DateBRField label="Até" value={to} onChange={setTo} />
      </div>
      <article className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="font-semibold">O que foi lançado</h2>
        <p className="mb-4 mt-1 text-sm text-muted">O centro é o que entrou no período. Cada fatia é um gasto.</p>
        <CategoryChart receivedCents={received} receivedOn={receivedOn} slices={slices} />
      </article>
      <article className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="font-semibold">Lançamentos</h2>
        <div className="mt-3 space-y-2">
          {items.length ? items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{formatDateBR(item.date)} · {item.name}</span>
              <MoneyText cents={item.amountCents} tone={item.kind === "income" ? "income" : "expense"} />
            </div>
          )) : <p className="text-sm text-muted">Nada neste período.</p>}
        </div>
      </article>
    </div>
  );
}
