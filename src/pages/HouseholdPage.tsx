import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { CategoryChart } from "@/components/Charts";
import { Button, DateBRField, Field, Input, Modal, MoneyField, MoneyText } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { amountLines, launchItems, plainName, type LaunchItem } from "@/domain/launches";
import { calendarCells, formatDateBR, formatMonthLabel, monthKey, shiftMonth } from "@/lib/dates";
import { COLORS } from "@/lib/labels";
import { formatBRL, splitAmount } from "@/lib/money";
import { errorMessage, cx } from "@/lib/utils";
import { deleteInstallmentGroup, moveToTrash } from "@/services/data";
import { invitePartner, leaveHousehold, loadHousehold, loadHouseholdFinance, respondInvite, type HouseholdFinance, type HouseholdSummary } from "@/services/household";
import { saveSimpleLaunch, updateOpening } from "@/services/simpleSave";

interface GroupLaunch extends LaunchItem {
  person: string;
  mine: boolean;
}

export function HouseholdPage() {
  const { data, today, refresh } = useFinance();
  const toast = useToast();
  const [params] = useSearchParams();
  const requestedDay = params.get("dia");
  const [summary, setSummary] = useState<HouseholdSummary | null>(null);
  const [finance, setFinance] = useState<HouseholdFinance | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(monthKey(requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : today));
  const [selected, setSelected] = useState(requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : today);
  const [open, setOpen] = useState<"income" | "expense" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(selected);
  const [parts, setParts] = useState(1);
  const [saving, setSaving] = useState(false);

  async function reload(quiet = false) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const next = await loadHousehold();
      setSummary(next);
      setFinance(next.household ? await loadHouseholdFinance() : null);
    } catch (caught) {
      setError(errorMessage(caught));
      setSummary(null);
      setFinance(null);
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  useEffect(() => {
    const day = params.get("dia");
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setSelected(day);
      setMonth(monthKey(day));
      setDate(day);
    }
  }, [params]);

  const ownIds = useMemo(() => new Set(launchItems(data).map((item) => item.id)), [data]);
  const items = useMemo(() => {
    if (!finance) return [] as GroupLaunch[];
    return finance.parts.flatMap((part) => launchItems(part.data).map((item) => ({
      ...item,
      person: part.you || ownIds.has(item.id) ? "Você" : part.name,
      mine: part.you === true || ownIds.has(item.id),
    }))).sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person) || a.name.localeCompare(b.name));
  }, [finance, ownIds]);
  const cells = useMemo(() => calendarCells(month), [month]);
  const dayItems = items.filter((item) => item.date === selected);
  const monthItems = items.filter((item) => item.date.startsWith(month));
  let running = 0;
  const statement = monthItems.map((item) => {
    running += item.kind === "income" ? item.amountCents : -item.amountCents;
    return { ...item, after: running };
  });
  const received = monthItems.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amountCents, 0);
  const receivedOn = monthItems.filter((item) => item.kind === "income").map((item) => formatDateBR(item.date)).filter((value, index, all) => all.indexOf(value) === index).join(" · ");
  const slices = useMemo(() => {
    const totals = new Map<string, { total: number; date: string }>();
    for (const item of monthItems) {
      if (item.kind !== "expense") continue;
      const label = plainName(item.name);
      const current = totals.get(label);
      totals.set(label, { total: (current?.total ?? 0) + item.amountCents, date: current && current.date < item.date ? current.date : item.date });
    }
    return [...totals.entries()].map(([label, value], index) => ({ name: label, totalCents: value.total, date: value.date, color: COLORS[index % COLORS.length] })).sort((a, b) => b.totalCents - a.totalCents);
  }, [monthItems]);

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
      toast(action === "accept" ? "Grupo aceito. Os lançamentos de vocês aparecem juntos." : "Convite recusado.");
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
      toast("Você saiu do grupo. Seus lançamentos continuam na sua conta.");
      await reload();
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setSending(false);
    }
  }

  function start(kind: "income" | "expense", id?: string) {
    const current = id ? items.find((item) => item.id === id && item.mine) : null;
    if (id && !current) return;
    setEditing(current ? current.id : null);
    setName(current?.name.replace(/\s*\(\d+\/\d+\)\s*$/, "") ?? "");
    setAmount(current?.amountCents ?? null);
    setDate(current?.date ?? selected);
    setParts(1);
    setOpen(current?.kind ?? kind);
  }

  const editingItem = editing ? items.find((item) => item.id === editing) : null;

  async function save() {
    if (!open) return;
    if (name.trim().length < 2) return toast("Diga o nome.", "error");
    if (!amount || amount <= 0) return toast("Diga o valor.", "error");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast("Diga a data.", "error");
    setSaving(true);
    try {
      if (editingItem?.synthetic && editingItem.accountId) await updateOpening(editingItem.accountId, amount, date);
      else await saveSimpleLaunch({ kind: open, name: name.trim(), amountCents: amount, occurredOn: date, installments: editing ? 1 : parts, id: editing ?? undefined }, data.accounts);
      toast(parts > 1 && !editing ? "Parcelas lançadas." : "Lançamento salvo.");
      setOpen(null);
      setEditing(null);
      setSelected(date);
      setMonth(monthKey(date));
      await refresh();
      await reload(true);
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item || !item.mine || item.synthetic) return;
    if (!window.confirm(item.groupId ? `Apagar todas as parcelas de ${item.name}?` : `Apagar ${item.name}?`)) return;
    try {
      if (item.groupId) await deleteInstallmentGroup(item.groupId);
      else await moveToTrash(id, null);
      toast("Lançamento apagado.");
      await refresh();
      await reload(true);
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  if (loading) return <p className="text-sm text-muted">Organizando o grupo...</p>;
  if (error) return <article className="rounded-3xl border border-line bg-surface p-6 text-sm leading-6">{error}</article>;

  const pending = summary?.members.filter((member) => member.status === "pending") ?? [];
  const accepted = summary?.members.filter((member) => member.status === "accepted") ?? [];
  const preview = parts > 1 && amount ? splitAmount(amount, parts)[0] ?? 0 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Juntos</h1>
          <p className="mt-1 text-sm text-muted">Cada um lança o próprio gasto ou recebimento. Aqui os lançamentos de vocês aparecem no mesmo calendário.</p>
        </div>
        {summary?.household ? <Button variant="ghost" disabled={sending} onClick={() => void leave()}>Sair</Button> : null}
      </div>

      {summary?.invites.map((invite) => (
        <article key={invite.id} className="rounded-3xl border border-accent bg-surface p-5">
          <h2 className="text-lg font-semibold">{invite.fromName} quer ver os lançamentos com você</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Se aceitar, os gastos e recebimentos de vocês aparecem neste calendário. A sua conta pessoal continua igual.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={sending} onClick={() => void respond(invite.id, "accept")}>Aceitar</Button>
            <Button variant="secondary" disabled={sending} onClick={() => void respond(invite.id, "decline")}>Recusar</Button>
          </div>
        </article>
      ))}

      <article className="rounded-3xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Chamar outra pessoa</h2>
        <p className="mt-1 text-sm leading-6 text-muted">Ela precisa já ter cadastro. O pedido aparece quando ela entra.</p>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
          <Field label="E-mail"><Input type="email" value={email} placeholder="parceiro@email.com" onChange={(event) => setEmail(event.target.value)} /></Field>
          <div className="sm:pt-7"><Button loading={sending} type="submit">Enviar convite</Button></div>
        </form>
        {pending.length ? <p className="mt-3 text-sm text-muted">Esperando {pending.map((member) => member.name || member.email).join(", ")} aceitar.</p> : null}
        {accepted.length ? <p className="mt-3 text-sm">No grupo: {accepted.map((member) => member.you ? "você" : member.name).join(", ")}.</p> : null}
      </article>

      {finance ? (
        <>
          <div className="flex items-center justify-end">
            <div className="inline-flex items-center rounded-full border border-line bg-surface">
              <button className="px-2 py-1.5" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
              <span className="whitespace-nowrap px-1 text-xs font-medium sm:text-sm">{formatMonthLabel(month)}</span>
              <button className="px-2 py-1.5" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês"><ChevronRight size={16} /></button>
            </div>
          </div>
          <div className="rounded-3xl border border-line bg-surface p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {cells.map((cell) => {
                const found = items.filter((item) => item.date === cell.iso);
                const packed: { id: string; lines: string[]; income: boolean }[] = [];
                let used = 0;
                let hidden = 0;
                for (const item of found) {
                  const lines = amountLines(item.amountCents, item.kind);
                  if (used + lines.length <= 2) {
                    packed.push({ id: `${item.person}-${item.id}`, lines, income: item.kind === "income" });
                    used += lines.length;
                  } else hidden += 1;
                }
                return (
                  <button key={cell.iso} onClick={() => setSelected(cell.iso)} aria-label={`${formatDateBR(cell.iso)}${found.length ? `, ${found.length} lançamento${found.length > 1 ? "s" : ""}` : ""}`} className={cx("flex min-h-[4.6rem] flex-col rounded-2xl border p-1 text-left sm:min-h-[5.2rem]", cell.iso === selected ? "border-accent bg-accent/5" : "border-transparent", cell.inMonth ? "bg-surface-2" : "opacity-40")}>
                    <span className={cx("text-xs", cell.iso === today ? "font-semibold text-accent" : "")}>{Number(cell.iso.slice(8))}</span>
                    <span className="mt-0.5 overflow-hidden">
                      {packed.map((item) => (
                        <span key={item.id} className={cx("block text-[10px] font-semibold leading-3 tabular-nums", item.income ? "text-income" : "text-expense")}>
                          {item.lines.map((line) => <span key={line} className="block">{line}</span>)}
                        </span>
                      ))}
                      {hidden > 0 ? <span className="block text-[10px] leading-3 text-muted">+{hidden}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <section className="rounded-3xl border border-line bg-surface p-4">
            <h2 className="font-semibold">Extrato do dia</h2>
            <p className="text-sm text-muted">{formatDateBR(selected)}. O seu valor abre para alterar. O da outra pessoa só aparece.</p>
            <div className="mt-3 flex gap-2">
              <Button className="flex-1" onClick={() => start("expense")}>Gasto</Button>
              <Button className="flex-1" variant="secondary" onClick={() => start("income")}>Recebido</Button>
            </div>
            <div className="mt-4 space-y-2">
              {dayItems.length ? dayItems.map((item) => (
                <div key={`${item.person}-${item.id}`} className="flex items-center gap-2 rounded-2xl border border-line px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="text-xs text-muted">{item.person} · {item.kind === "income" ? "entrou" : "saiu"}</span>
                  </div>
                  {item.mine ? (
                    <button className="shrink-0 text-right" onClick={() => start(item.kind, item.id)} aria-label={`Editar ${item.name}`}>
                      <MoneyText cents={item.kind === "income" ? item.amountCents : -item.amountCents} tone="auto" />
                    </button>
                  ) : <MoneyText cents={item.kind === "income" ? item.amountCents : -item.amountCents} tone="auto" />}
                  {item.mine && !item.synthetic ? <button className="rounded-lg p-1 text-muted" onClick={() => void remove(item.id)} aria-label={`Apagar ${item.name}`}><Trash2 size={15} /></button> : null}
                </div>
              )) : <p className="text-sm text-muted">Nada neste dia.</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-surface p-4">
            <h2 className="font-semibold">Extrato do mês</h2>
            <p className="mt-1 text-sm text-muted">Cada linha soma ou subtrai o que vocês lançaram. Toque no seu valor para alterar.</p>
            <div className="mt-4 space-y-2">
              {statement.length ? statement.map((item) => (
                <div key={`${item.person}-${item.id}`} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{formatDateBR(item.date)} · {item.person} · {item.name}</span>
                    <span className="text-xs text-muted">{item.kind === "income" ? "Entrou" : "Saiu"}. Ficou {formatBRL(item.after)}.</span>
                  </div>
                  {item.mine ? (
                    <button className="shrink-0" onClick={() => start(item.kind, item.id)} aria-label={`Editar ${item.name}`}>
                      <MoneyText cents={item.kind === "income" ? item.amountCents : -item.amountCents} tone="auto" />
                    </button>
                  ) : <MoneyText cents={item.kind === "income" ? item.amountCents : -item.amountCents} tone="auto" />}
                </div>
              )) : <p className="text-sm text-muted">Nenhum lançamento neste mês.</p>}
            </div>
          </section>

          <article className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
            <h2 className="font-semibold">O que foi lançado</h2>
            <p className="mb-4 mt-1 text-sm text-muted">O centro é o que entrou em {formatMonthLabel(month)}. Cada fatia é um gasto de vocês.</p>
            <CategoryChart receivedCents={received} receivedOn={receivedOn} slices={slices} />
          </article>
        </>
      ) : null}

      {open ? (
        <Modal title={editing ? "Alterar lançamento" : open === "income" ? "Valor recebido" : "Gasto"} onClose={() => { setOpen(null); setEditing(null); }}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            {editingItem?.synthetic ? null : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={cx("rounded-xl border px-3 py-2 text-sm", open === "expense" ? "border-expense bg-expense/10" : "border-line")} onClick={() => setOpen("expense")}>Gasto</button>
                <button type="button" className={cx("rounded-xl border px-3 py-2 text-sm", open === "income" ? "border-income bg-income/10" : "border-line")} onClick={() => setOpen("income")}>Recebido</button>
              </div>
            )}
            <Field label="Nome"><Input value={name} onChange={(event) => setName(event.target.value)} readOnly={editingItem?.synthetic} placeholder={open === "income" ? "Exemplo: Salário" : "Exemplo: Mercado"} /></Field>
            <MoneyField label={parts > 1 && !editing ? "Valor total" : "Valor"} value={amount} onChange={setAmount} />
            <DateBRField label="Data" value={date} onChange={setDate} />
            {editing ? null : (
              <Field label="Parcelas" hint={parts > 1 && amount ? `${parts} vezes de ${formatBRL(preview)}.` : "1 é à vista. Mais de 1 divide o total, uma parte em cada mês."}>
                <Input type="number" min={1} max={48} value={parts} onChange={(event) => setParts(Math.min(48, Math.max(1, Number(event.target.value) || 1)))} />
              </Field>
            )}
            <Button type="submit" loading={saving}>Salvar</Button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
