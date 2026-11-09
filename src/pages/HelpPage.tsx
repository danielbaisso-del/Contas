export function HelpPage() {
  const blocks = [
    ["Saldo disponível", "É o dinheiro que já está nas suas contas. Ele começa no saldo inicial e muda apenas com receita recebida, despesa paga, transferência concluída e pagamento de fatura."],
    ["Saldo previsto", "É o saldo disponível mais o que ainda deve entrar e menos o que ainda deve sair até a data escolhida. Conta vencida e fatura atrasada também entram, porque continuam em aberto."],
    ["Despesa de cartão", "A compra no cartão aparece nos gastos e na fatura, mas não sai da conta na hora. Quando você paga a fatura, o dinheiro sai da conta e a obrigação do cartão acaba. O gasto não é contado duas vezes."],
    ["Transferência", "Mover dinheiro entre suas contas não é receita nem despesa. O total permanece igual; só muda a conta em que ele está."],
    ["Recorrência", "Aluguel, internet e salário podem se repetir. O sistema cria os lançamentos do mês atual até 12 meses à frente e não cria o mesmo dia duas vezes. Pausar interrompe os próximos. Cancelar apaga apenas os futuros que ainda não foram pagos ou recebidos."],
    ["Parcelas", "O valor é dividido em centavos, sem perder nem criar dinheiro. No cartão, cada parcela cai na fatura do mês correspondente, respeitando o dia de fechamento."],
    ["Assistente", "A inteligência artificial entende a frase e monta uma prévia. Os cálculos continuam sendo feitos pelo sistema. Nada é salvo antes de você confirmar."],
  ];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Como os números funcionam</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Leia isto uma vez. As mesmas regras valem no painel, no calendário, nos relatórios e no assistente.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {blocks.map(([title, text]) => (
          <article key={title} className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
