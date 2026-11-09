import { useEffect, useState } from "react";
import { EmptyState, MoneyText, PageHeader } from "@/components/ui";
import { formatDateBR } from "@/lib/dates";
import { accountTypeLabel, statusLabel, typeLabel } from "@/lib/labels";
import { loadSignups, type Signup } from "@/services/admin";

function when(value: string | null): string {
  if (!value) return "Ainda não entrou";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AdminPage() {
  const [users, setUsers] = useState<Signup[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const selected = users.find((user) => user.id === selectedId) ?? users[0] ?? null;

  useEffect(() => {
    void loadSignups()
      .then((next) => {
        setUsers(next);
        setSelectedId(next[0]?.id ?? "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não consegui carregar os cadastros."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Cadastros" description="Saldo, gastos do mês e dados principais de cada pessoa. Só o administrador vê esta tela. Os valores seguem as mesmas regras do painel de cada usuário." />
      {loading ? <p className="text-sm text-muted">Buscando cadastros...</p> : null}
      {!loading && error ? <EmptyState title="Painel indisponível" text={error} /> : null}
      {!loading && !error && !users.length ? <EmptyState title="Nenhuma conta ainda" text="Quando alguém se cadastrar, os dados aparecem aqui." /> : null}
      {!loading && !error && users.length ? (
        <>
          <div className="overflow-hidden rounded-3xl border border-line bg-surface">
            <div className="border-b border-line px-5 py-4 text-sm text-muted">{users.length} {users.length === 1 ? "pessoa" : "pessoas"}. Clique em uma linha para ver as contas e os últimos lançamentos.</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Pessoa</th>
                    <th className="px-5 py-3 font-medium">Saldo</th>
                    <th className="px-5 py-3 font-medium">Receitas do mês</th>
                    <th className="px-5 py-3 font-medium">Gastos do mês</th>
                    <th className="px-5 py-3 font-medium">A pagar</th>
                    <th className="px-5 py-3 font-medium">Fim do mês</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className={`cursor-pointer border-t border-line ${selected?.id === user.id ? "bg-surface-2" : ""}`} onClick={() => setSelectedId(user.id)}>
                      <td className="px-5 py-3">
                        <p className="font-medium">{user.name || "Sem nome"}</p>
                        <p className="text-xs text-muted">{user.email}</p>
                      </td>
                      <td className="px-5 py-3"><MoneyText cents={user.balanceCents} tone="auto" /></td>
                      <td className="px-5 py-3"><MoneyText cents={user.incomeCents} tone="income" /></td>
                      <td className="px-5 py-3"><MoneyText cents={user.spendingCents} tone="expense" /></td>
                      <td className="px-5 py-3"><MoneyText cents={user.pendingCents} tone="expense" /></td>
                      <td className="px-5 py-3"><MoneyText cents={user.projectedEndCents} tone="auto" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {selected ? <UserDetail user={selected} /> : null}
        </>
      ) : null}
    </div>
  );
}

function UserDetail({ user }: { user: Signup }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{user.name || user.email}</h2>
        <p className="mt-1 text-sm text-muted">{user.email} · cadastro em {when(user.createdAt)} · último acesso {when(user.lastSignInAt)}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Saldo disponível</p>
          <p className="mt-2 text-2xl font-semibold"><MoneyText cents={user.balanceCents} tone="auto" /></p>
          <p className="mt-2 text-xs leading-5 text-muted">Dinheiro que já está nas contas. Faturas em aberto: <MoneyText cents={user.openInvoicesCents} />.</p>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Este mês</p>
          <p className="mt-2 text-sm">Entrou <MoneyText cents={user.incomeCents} tone="income" /></p>
          <p className="mt-1 text-sm">Gastou <MoneyText cents={user.spendingCents} tone="expense" /></p>
          <p className="mt-2 text-xs leading-5 text-muted">Gastos pagos e compras no cartão. Pagar a fatura não entra de novo.</p>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">Previsão no fim do mês</p>
          <p className="mt-2 text-2xl font-semibold"><MoneyText cents={user.projectedEndCents} tone="auto" /></p>
          <p className="mt-2 text-xs leading-5 text-muted">Inclui o que ainda vai entrar e o que ainda falta pagar: <MoneyText cents={user.pendingCents} />.</p>
        </article>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h3 className="font-semibold">Contas</h3>
          <div className="mt-3 space-y-3">
            {user.accounts.length ? user.accounts.map((account) => (
              <div key={`${account.name}-${account.type}`} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{account.name}{account.archived ? " · arquivada" : ""}</p>
                  <p className="text-xs text-muted">{account.institution || "Sem instituição"} · {accountTypeLabel(account.type)}</p>
                </div>
                <MoneyText cents={account.balanceCents} tone="auto" />
              </div>
            )) : <p className="text-sm text-muted">Nenhuma conta cadastrada.</p>}
          </div>
        </article>
        <article className="rounded-3xl border border-line bg-surface p-5">
          <h3 className="font-semibold">Cartões</h3>
          <div className="mt-3 space-y-3">
            {user.cards.length ? user.cards.map((card) => (
              <div key={`${card.name}-${card.bank}`} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{card.name}{card.archived ? " · arquivado" : ""}</p>
                  <p className="text-xs text-muted">{card.bank || "Sem banco"} · limite <MoneyText cents={card.limitCents} /></p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">Comprometido</p>
                  <MoneyText cents={card.committedCents} tone="expense" />
                </div>
              </div>
            )) : <p className="text-sm text-muted">Nenhum cartão cadastrado.</p>}
          </div>
        </article>
      </div>
      <article className="rounded-3xl border border-line bg-surface p-5">
        <h3 className="font-semibold">Últimos lançamentos</h3>
        <div className="mt-3 space-y-3">
          {user.recent.length ? user.recent.map((item) => (
            <div key={`${item.occurredOn}-${item.description}-${item.amountCents}`} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">{item.description}</p>
                <p className="text-xs text-muted">{formatDateBR(item.occurredOn)} · {typeLabel(item.type)} · {statusLabel(item.status, item.type)}</p>
              </div>
              <MoneyText cents={item.amountCents} tone={item.type === "income" ? "income" : item.type === "expense" || item.type === "invoice_payment" ? "expense" : "auto"} />
            </div>
          )) : <p className="text-sm text-muted">Nenhum lançamento ainda.</p>}
        </div>
      </article>
    </section>
  );
}
