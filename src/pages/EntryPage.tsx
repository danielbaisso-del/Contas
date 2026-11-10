import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { Button, EmptyState, Field, Input, Modal, MoneyField, MoneyText, PageHeader, Select, useConfirm } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { planBankInstallments } from "@/finance/installments";
import { fixedBillDates } from "@/finance/recurrence";
import { formatDateBR, formatMonthLabel, todayISO } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { errorMessage } from "@/lib/utils";
import { COLORS } from "@/lib/labels";
import { createBankInstallments, deleteInstallmentGroup, moveToTrash, saveCategory, saveRecurrence, saveTransaction } from "@/services/data";
import type { Transaction, TransactionStatus } from "@/types/models";

type Mode = "income" | "expense";

export function IncomePage() {
  return <EntryPage mode="income" />;
}

export function ExpensePage() {
  return <EntryPage mode="expense" />;
}

function EntryPage({ mode }: { mode: Mode }) {
  const { data, refresh, today } = useFinance();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("novo") === "1");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const income = mode === "income";
  const title = income ? "Receitas" : "Despesas";
  const rows = useMemo(() => data.transactions
    .filter((item) => item.type === mode && (income || !item.creditCardId))
    .filter((item) => !onlyOpen || (income ? item.status !== "received" : item.status !== "paid"))
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.description.localeCompare(b.description)), [data.transactions, income, mode, onlyOpen]);
  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const item of rows) {
      const key = (item.dueOn || item.occurredOn).slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  useEffect(() => {
    if (params.get("novo") === "1") setOpen(true);
  }, [params]);

  function close() {
    setOpen(false);
    setEditing(null);
    if (params.get("novo")) {
      params.delete("novo");
      setParams(params);
    }
  }

  async function remove(item: Transaction) {
    if (item.installmentGroupId) {
      if (!(await confirm(`Apagar todas as parcelas de ${item.description}? Elas saem de todos os meses.`))) return;
    } else if (!(await confirm(`Enviar ${item.description} para a lixeira? Dá para reativar depois.`))) return;
    try {
      if (item.installmentGroupId) await deleteInstallmentGroup(item.installmentGroupId);
      else await moveToTrash(item.id, item.notes);
      toast("Foi para a lixeira. Dá para reativar na aba Lixeira.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  async function settle(item: Transaction) {
    try {
      await saveTransaction({
        description: item.description,
        amountCents: item.amountCents,
        type: item.type,
        occurredOn: today,
        dueOn: item.dueOn ?? item.occurredOn,
        status: income ? "received" : "paid",
        categoryId: item.categoryId,
        accountId: item.accountId,
        paymentMethod: item.paymentMethod,
        notes: item.notes,
      }, item.id);
      toast(income ? "Marcado como recebido." : "Marcado como pago.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  return (
    <div>
      <PageHeader
        title={title}
        description={income
          ? "Salário, serviço, cliente, venda ou outra entrada. Cada uma leva descrição, valor, categoria, data e se já foi recebida."
          : "Cada despesa tem valor, data e categoria. Uma compra parcelada divide o total e coloca uma parcela em cada mês, no mesmo dia."}
        action={<><Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setCategoryOpen(true)}>Nova categoria</Button><Button className="flex-1 sm:flex-none" onClick={() => { setEditing(null); setOpen(true); }}>{income ? "Nova receita" : "Nova despesa"}</Button></>}
      />
      <div className="mb-4 flex gap-2">
        <button className={`rounded-full px-3 py-1.5 text-sm ${onlyOpen ? "bg-surface text-muted" : "bg-accent text-white"}`} onClick={() => setOnlyOpen(false)}>Todas</button>
        <button className={`rounded-full px-3 py-1.5 text-sm ${onlyOpen ? "bg-accent text-white" : "bg-surface text-muted"}`} onClick={() => setOnlyOpen(true)}>{income ? "Ainda vou receber" : "Ainda vou pagar"}</button>
      </div>
      {!rows.length ? (
        <EmptyState title={income ? "Nenhuma receita ainda" : "Nenhuma despesa ainda"} text={income ? "Exemplo: Salário, R$ 3.200, categoria Salário, dia 5, recebido." : "Exemplo: Internet, R$ 120, categoria Contas da casa, vence dia 10, pendente."} action={<Button onClick={() => setOpen(true)}>{income ? "Lançar a primeira receita" : "Lançar a primeira despesa"}</Button>} />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {(income ? [["", rows] as const] : groups).map(([month, items]) => <div key={month || "receitas"} className="space-y-3">{month ? <h2 className="text-sm font-semibold">{formatMonthLabel(month)}</h2> : null}{items.map((item) => {
            const openItem = income ? item.status !== "received" : item.status !== "paid";
            const category = data.categories.find((entry) => entry.id === item.categoryId)?.name ?? "Sem categoria";
            return (
              <article key={item.id} className="rounded-3xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{item.description}</p>
                    <p className="mt-1 text-xs text-muted">Data: {formatDateBR(item.dueOn || item.occurredOn)}{item.installmentNumber ? ` · parcela ${item.installmentNumber}/${item.installmentTotal}` : ""}{item.recurrenceId ? " · conta fixa" : ""} · {category} · {openItem ? "Pendente" : income ? "Recebido" : "Pago"}</p>
                  </div>
                  <MoneyText cents={item.amountCents} tone={income ? "income" : "expense"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {openItem ? <Button variant="secondary" onClick={() => void settle(item)}>{income ? "Recebi" : "Paguei"}</Button> : null}
                  <Button variant="ghost" onClick={() => { setEditing(item); setOpen(true); }}>Editar</Button>
                  <Button variant="ghost" onClick={() => void remove(item)}>Apagar</Button>
                </div>
              </article>
            );
          })}</div>)}
        </div>
        <div className="hidden overflow-x-auto rounded-3xl border border-line bg-surface md:block">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-3">{income ? "Recebimento" : "Vencimento"}</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Status</th>
                <th>Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(income ? [["", rows] as const] : groups).map(([month, items]) => items.map((item, index) => {
                const openItem = income ? item.status !== "received" : item.status !== "paid";
                const category = data.categories.find((entry) => entry.id === item.categoryId)?.name ?? "Sem categoria";
                return (
                  <tr key={item.id} className="border-t border-line">
                    <td className="px-4 py-3">{index === 0 && month ? <span className="block text-xs text-muted">{formatMonthLabel(month)}</span> : null}{formatDateBR(item.dueOn || item.occurredOn)}{item.installmentNumber ? ` · ${item.installmentNumber}/${item.installmentTotal}` : ""}{item.recurrenceId ? " · conta fixa" : ""}</td>
                    <td className="font-medium">{item.description}</td>
                    <td>{category}</td>
                    <td>{openItem ? "Pendente" : income ? "Recebido" : "Pago"}</td>
                    <td><MoneyText cents={item.amountCents} tone={income ? "income" : "expense"} /></td>
                    <td className="px-3 text-right">
                      {openItem ? <button className="mr-1 rounded-lg px-2 py-1 text-xs text-accent" onClick={() => void settle(item)}>{income ? "Recebi" : "Paguei"}</button> : null}
                      <button className="p-2" onClick={() => { setEditing(item); setOpen(true); }} aria-label="Editar"><Pencil size={15} /></button>
                      <button className="p-2" onClick={() => void remove(item)} aria-label="Apagar"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
        </>
      )}
      {open ? <EntryModal mode={mode} transaction={editing} today={today} onClose={close} /> : null}
      {categoryOpen ? <CategoryModal mode={mode} onClose={() => setCategoryOpen(false)} /> : null}
      {dialog}
    </div>
  );
}

function EntryModal({ mode, transaction, today, onClose }: { mode: Mode; transaction: Transaction | null; today: string; onClose: () => void }) {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const income = mode === "income";
  const accounts = data.accounts.filter((account) => !account.archived);
  const categories = data.categories.filter((category) => category.kind === mode);
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [amount, setAmount] = useState<number | null>(transaction?.amountCents ?? null);
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? categories[0]?.id ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [pickName, setPickName] = useState<string | null>(null);
  useEffect(() => {
    if (!pickName) return;
    const found = data.categories.find((category) => category.kind === mode && category.name.toLocaleLowerCase("pt-BR") === pickName.toLocaleLowerCase("pt-BR"));
    if (!found) return;
    setCategoryId(found.id);
    setPickName(null);
  }, [data.categories, mode, pickName]);
  const [date, setDate] = useState(transaction?.dueOn || transaction?.occurredOn || todayISO());
  const [done, setDone] = useState(transaction ? (income ? transaction.status === "received" : transaction.status === "paid") : true);
  const [accountId, setAccountId] = useState(transaction?.accountId ?? accounts[0]?.id ?? "");
  const [fixed, setFixed] = useState(false);
  const [installments, setInstallments] = useState(1);
  const [saving, setSaving] = useState(false);
  const parcelCount = Math.min(48, Math.max(1, Math.round(installments) || 1));
  const preview = !income && !transaction && amount && parcelCount > 1 ? planBankInstallments({ totalCents: amount, count: parcelCount, firstDate: date }) : [];
  const fixedDates = !income && !transaction && fixed && parcelCount === 1 ? fixedBillDates(date, today) : [];

  async function addCategory() {
    const name = newCategory.trim();
    if (name.length < 2) return toast("Informe o nome da categoria.", "error");
    try {
      await saveCategory(name, mode, COLORS[data.categories.length % COLORS.length]);
      setPickName(name);
      setNewCategory("");
      await refresh();
      toast("Categoria adicionada. Ela já aparece na lista.");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  async function submit() {
    if (!accounts.length) return toast("Cadastre uma conta antes, para saber onde o dinheiro está.", "error");
    if (!description.trim()) return toast("Informe o nome.", "error");
    if (!amount) return toast("Informe o valor.", "error");
    const status: TransactionStatus = income ? (done ? "received" : "pending") : (done ? "paid" : "pending");
    setSaving(true);
    try {
      if (!income && !transaction && parcelCount > 1) {
        await createBankInstallments({
          description: description.trim(),
          totalCents: amount,
          count: parcelCount,
          firstDate: date,
          categoryId: categoryId || null,
          accountId,
          firstPaid: done,
        });
        toast(`Compra parcelada em ${parcelCount} meses. Cada parcela aparece na data dela.`);
      } else if (!income && fixed && !transaction) {
        await saveRecurrence({
          description,
          amountCents: amount,
          type: "expense",
          categoryId: categoryId || null,
          accountId,
          frequency: "monthly",
          interval: 1,
          startOn: date,
        });
        toast("Conta fixa salva em todos os meses, neste dia.");
      } else {
        await saveTransaction({
          description,
          amountCents: amount,
          type: mode,
          occurredOn: date,
          dueOn: date,
          status,
          categoryId: categoryId || null,
          accountId,
        }, transaction?.id);
        toast(income ? "Receita salva com esta data. Dá para mudar a data, o valor e o nome depois." : "Despesa salva.");
      }
      await refresh();
      onClose();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={transaction ? "Editar" : income ? "Nova receita" : "Nova despesa"} onClose={onClose}>
      {!accounts.length ? (
        <div className="space-y-3 text-sm leading-6">
          <p>Antes do valor, cadastre onde o dinheiro está. Pode ser o banco, uma carteira ou o dinheiro em espécie.</p>
          <Link className="inline-block text-accent" to="/contas" onClick={onClose}>Cadastrar a conta</Link>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Descrição" hint={income ? "Salário e renda extra são lançamentos separados. Cada um guarda a própria data." : "Exemplos: Mercado, Aluguel, Luz, Internet, Combustível."}>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          {income ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-full bg-surface px-3 py-1.5 text-sm" onClick={() => setDescription("Salário")}>Salário</button>
              <button type="button" className="rounded-full bg-surface px-3 py-1.5 text-sm" onClick={() => setDescription("Renda extra")}>Renda extra</button>
            </div>
          ) : null}
          <MoneyField label={!income && parcelCount > 1 ? "Valor total" : "Valor"} value={amount} onChange={setAmount} />
          <Field label="Categoria">
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Sem categoria</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Input value={newCategory} placeholder={income ? "Nova categoria de receita" : "Nova categoria de despesa"} onChange={(event) => setNewCategory(event.target.value)} />
            <Button variant="secondary" onClick={() => void addCategory()}>Adicionar</Button>
          </div>
          <Field label={income ? "Data deste recebimento" : "Data de vencimento"} hint={income ? "O dia do salário e o dia da renda extra podem mudar. Edite o lançamento para trocar a data." : "Esta data vale para este lançamento. Marque conta fixa se o mesmo valor volta todo mês."}>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          {!income && !transaction ? (
            <Field label="Parcelas" hint="1 é à vista. De 2 a 48, o valor total se divide e cada parcela entra no mesmo dia dos meses seguintes.">
              <Input type="number" min={1} max={48} value={installments} onChange={(event) => setInstallments(Number(event.target.value))} />
            </Field>
          ) : null}
          {preview.length > 1 ? (
            <div className="rounded-2xl border border-line p-3 text-sm">
              <p className="mb-2 font-medium">Parcelas por mês</p>
              {preview.map((item) => <p key={item.number} className="flex flex-col gap-0.5 py-1 sm:flex-row sm:justify-between"><span>Parcela {item.number}/{item.total} · {formatDateBR(item.occurredOn)}</span><span>{formatBRL(item.amountCents)}</span></p>)}
            </div>
          ) : null}
          {!income && !transaction && parcelCount === 1 ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fixed} onChange={(event) => setFixed(event.target.checked)} />
              Conta fixa em todos os meses, neste dia
            </label>
          ) : null}
          {fixedDates.length ? (
            <div className="max-h-48 overflow-y-auto rounded-2xl border border-line p-3 text-sm">
              <p className="mb-2 font-medium">Todos os meses</p>
              {fixedDates.map((day) => <p key={day} className="flex flex-col gap-0.5 py-1 sm:flex-row sm:justify-between"><span>{formatDateBR(day)} · conta fixa</span><span>{formatBRL(amount ?? 0)}</span></p>)}
            </div>
          ) : null}
          <Field label="Status">
            <Select value={done ? "done" : "open"} onChange={(event) => setDone(event.target.value === "done")}>
              <option value="done">{income ? "Recebido" : "Pago"}</option>
              <option value="open">Pendente</option>
            </Select>
          </Field>
          <Field label={income ? "Para qual conta foi" : "De qual conta sai"} hint={accounts.length === 1 ? "Você tem uma conta, então ela já fica escolhida." : "Escolha a conta deste lançamento."}>
            <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </Select>
          </Field>
          <p className="text-xs text-muted">Hoje é {today.split("-").reverse().join("/")}.</p>
          <Button onClick={() => void submit()} loading={saving}>Salvar</Button>
        </div>
      )}
    </Modal>
  );
}

function CategoryModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const [name, setName] = useState("");
  const income = mode === "income";
  const categories = data.categories.filter((category) => category.kind === mode);
  return (
    <Modal title={income ? "Categorias de receita" : "Categorias de despesa"} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input value={name} placeholder="Nome da nova categoria" onChange={(event) => setName(event.target.value)} />
          <Button onClick={async () => {
            try {
              await saveCategory(name, mode, COLORS[data.categories.length % COLORS.length]);
              setName("");
              await refresh();
              toast("Categoria adicionada.");
            } catch (error) {
              toast(errorMessage(error), "error");
            }
          }}>Adicionar</Button>
        </div>
        <div className="space-y-2 text-sm">
          {categories.length ? categories.map((category) => (
            <p key={category.id} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: category.color }} />{category.name}</p>
          )) : <p className="text-muted">Nenhuma categoria ainda.</p>}
        </div>
      </div>
    </Modal>
  );
}
