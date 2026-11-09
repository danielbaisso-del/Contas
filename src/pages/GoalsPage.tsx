import { useState } from "react";
import { Button, EmptyState, Field, Input, Modal, MoneyField, MoneyText, PageHeader, useConfirm } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { monthsToGoal, neededMonthly } from "@/finance/engine";
import { formatDateBR, todayISO } from "@/lib/dates";
import { COLORS } from "@/lib/labels";
import { formatBRL } from "@/lib/money";
import { errorMessage } from "@/lib/utils";
import { addContribution, deleteGoal, removeContribution, saveGoal } from "@/services/data";
import type { Goal } from "@/types/models";

export function GoalsPage() {
  const { data, today } = useFinance();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [selected, setSelected] = useState<Goal | null>(null);
  return (
    <div>
      <PageHeader title="Metas e economias" description="A meta acompanha quanto você já separou. Ela não tira dinheiro da conta. Se mover o valor, registre também uma transferência." action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Nova meta</Button>} />
      {!data.goals.length ? <EmptyState title="Nenhum objetivo ainda" text="Reserva de emergência, carro, computador ou viagem. O ritmo mensal serve para calcular o prazo; ele não é debitado sozinho." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.goals.map((goal) => {
            const progress = Math.min(100, Math.round((goal.savedCents / goal.targetCents) * 100));
            const months = monthsToGoal(goal);
            const needed = neededMonthly(goal, today);
            return (
              <article key={goal.id} className="rounded-3xl border border-line bg-surface p-5">
                <div className="flex justify-between"><p className="font-semibold">{goal.name}</p><span className="h-3 w-3 rounded-full" style={{ background: goal.color }} /></div>
                <p className="mt-3 text-sm"><MoneyText cents={goal.savedCents} tone="income" /> de <MoneyText cents={goal.targetCents} /></p>
                <div className="mt-3 h-2 rounded-full bg-surface-2"><div className="h-full rounded-full bg-income" style={{ width: `${progress}%` }} /></div>
                <p className="mt-3 text-xs leading-5 text-muted">Faltam {formatBRL(Math.max(0, goal.targetCents - goal.savedCents))}. {months == null ? "Defina uma contribuição mensal para estimar o prazo." : months === 0 ? "Objetivo alcançado." : `No ritmo de ${formatBRL(goal.monthlyContributionCents)} por mês, leva cerca de ${months} mês(es).`} {needed ? ` Para o prazo escolhido, o ideal seria ${formatBRL(needed)} por mês.` : ""}</p>
                <div className="mt-4 flex gap-2"><Button onClick={() => setSelected(goal)}>Aportar</Button><Button variant="secondary" onClick={() => { setEditing(goal); setOpen(true); }}>Editar</Button></div>
              </article>
            );
          })}
        </div>
      )}
      {open ? <GoalModal goal={editing} onClose={() => setOpen(false)} /> : null}
      {selected ? <ContributionModal goal={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function GoalModal({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { refresh } = useFinance();
  const toast = useToast();
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState<number | null>(goal?.targetCents ?? null);
  const [monthly, setMonthly] = useState<number | null>(goal?.monthlyContributionCents ?? 0);
  const [deadline, setDeadline] = useState(goal?.deadline ?? "");
  const [first, setFirst] = useState<number | null>(null);
  const [color, setColor] = useState(goal?.color ?? COLORS[1]);
  return (
    <Modal title={goal ? "Editar meta" : "Nova meta"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nome"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <MoneyField label="Valor desejado" value={target} onChange={setTarget} />
        <MoneyField label="Contribuição mensal planejada" value={monthly} onChange={setMonthly} hint="Isto só calcula o ritmo. Não cria um lançamento." />
        <Field label="Prazo"><Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></Field>
        {!goal ? <MoneyField label="Já separei" value={first} onChange={setFirst} hint="Opcional. Vira o primeiro aporte e não mexe no saldo." /> : null}
        <div className="flex gap-2">{COLORS.map((item) => <button key={item} className="h-7 w-7 rounded-full" style={{ background: item }} onClick={() => setColor(item)} />)}</div>
        <div className="flex gap-2">
          <Button onClick={async () => {
            try {
              if (!target) throw new Error("Informe o valor desejado.");
              const id = await saveGoal({ name, targetCents: target, monthlyContributionCents: monthly ?? 0, deadline, color }, goal?.id);
              if (!goal && first) await addContribution(id, first, todayISO(), "Valor inicial");
              await refresh();
              onClose();
            } catch (error) { toast(errorMessage(error), "error"); }
          }}>Salvar</Button>
          {goal ? <Button variant="danger" onClick={async () => { await deleteGoal(goal.id); await refresh(); onClose(); }}>Excluir</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function ContributionModal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const items = data.contributions.filter((item) => item.goalId === goal.id);
  return (
    <Modal title={`Aportes de ${goal.name}`} onClose={onClose}>
      <div className="space-y-4">
        <MoneyField label="Valor" value={amount} onChange={setAmount} />
        <Field label="Data"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Nota"><Input value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        <Button onClick={async () => { try { if (!amount) throw new Error("Informe o valor."); await addContribution(goal.id, amount, date, notes); await refresh(); onClose(); } catch (error) { toast(errorMessage(error), "error"); } }}>Registrar aporte</Button>
        <div className="space-y-2 text-sm">{items.map((item) => <div key={item.id} className="flex justify-between"><span>{formatDateBR(item.contributedOn)} · {formatBRL(item.amountCents)}</span><button onClick={async () => { if (await confirm("Remover este aporte?")) { await removeContribution(item.id); await refresh(); } }}>Remover</button></div>)}</div>
      </div>
      {dialog}
    </Modal>
  );
}
