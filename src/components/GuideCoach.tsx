import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Sparkles, Square, X } from "lucide-react";
import { ConfirmationCard } from "@/pages/AssistantPage";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import type { AssistantResponse, Confirmation } from "@/domain/assistant";
import { firstGuideStep, isSkip, type GuideStep } from "@/domain/guide";
import { monthIncome, monthSpending, pendingBills } from "@/finance/engine";
import { currentMonth, formatMonthLabel } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { errorMessage } from "@/lib/utils";
import { askAssistant } from "@/services/ai";
import { Button } from "@/components/ui";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  confirmation: Confirmation | null;
}

const GuideContext = createContext<{ openGuide: () => void } | null>(null);

export function useGuide() {
  const value = useContext(GuideContext);
  if (!value) throw new Error("O guia da IA só pode ser aberto dentro do aplicativo.");
  return value;
}

const QUESTIONS: Record<Exclude<GuideStep, "done">, { title: string; text: string; example: string; saved: string }> = {
  account: {
    title: "Onde está o seu dinheiro agora?",
    text: "Fale o nome da conta e quanto tem nela hoje. Pode ser banco, carteira digital ou dinheiro em espécie.",
    example: "Nubank com R$ 1.200",
    saved: "Conta salva. Tem outra? Se não, diga: só isso.",
  },
  income: {
    title: "Quanto já entrou neste mês?",
    text: "Diga uma receita por vez: de onde veio, o valor e em qual conta caiu.",
    example: "Recebi R$ 3.200 de salário no Nubank",
    saved: "Receita salva. Entrou mais alguma coisa? Se não, diga: só isso.",
  },
  paid: {
    title: "O que você já pagou neste mês?",
    text: "Diga uma conta por vez. Ela entra como despesa paga e não será contada de novo.",
    example: "Paguei R$ 150 de internet",
    saved: "Despesa paga salva. Tem mais alguma? Se não, diga: só isso.",
  },
  upcoming: {
    title: "O que ainda falta pagar?",
    text: "Diga o nome, o valor e o dia. Isso fica como conta a pagar e ainda não sai do saldo.",
    example: "Aluguel de R$ 1.800 no dia 10",
    saved: "Conta a pagar salva. Falta mais alguma? Se não, diga: só isso.",
  },
};

function speechRecognizer() {
  const ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!ctor) return null;
  const recognition = new ctor();
  recognition.lang = "pt-BR";
  recognition.interimResults = true;
  recognition.continuous = false;
  return recognition;
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const { data, today, refresh } = useFinance();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<GuideStep | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognition | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeStep = step ?? firstGuideStep(data, today);
  const question = activeStep === "done" ? null : QUESTIONS[activeStep];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, notice, open]);

  useEffect(() => () => recognition.current?.stop(), []);

  function openGuide() {
    setStep((current) => current ?? firstGuideStep(data, today));
    setOpen(true);
  }

  function say(content: string) {
    setItems((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content, confirmation: null }]);
  }

  function advance(from: GuideStep) {
    if (from === "account" && !data.accounts.some((account) => !account.archived)) {
      setNotice("Preciso de pelo menos uma conta para guardar o dinheiro. Fale o nome e o saldo.");
      return;
    }
    const order: GuideStep[] = ["account", "income", "paid", "upcoming", "done"];
    const next = order[order.indexOf(from) + 1] ?? "done";
    setStep(next);
    setNotice(null);
    if (next !== "done") say(QUESTIONS[next].title);
  }

  async function send(raw?: string) {
    const content = (raw ?? text).trim();
    if (!content || loading || activeStep === "done") return;
    setText("");
    setNotice(null);
    if (isSkip(content)) {
      setItems((current) => [...current, { id: crypto.randomUUID(), role: "user", content, confirmation: null }]);
      advance(activeStep);
      return;
    }
    const history = items.slice(-6).map((item) => ({ role: item.role, content: item.content }));
    setItems((current) => [...current, { id: crypto.randomUUID(), role: "user", content, confirmation: null }]);
    setLoading(true);
    try {
      const response = await askAssistant({ mode: "interpret", text: content, history, guide: activeStep });
      setItems((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: response.reply, confirmation: response.confirmation }]);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  function listen() {
    if (listening) {
      recognition.current?.stop();
      setListening(false);
      return;
    }
    const engine = speechRecognizer();
    if (!engine) {
      setNotice("Este navegador não ouve áudio. Escreva a resposta no campo abaixo. O Chrome e o Edge costumam ouvir.");
      return;
    }
    recognition.current = engine;
    let finalText = "";
    engine.onresult = (event) => {
      let spoken = "";
      for (let index = 0; index < event.results.length; index += 1) spoken += event.results[index]?.[0]?.transcript ?? "";
      finalText = spoken.trim();
      setText(finalText);
    };
    engine.onerror = () => setNotice("Não consegui usar o microfone. Permita o acesso ou escreva a resposta.");
    engine.onend = () => {
      setListening(false);
      if (finalText) void send(finalText);
    };
    setListening(true);
    setNotice("Estou ouvindo. Fale a resposta e faça uma pausa.");
    engine.start();
  }

  async function confirm(itemId: string, confirmation: Confirmation) {
    setLoading(true);
    try {
      const response: AssistantResponse = await askAssistant({ mode: "confirm", kind: confirmation.kind, draft: confirmation.draft });
      setItems((current) => current.map((item) => item.id === itemId ? { ...item, confirmation: null } : item).concat({ id: crypto.randomUUID(), role: "assistant", content: response.reply, confirmation: null }));
      await refresh();
      if (activeStep !== "done") setNotice(QUESTIONS[activeStep].saved);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  const month = currentMonth(today);
  const received = monthIncome(data.transactions, month, "received");
  const spent = monthSpending(data.transactions, month);
  const pending = pendingBills(data.transactions, month, today);
  const pendingTotal = pending.reduce((sum, item) => sum + item.amountCents, 0);

  return (
    <GuideContext.Provider value={{ openGuide }}>
      {children}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-accent">Assistente Financeiro</p>
                <h2 className="mt-1 text-lg font-semibold">{question?.title ?? "Seu mês está organizado"}</h2>
              </div>
              <button className="rounded-xl border border-line p-2" onClick={() => setOpen(false)} aria-label="Fechar"><X size={16} /></button>
            </div>
            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {question ? <p className="text-sm leading-6 text-muted">{question.text} Exemplo: “{question.example}”.</p> : (
                <div className="space-y-2 text-sm leading-6">
                  <p>Usei só o que você confirmou. Nada foi inventado.</p>
                  <p>Contas cadastradas: {data.accounts.filter((account) => !account.archived).length}.</p>
                  <p>Receitas já recebidas em {formatMonthLabel(month)}: {formatBRL(received)}.</p>
                  <p>Despesas já pagas neste mês: {formatBRL(spent)}.</p>
                  <p>Ainda falta pagar: {formatBRL(pendingTotal)} em {pending.length} conta(s).</p>
                </div>
              )}
              {items.map((item) => (
                <div key={item.id} className={`max-w-full rounded-2xl px-4 py-3 text-sm leading-6 ${item.role === "user" ? "ml-auto bg-accent text-white" : "bg-surface-2"}`}>
                  <p>{item.content}</p>
                  {item.confirmation ? <ConfirmationCard confirmation={item.confirmation} disabled={loading} confirmLabel="Pode salvar" onDismiss={() => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, confirmation: null } : entry))} onConfirm={(next) => void confirm(item.id, next)} /> : null}
                </div>
              ))}
              {notice ? <p className="rounded-2xl bg-income-soft px-4 py-3 text-sm leading-6 text-income">{notice}</p> : null}
            </div>
            {question ? (
              <div className="space-y-3 border-t border-line px-5 py-4">
                <textarea className="w-full rounded-2xl border border-line bg-canvas px-3 py-3 text-sm text-ink outline-none focus:border-accent" rows={2} value={text} placeholder="Fale ou escreva a resposta" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
                <div className="flex gap-2">
                  <button className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${listening ? "bg-expense text-white" : "bg-accent text-white"}`} onClick={listen} type="button">
                    {listening ? <Square size={16} /> : <Mic size={16} />}
                    {listening ? "Parar e enviar" : "Falar"}
                  </button>
                  <Button loading={loading} onClick={() => void send()}>Enviar</Button>
                </div>
              </div>
            ) : <div className="border-t border-line px-5 py-4"><Button onClick={() => setOpen(false)}>Ver meu painel</Button></div>}
          </div>
        </div>
      ) : (
        <button className="attention fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-4 text-sm font-semibold text-white shadow-2xl" onClick={openGuide} type="button">
          <Sparkles size={18} />
          Falar com a IA
        </button>
      )}
    </GuideContext.Provider>
  );
}
