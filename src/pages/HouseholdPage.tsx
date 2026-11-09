import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnswerChart, BalanceChart, CategoryChart, FlowChart, MonthPie } from "@/components/Charts";
import { PlaceLink } from "@/components/PlaceLink";
import { Button, Field, Input, MoneyText, PageHeader } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import type { AssistantResponse } from "@/domain/assistant";
import { buildDashboard, topCategorySlices } from "@/finance/engine";
import { formatDateBR, formatMonthLabel, monthKey, shiftMonth } from "@/lib/dates";
import { formatBRL, percentLabel } from "@/lib/money";
import { errorMessage } from "@/lib/utils";
import { askAssistant } from "@/services/ai";
import { invitePartner, leaveHousehold, loadHousehold, loadHouseholdFinance, respondInvite, type HouseholdFinance, type HouseholdSummary } from "@/services/household";

export function HouseholdPage() {
  const { today } = useFinance();
  const toast = useToast();
  const [summary, setSummary] = useState<HouseholdSummary | null>(null);
  const [finance, setFinance] = useState<HouseholdFinance | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [month, setMonth] = useState(monthKey(today));
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AssistantResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const next = await loadHousehold();
      setSummary(next);
      if (next.household) setFinance(await loadHouseholdFinance());
      else setFinance(null);
    } catch (caught) {
      setError(errorMessage(caught));
      setSummary(null);
      setFinance(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  async function invite() {
    setSending(true);
    try {
      await invitePartner(email);
      setEmail("");
      toast("Convite enviado. A outra pessoa vê o pedido ao entrar.");
      await reload();
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setSending(false);
    }
  }

  async function respond(id: string, action: "accept" | "decline") {
    setSending(true);
    try {
      await respondInvite(id, action);
      toast(action === "accept" ? "Grupo aceito. Os números de vocês agora aparecem juntos." : "Convite recusado.");
      await reload();
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setSending(false);
    }
  }

  async function leave() {
    setSending(true);
    try {
      await leaveHousehold();
      toast("Você saiu do grupo. Seus lançamentos continuam só na sua conta.");
      setAnswer(null);
      await reload();
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setSending(false);
    }
  }

  async function ask() {
    const text = question.trim();
    if (!text) return;
    setAsking(true);
    try {
      const response = await askAssistant({ mode: "interpret", text, household: true });
      setAnswer(response);
      setQuestion("");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setAsking(false);
    }
  }

  const model = useMemo(() => (finance ? buildDashboard(finance.data, month, today) : null), [finance, month, today]);
  const people = useMemo(() => (finance ? finance.parts.map((part) => {
    const dash = buildDashboard(part.data, month, today);
    return { name: part.name, incomeCents: dash.incomeCents, spendingCents: dash.spendingCents, pendingCents: dash.pendingCents };
  }) : []), [finance, month, today]);

  if (loading) return <p className="text-sm text-muted">Organizando o grupo...</p>;
  if (error) return <article className="rounded-3xl border border-line bg-surface p-6 text-sm leading-6">{error}</article>;

  const pending = summary?.members.filter((member) => member.status === "pending") ?? [];
  const report = model ? [
    `Saldo disponível hoje, somando as contas de quem aceitou: ${formatBRL(model.availableCents)}.`,
    `Já entrou em ${formatMonthLabel(month)}: ${formatBRL(model.incomeCents)}.`,
    `Já saiu, com as compras no cartão: ${formatBRL(model.spendingCents)}.`,
    `Ainda vai pagar: ${formatBRL(model.pendingCents)}.`,
    `Projeção no fim do mês: ${formatBRL(model.projectedEndCents)}.`,
    model.committedRatio == null ? "Ainda não há receita neste mês para calcular a renda comprometida." : `Renda comprometida do grupo: ${percentLabel(model.committedRatio)}.`,
    ...people.map((person) => `${person.name}: recebeu ${formatBRL(person.incomeCents)}, gastou ${formatBRL(person.spendingCents)} e ainda tem ${formatBRL(person.pendingCents)} pela frente.`),
  ] : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Juntos" description="Aqui entram só as pessoas que aceitaram. Cada uma continua lançando na própria conta. Esta aba soma ganhos, gastos e o que ainda vai acontecer." action={summary?.household ? <Button variant="ghost" disabled={sending} onClick={() => void leave()}>Sair do grupo</Button> : null} />

      {summary?.invites.map((invite) => (
        <article key={invite.id} className="rounded-3xl border border-accent bg-surface p-5">
          <h2 className="text-lg font-semibold">{invite.fromName} quer juntar as contas com você</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{invite.fromEmail ? `${invite.fromEmail} ` : ""}pediu para vocês verem, nesta aba, o que entra, o que sai e o que ainda vai pagar. Nada muda na sua conta pessoal até você aceitar.</p>
          <div className="mt-4 flex gap-2">
            <Button disabled={sending} onClick={() => void respond(invite.id, "accept")}>Aceitar</Button>
            <Button variant="secondary" disabled={sending} onClick={() => void respond(invite.id, "decline")}>Recusar</Button>
          </div>
        </article>
      ))}

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Chamar outra pessoa</h2>
        <p className="mt-1 text-sm leading-6 text-muted">Ela precisa já ter cadastro. O pedido aparece quando ela entra. Pode ser o casal ou mais pessoas, um e-mail por vez.</p>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
          <Field label="E-mail de quem vai participar"><Input type="email" value={email} placeholder="parceiro@email.com" onChange={(event) => setEmail(event.target.value)} /></Field>
          <div className="sm:pt-7"><Button loading={sending} type="submit">Enviar convite</Button></div>
        </form>
        {pending.length ? <p className="mt-3 text-sm text-muted">Esperando {pending.map((member) => member.name || member.email).join(", ")} aceitar. Até lá, os gráficos mostram só quem já entrou.</p> : null}
        {summary?.members.filter((member) => member.status === "accepted").length ? (
          <p className="mt-3 text-sm">No grupo: {summary.members.filter((member) => member.status === "accepted").map((member) => member.you ? `${member.name} (você)` : member.name).join(", ")}.</p>
        ) : null}
      </article>

      {finance && model ? (
        <>
          <article className="rounded-3xl bg-accent p-5 text-white">
            <p className="text-xs font-medium uppercase tracking-wide text-white/70">Pergunte ao grupo</p>
            <p className="mt-1 text-lg font-semibold">A IA explica o mês de vocês</p>
            <p className="mt-2 text-sm leading-6 text-white/80">Pergunte o saldo, os gastos, o que ainda vem ou quem gastou mais. Ela responde com os números do grupo e não grava nada daqui.</p>
            {answer ? (
              <div className="mt-4 rounded-2xl bg-surface p-4 text-sm leading-6 text-ink">
                <p className="whitespace-pre-line">{answer.reply}</p>
                {answer.chart ? <AnswerChart title={answer.chart.title} kind={answer.chart.kind} points={answer.chart.points} /> : null}
                {answer.place ? <PlaceLink place={answer.place} /> : null}
              </div>
            ) : null}
            <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
              <input className="w-full rounded-xl border border-white/20 bg-white px-3 py-2.5 text-sm text-ink outline-none" value={question} placeholder="Exemplo: quanto gastamos neste mês?" onChange={(event) => setQuestion(event.target.value)} />
              <Button loading={asking} type="submit">Perguntar</Button>
            </form>
          </article>

          <div className="flex justify-end">
            <div className="inline-flex items-center rounded-full border border-line bg-surface">
              <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
              <span className="min-w-40 text-center text-sm font-medium">{formatMonthLabel(month)}</span>
              <button className="px-3 py-2" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês"><ChevronRight size={16} /></button>
            </div>
          </div>

          <section id="mes" key={month} className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-3xl border border-line bg-surface p-5">
              <h2 className="font-semibold">O mês do grupo</h2>
              <p className="mb-4 mt-1 text-sm text-muted">Verde entrou. Vermelho já saiu. Amarelo ainda vai sair.</p>
              <MonthPie receivedCents={model.incomeCents} spentCents={model.spendingCents} futureCents={model.pendingCents} />
            </article>
            <article id="categorias" className="rounded-3xl border border-line bg-surface p-5">
              <h2 className="font-semibold">Para onde o dinheiro do grupo foi</h2>
              <p className="mb-4 mt-1 text-sm text-muted">Categorias iguais das duas pessoas viram uma fatia só.</p>
              <CategoryChart data={topCategorySlices(model.categories).map((item) => ({ name: item.name, totalCents: item.totalCents, color: item.color }))} />
            </article>
            <article id="pessoas" className="rounded-3xl border border-line bg-surface p-5">
              <h2 className="font-semibold">Cada pessoa</h2>
              <p className="mb-4 mt-1 text-sm text-muted">Verde é o que a pessoa recebeu. Vermelho é o que ela já pagou.</p>
              <FlowChart data={people.map((person) => ({ label: person.name, incomeCents: person.incomeCents, expenseCents: person.spendingCents }))} />
            </article>
            <article id="previsao" className="rounded-3xl border border-line bg-surface p-5">
              <h2 className="font-semibold">Para onde o saldo vai</h2>
              <p className="mb-4 mt-1 text-sm text-muted">A linha junta as contas de quem aceitou. Transferência entre vocês não muda o total.</p>
              <BalanceChart data={model.history} />
            </article>
          </section>

          <article className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="font-semibold">Relatório do grupo</h2>
            <div className="mt-4 space-y-2 text-sm leading-6">
              {report.map((line, index) => <p key={`${index}-${line}`} className="report-line" style={{ animationDelay: `${index * 70}ms` }}>{line}</p>)}
            </div>
          </article>

          <section id="saldos" className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-3xl border border-line bg-surface p-5">
              <h2 className="font-semibold">Contas do grupo</h2>
              <div className="mt-4 space-y-3">
                {model.accountSnapshots.length ? model.accountSnapshots.map((item) => {
                  const account = finance.data.accounts.find((entry) => entry.id === item.accountId);
                  return <p key={item.accountId} className="flex items-center justify-between gap-3 text-sm"><span>{account?.name}</span><MoneyText cents={item.balanceCents} tone="auto" /></p>;
                }) : <p className="text-sm text-muted">Ninguém cadastrou uma conta ainda.</p>}
              </div>
            </article>
            <article id="futuro" className="rounded-3xl border border-line bg-surface p-5">
              <h2 className="font-semibold">O que ainda vem</h2>
              <div className="mt-4 space-y-3">
                {model.upcoming.length ? model.upcoming.map((item) => (
                  <p key={item.id} className="flex items-center justify-between gap-3 text-sm"><span>{item.title}<span className="block text-xs text-muted">{formatDateBR(item.date)}</span></span><MoneyText cents={item.amountCents} tone={item.direction === "in" ? "income" : "expense"} /></p>
                )) : <p className="text-sm text-muted">Não há conta futura em aberto no grupo.</p>}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
