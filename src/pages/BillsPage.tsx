import { Link } from "react-router-dom";
import { Button, EmptyState, MoneyText, PageHeader } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { invoiceTotal } from "@/finance/engine";
import { formatDateBR } from "@/lib/dates";
import { errorMessage } from "@/lib/utils";
import { saveTransaction } from "@/services/data";
import type { Transaction } from "@/types/models";

export function BillsPage() {
  const { data, today, refresh } = useFinance();
  const toast = useToast();
  const bills = data.transactions
    .filter((item) => (item.type === "income" && item.status !== "received") || (item.type === "expense" && !item.creditCardId && item.status !== "paid"))
    .sort((a, b) => (a.dueOn || a.occurredOn).localeCompare(b.dueOn || b.occurredOn));
  const invoices = data.invoices
    .filter((invoice) => invoice.status !== "paid" && invoiceTotal(invoice.id, data.transactions) > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  async function settle(item: Transaction) {
    const income = item.type === "income";
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
      toast(income ? "Marcado como recebido. O valor entra no saldo." : "Marcado como pago. O valor sai do saldo.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  return (
    <div>
      <PageHeader title="Contas a pagar e receber" description="O que ainda não aconteceu. Verde entra, vermelho sai. Marque quando o dinheiro de fato entrar ou sair." />
      {!bills.length && !invoices.length ? (
        <EmptyState title="Nada em aberto" text="Uma conta pendente aparece aqui. Exemplo: Internet, R$ 120, vence em 10/11." action={<Link className="text-sm text-accent" to="/despesas?novo=1">Lançar uma despesa pendente</Link>} />
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-3">Descrição</th>
                <th>Valor</th>
                <th>Vencimento</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bills.map((item) => {
                const when = item.dueOn || item.occurredOn;
                const income = item.type === "income";
                const late = when < today;
                return (
                  <tr key={item.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.description}</p>
                      <p className="text-xs text-muted">{income ? "A receber" : "A pagar"}{late ? " · vencida" : ""}</p>
                    </td>
                    <td><MoneyText cents={item.amountCents} tone={income ? "income" : "expense"} /></td>
                    <td className={late ? "text-expense" : ""}>{formatDateBR(when)}</td>
                    <td className="px-4 text-right"><Button variant="secondary" onClick={() => void settle(item)}>{income ? "Recebi" : "Paguei"}</Button></td>
                  </tr>
                );
              })}
              {invoices.map((invoice) => {
                const card = data.cards.find((item) => item.id === invoice.creditCardId);
                const total = invoiceTotal(invoice.id, data.transactions);
                const late = invoice.dueOn < today;
                return (
                  <tr key={invoice.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <p className="font-medium">Fatura {card?.name ?? "do cartão"}</p>
                      <p className="text-xs text-muted">A pagar · cartão{late ? " · vencida" : ""}</p>
                    </td>
                    <td><MoneyText cents={total} tone="expense" /></td>
                    <td className={late ? "text-expense" : ""}>{formatDateBR(invoice.dueOn)}</td>
                    <td className="px-4 text-right"><Link className="text-sm text-accent" to={`/cartoes/${invoice.creditCardId}`}>Pagar no cartão</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
