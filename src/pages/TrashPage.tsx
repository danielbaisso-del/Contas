import { Button, EmptyState, MoneyText, PageHeader } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { visibleAccountName } from "@/lib/trash";
import { errorMessage } from "@/lib/utils";
import { deleteTransaction, restoreAccount, restoreTransaction } from "@/services/data";

export function TrashPage() {
  const { trash, refresh } = useFinance();
  const toast = useToast();
  const empty = trash.transactions.length === 0 && trash.accounts.length === 0;

  async function restoreItem(id: string, notes: string | null) {
    try {
      await restoreTransaction(id, notes);
      toast("Lançamento reativado. Ele volta para o saldo e para os gráficos.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  async function purgeItem(id: string) {
    try {
      await deleteTransaction(id);
      toast("Apaguei de vez. Esse valor não volta.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  return (
    <div>
      <PageHeader title="Lixeira" description="O que você tira das outras abas fica aqui e sai dos cálculos. Reativar devolve o valor para o saldo, as listas e os gráficos." />
      {empty ? <EmptyState title="Lixeira vazia" text="Ao apagar uma receita, despesa, parcela, conta fixa ou compra de cartão, ela aparece aqui." /> : (
        <div className="space-y-3">
          {trash.accounts.map((account) => (
            <article key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-line bg-surface p-4">
              <div>
                <p className="font-medium">{visibleAccountName(account.name)}</p>
                <p className="text-xs text-muted">Conta · saldo inicial {formatBRL(account.initialBalanceCents)}</p>
              </div>
              <Button variant="secondary" onClick={() => void restoreAccount(account.id, account.name).then(() => refresh()).then(() => toast("Conta reativada.")).catch((error) => toast(errorMessage(error), "error"))}>Reativar</Button>
            </article>
          ))}
          {trash.transactions.map((item) => (
            <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-line bg-surface p-4">
              <div>
                <p className="font-medium">{item.description}</p>
                <p className="text-xs text-muted">{item.type === "income" ? "Entrada" : item.type === "expense" ? "Saída" : "Movimento"} · {formatDateBR(item.occurredOn)} · <MoneyText cents={item.amountCents} /></p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void restoreItem(item.id, item.notes)}>Reativar</Button>
                <Button variant="ghost" onClick={() => void purgeItem(item.id)}>Apagar de vez</Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
