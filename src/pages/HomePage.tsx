import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button, DateBRField, Field, Input, Modal, MoneyField, MoneyText } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { amountLines, launchItems } from "@/domain/launches";
import { calendarCells, formatDateBR, formatMonthLabel, monthKey, shiftMonth } from "@/lib/dates";
import { formatBRL, splitAmount } from "@/lib/money";
import { errorMessage, cx } from "@/lib/utils";
import { deleteInstallmentGroup, moveToTrash } from "@/services/data";
import { saveSimpleLaunch, updateOpening } from "@/services/simpleSave";

export function HomePage() {
  const { data, today, refresh } = useFinance();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const requestedDay = params.get("dia");
  const [month, setMonth] = useState(monthKey(requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : today));
  const [selected, setSelected] = useState(requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : today);
  const [open, setOpen] = useState<"income" | "expense" | null>(params.get("novo") === "recebido" ? "income" : params.get("novo") === "gasto" ? "expense" : null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(selected);
  const [parts, setParts] = useState(1);
  const [saving, setSaving] = useState(false);
  const items = useMemo(() => launchItems(data), [data]);
  const cells = useMemo(() => calendarCells(month), [month]);
  const dayItems = items.filter((item) => item.date === selected);

  useEffect(() => {
    const day = params.get("dia");
    const next = params.get("novo");
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setSelected(day);
      setMonth(monthKey(day));
      setDate(day);
    }
    if (next === "gasto" || next === "recebido") {
      setEditing(null);
      setName("");
      setAmount(null);
      setParts(1);
      setOpen(next === "recebido" ? "income" : "expense");
    }
  }, [params]);

  function closeForm() {
    setOpen(null);
    setEditing(null);
    if (params.get("novo")) {
      params.delete("novo");
      setParams(params, { replace: true });
    }
  }

  function start(kind: "income" | "expense", id?: string) {
    const current = id ? items.find((item) => item.id === id) : null;
    setEditing(current ? current.id : null);
    setName(current?.name.replace(/\s*\(\d+\/\d+\)\s*$/, "") ?? "");
    setAmount(current?.amountCents ?? null);
    setDate(current?.date ?? selected);
    setParts(1);
    setOpen(current?.kind ?? kind);
  }

  async function save() {
    if (!open) return;
    if (name.trim().length < 2) return toast("Diga o nome.", "error");
    if (!amount || amount <= 0) return toast("Diga o valor.", "error");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast("Diga a data.", "error");
    const current = editing ? items.find((item) => item.id === editing) : null;
    setSaving(true);
    try {
      if (current?.synthetic && current.accountId) await updateOpening(current.accountId, amount, date);
      else await saveSimpleLaunch({ kind: open, name: name.trim(), amountCents: amount, occurredOn: date, installments: editing ? 1 : parts, id: editing ?? undefined }, data.accounts);
      toast(parts > 1 && !editing ? "Parcelas lançadas." : "Lançamento salvo.");
      closeForm();
      setSelected(date);
      setMonth(monthKey(date));
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item || item.synthetic) return;
    if (!window.confirm(item.groupId ? `Apagar todas as parcelas de ${item.name}?` : `Apagar ${item.name}?`)) return;
    try {
      if (item.groupId) await deleteInstallmentGroup(item.groupId);
      else await moveToTrash(id, null);
      toast("Lançamento apagado.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  const preview = parts > 1 && amount ? splitAmount(amount, parts)[0] ?? 0 : 0;
  const monthItems = items.filter((item) => item.date.startsWith(month));
  let running = 0;
  const statement = monthItems.map((item) => {
    running += item.kind === "income" ? item.amountCents : -item.amountCents;
    return { ...item, after: running };
  });
  const editingItem = editing ? items.find((item) => item.id === editing) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold sm:text-2xl">Calendário</h1>
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
                packed.push({ id: item.id, lines, income: item.kind === "income" });
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
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Extrato do dia</h2>
            <p className="text-sm text-muted">{formatDateBR(selected)}. O que não cabe no quadrinho aparece aqui.</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" onClick={() => start("expense")}>Gasto</Button>
          <Button className="flex-1" variant="secondary" onClick={() => start("income")}>Recebido</Button>
        </div>
        <div className="mt-4 space-y-2">
          {dayItems.length ? dayItems.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-2xl border border-line px-3 py-2">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="text-xs text-muted">{item.kind === "income" ? "Entrou" : "Saiu"}</span>
              </div>
              <button className="shrink-0 text-right" onClick={() => start(item.kind, item.id)} aria-label={`Editar ${item.name}`}>
                <MoneyText cents={item.kind === "income" ? item.amountCents : -item.amountCents} tone="auto" />
              </button>
              {item.synthetic ? null : <button className="rounded-lg p-1 text-muted" onClick={() => void remove(item.id)} aria-label={`Apagar ${item.name}`}><Trash2 size={15} /></button>}
            </div>
          )) : <p className="text-sm text-muted">Nada neste dia.</p>}
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-4">
        <h2 className="font-semibold">Extrato do mês</h2>
        <p className="mt-1 text-sm text-muted">Cada linha soma ou subtrai. Toque no valor para alterar.</p>
        <div className="mt-4 space-y-2">
          {statement.length ? statement.map((item) => (
            <div key={item.id} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{formatDateBR(item.date)} · {item.name}</span>
                <span className="text-xs text-muted">{item.kind === "income" ? "Entrou" : "Saiu"}. Ficou {formatBRL(item.after)}.</span>
              </div>
              <button className="shrink-0" onClick={() => start(item.kind, item.id)} aria-label={`Editar ${item.name}`}>
                <MoneyText cents={item.kind === "income" ? item.amountCents : -item.amountCents} tone="auto" />
              </button>
            </div>
          )) : <p className="text-sm text-muted">Nenhum lançamento neste mês.</p>}
        </div>
      </section>
      {open ? (
        <Modal title={editing ? "Alterar lançamento" : open === "income" ? "Valor recebido" : "Gasto"} onClose={closeForm}>
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
