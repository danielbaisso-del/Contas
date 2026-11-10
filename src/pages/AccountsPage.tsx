import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, EmptyState, Field, Input, Modal, MoneyField, MoneyText, PageHeader, Select } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { balanceParts, totalBalance } from "@/finance/engine";
import { ACCOUNT_TYPES, accountTypeLabel, COLORS } from "@/lib/labels";
import { todayISO } from "@/lib/dates";
import { errorMessage } from "@/lib/utils";
import { deleteAccount, saveAccount, saveTransaction, setAccountArchived } from "@/services/data";
import type { Account, AccountType } from "@/types/models";

export function AccountsPage() {
  const { data, today } = useFinance();
  const [params] = useSearchParams();
  const focus = params.get("conta");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [transfer, setTransfer] = useState(false);
  const total = totalBalance(data.accounts, data.transactions, today);
  return (
    <div>
      <PageHeader title="Contas e dinheiro" description="O saldo atual começa no saldo inicial e acompanha só o que já aconteceu. Transferir entre contas não conta como gasto nem como ganho." action={<div className="flex gap-2"><Button variant="secondary" onClick={() => setTransfer(true)}>Transferir</Button><Button onClick={() => { setEditing(null); setOpen(true); }}>Nova conta</Button></div>} />
      <article className="mb-4 rounded-3xl border border-line bg-surface p-5">
        <p className="text-sm text-muted">Saldo de hoje. O mesmo número da visão geral.</p>
        <p className="mt-1 text-3xl font-semibold"><MoneyText cents={total} tone="auto" /></p>
      </article>
      {!data.accounts.length ? <EmptyState title="Nenhuma conta ainda" text="Cadastre o banco principal, uma carteira digital ou o dinheiro em espécie. Se você vai lançar o histórico depois, use como saldo inicial o valor anterior ao primeiro lançamento." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.accounts.map((account) => <AccountCard key={account.id} account={account} highlighted={focus === account.id} onEdit={() => { setEditing(account); setOpen(true); }} />)}
        </div>
      )}
      {open ? <AccountModal account={editing} onClose={() => setOpen(false)} /> : null}
      {transfer ? <TransferModal onClose={() => setTransfer(false)} /> : null}
    </div>
  );
}

function AccountCard({ account, onEdit, highlighted = false }: { account: Account; onEdit: () => void; highlighted?: boolean }) {
  const { data, today, refresh } = useFinance();
  const toast = useToast();
  const parts = balanceParts(account, data.transactions, today);
  const balance = parts.balanceCents;
  useEffect(() => {
    if (highlighted) document.getElementById(`conta-${account.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [account.id, highlighted]);
  return (
    <article id={`conta-${account.id}`} className={`rounded-3xl border bg-surface p-5 ${highlighted ? "border-accent ring-2 ring-accent" : "border-line"}`}>
      <div className="flex items-start justify-between"><div><p className="font-semibold">{account.name}</p><p className="text-xs text-muted">{account.institution || "Sem instituição"} · {accountTypeLabel(account.type)}</p></div><span className="h-3 w-3 rounded-full" style={{ background: account.color }} /></div>
      <p className="mt-4 text-2xl font-semibold"><MoneyText cents={balance} tone="auto" /></p>
      <p className="mt-2 text-xs text-muted">Começou com <MoneyText cents={parts.initialCents} />. Entrou <MoneyText cents={parts.inCents} />. Saiu <MoneyText cents={parts.outCents} />.</p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onEdit}>Editar</Button>
        <Button variant="ghost" onClick={async () => { await setAccountArchived(account.id, !account.archived); await refresh(); }}>{account.archived ? "Reativar" : "Arquivar"}</Button>
        <Button variant="ghost" onClick={async () => { try { const result = await deleteAccount(account.id); toast(result === "trashed" ? "A conta tem lançamentos, então foi para a lixeira. Dá para reativar." : "Conta excluída."); await refresh(); } catch (error) { toast(errorMessage(error), "error"); } }}>Excluir</Button>
      </div>
    </article>
  );
}

function AccountModal({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { refresh } = useFinance();
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? "");
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "checking");
  const [initial, setInitial] = useState<number | null>(account?.initialBalanceCents ?? 0);
  const [color, setColor] = useState(account?.color ?? COLORS[0]);
  return (
    <Modal title={account ? "Editar conta" : "Nova conta"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nome"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Banco principal, dinheiro, Mercado Pago..." /></Field>
        <Field label="Instituição"><Input value={institution} onChange={(event) => setInstitution(event.target.value)} /></Field>
        <Field label="Tipo"><Select value={type} onChange={(event) => setType(event.target.value as AccountType)}>{ACCOUNT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
        <MoneyField label="Saldo inicial" value={initial} onChange={setInitial} hint="Ponto de partida antes dos lançamentos. Não use este campo para registrar uma nova receita." />
        <div className="flex gap-2">{COLORS.map((item) => <button key={item} className="h-7 w-7 rounded-full ring-2 ring-transparent" style={{ background: item, outline: color === item ? "2px solid var(--ink)" : undefined }} onClick={() => setColor(item)} />)}</div>
        <Button onClick={async () => { try { await saveAccount({ name, institution, type, initialBalanceCents: initial ?? 0, color }, account?.id); await refresh(); onClose(); } catch (error) { toast(errorMessage(error), "error"); } }}>Salvar</Button>
      </div>
    </Modal>
  );
}

function TransferModal({ onClose }: { onClose: () => void }) {
  const { data, refresh, today } = useFinance();
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const accounts = data.accounts.filter((account) => !account.archived);
  return (
    <Modal title="Transferir entre contas" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">O dinheiro sai de uma conta e entra na outra. O total que você possui continua igual.</p>
        <Field label="De"><Select value={from} onChange={(event) => setFrom(event.target.value)}><option value="">Selecione</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></Field>
        <Field label="Para"><Select value={to} onChange={(event) => setTo(event.target.value)}><option value="">Selecione</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></Field>
        <MoneyField label="Valor" value={amount} onChange={setAmount} />
        <Field label="Data"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Button onClick={async () => {
          try {
            if (!amount) throw new Error("Informe o valor.");
            await saveTransaction({ description: "Transferência entre contas", amountCents: amount, type: "transfer", occurredOn: date, status: date > today ? "planned" : "paid", accountId: from, destinationAccountId: to, paymentMethod: "transfer" });
            toast("Transferência registrada.");
            await refresh();
            onClose();
          } catch (error) { toast(errorMessage(error), "error"); }
        }}>Transferir</Button>
      </div>
    </Modal>
  );
}
