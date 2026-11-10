import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Mic, Sparkles, Square, X } from "lucide-react";
import { ConfirmationCard } from "@/pages/AssistantPage";
import { AnswerChart } from "@/components/Charts";
import { PlaceLink } from "@/components/PlaceLink";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import type { AssistantChart, AssistantPlace, AssistantResponse, Confirmation, InterviewState } from "@/domain/assistant";
import { isSkip } from "@/domain/guide";
import { errorMessage } from "@/lib/utils";
import { askAssistant } from "@/services/ai";
import { loadAssistantMessages, saveAssistantMessage } from "@/services/data";
import { Button } from "@/components/ui";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  confirmation: Confirmation | null;
  chart: AssistantChart | null;
  place: AssistantPlace | null;
}

const GuideContext = createContext<{ openGuide: () => void; focusChart: AssistantChart | null } | null>(null);

export function useGuide() {
  const value = useContext(GuideContext);
  if (!value) throw new Error("O guia da IA só pode ser aberto dentro do aplicativo.");
  return value;
}

const WELCOME = "Pode escrever do seu jeito. Eu entendo a frase, olho se a conta, a categoria ou o lançamento existe aqui e, se achar, lanço para você. Também digo quanto você tem, quanto deve, o que falta e quanto sobra.";
const GROUP_WELCOME = "Aqui eu olho as contas de quem aceitou o grupo. Pergunte quanto vocês têm, quanto devem, o que falta e quanto sobra. Cada pessoa continua lançando na própria conta.";

const GROUP_ACTIONS: Array<{ label: string; text: string; kind: "ask" }> = [
  { label: "Quanto temos?", text: "Quanto dinheiro temos?", kind: "ask" },
  { label: "Quanto devemos?", text: "Quanto estamos devendo?", kind: "ask" },
  { label: "O que falta?", text: "Quanto ainda vamos receber e pagar?", kind: "ask" },
  { label: "Quanto sobra?", text: "Quanto vai sobrar no fim do mês?", kind: "ask" },
  { label: "Quem gastou?", text: "Quem gastou mais neste mês?", kind: "ask" },
  { label: "Gráficos", text: "Mostra os gráficos do grupo", kind: "ask" },
];

const ACTIONS: Array<{ label: string; text: string; kind: "ask" | "entry" | "account" }> = [
  { label: "Quanto tenho?", text: "Quanto dinheiro tenho?", kind: "ask" },
  { label: "Quanto devo?", text: "Quanto estou devendo?", kind: "ask" },
  { label: "O que falta?", text: "Quanto ainda vou receber e pagar?", kind: "ask" },
  { label: "Quanto sobra?", text: "Quanto vai sobrar no fim do mês?", kind: "ask" },
  { label: "Nova receita", text: "Quero lançar uma receita", kind: "entry" },
  { label: "Nova despesa", text: "Quero lançar uma despesa", kind: "entry" },
  { label: "Conta a pagar", text: "Quero lançar uma conta a pagar", kind: "entry" },
  { label: "Cartões", text: "Como estão os cartões?", kind: "ask" },
  { label: "Gráficos", text: "Mostra os gráficos do mês", kind: "ask" },
  { label: "Nova conta", text: "Quero cadastrar uma conta", kind: "account" },
];

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
  const { data, refresh, loading: financeLoading } = useFinance();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [accountMode, setAccountMode] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusChart, setFocusChart] = useState<AssistantChart | null>(null);
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem("contas-bubble");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        const maxY = window.innerWidth < 1024 ? window.innerHeight - 150 : window.innerHeight - 72;
        return { x: Math.min(parsed.x, window.innerWidth - 72), y: Math.min(parsed.y, maxY) };
      }
    } catch { /* a bolha começa no canto */ }
    return null;
  });
  const bubblePoint = useRef(bubble);
  bubblePoint.current = bubble;
  const drag = useRef<{ offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const location = useLocation();
  const group = location.pathname.startsWith("/conjunto");
  const recognition = useRef<SpeechRecognition | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, notice, open]);

  useEffect(() => () => recognition.current?.stop(), []);

  useEffect(() => {
    let cancel = false;
    void loadAssistantMessages().then((messages) => {
      if (cancel || !messages.length) return;
      const restored = messages.map((message) => {
        const payload = message.payload && typeof message.payload === "object" ? message.payload as { confirmation?: Confirmation | null; chart?: AssistantChart | null; place?: AssistantPlace | null; interview?: InterviewState | null } : {};
        return {
          id: message.id,
          role: message.role,
          content: message.content,
          confirmation: payload.confirmation ?? null,
          chart: payload.chart ?? null,
          place: payload.place ?? null,
        };
      });
      setItems((current) => (current.some((item) => item.role === "user") ? current : restored));
      const last = [...messages].reverse().find((message) => message.role === "assistant");
      const interviewSaved = last?.payload && typeof last.payload === "object" ? (last.payload as { interview?: InterviewState | null }).interview : null;
      if (interviewSaved) setInterview((current) => current ?? interviewSaved);
    }).catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (financeLoading || sessionStorage.getItem("contas-guide-auto")) return;
    if (data.accounts.some((account) => !account.archived)) return;
    sessionStorage.setItem("contas-guide-auto", "1");
    setItems((current) => current.length ? current : [{ id: crypto.randomUUID(), role: "assistant", content: WELCOME, confirmation: null, chart: null, place: null }]);
    setOpen(true);
  }, [data.accounts, financeLoading]);

  function openGuide() {
    const welcome = group ? GROUP_WELCOME : WELCOME;
    setItems((current) => current.length ? current : [{ id: crypto.randomUUID(), role: "assistant", content: welcome, confirmation: null, chart: null, place: null }]);
    setOpen(true);
  }

  function say(content: string) {
    setItems((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content, confirmation: null, chart: null, place: null }]);
  }

  function stopEntry(content: string) {
    setInterview(null);
    setAccountMode(false);
    setItems((current) => [...current, { id: crypto.randomUUID(), role: "user", content, confirmation: null, chart: null, place: null }]);
    say("Parei esse lançamento. Pode perguntar o saldo, a dívida, o que falta ou quanto sobra.");
  }

  async function send(raw?: string, options?: { guide?: "account" | null; interview?: InterviewState | null }) {
    const content = (raw ?? text).trim();
    if (!content || loading) return;
    setText("");
    setNotice(null);
    const guide = options?.guide === null ? undefined : options?.guide ?? (accountMode ? "account" as const : undefined);
    const currentInterview = options && "interview" in options ? options.interview ?? null : interview;
    if ((guide === "account" || currentInterview) && isSkip(content)) {
      stopEntry(content);
      return;
    }
    const history = items.slice(-20).map((item) => ({ role: item.role, content: item.content }));
    setItems((current) => [...current, { id: crypto.randomUUID(), role: "user", content, confirmation: null, chart: null, place: null }]);
    if (!group) void saveAssistantMessage("user", content).catch(() => undefined);
    setLoading(true);
    try {
      const response = await askAssistant({ mode: "interpret", text: content, history, guide: group ? undefined : guide, interview: group ? null : currentInterview, household: group });
      if (response.chart) setFocusChart(response.chart);
      setInterview(response.interview ?? null);
      if (response.saved) await refresh();
      setItems((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: response.reply, confirmation: response.confirmation, chart: response.chart ?? null, place: response.place ?? null }]);
      if (!group) void saveAssistantMessage("assistant", response.reply, { confirmation: response.confirmation, chart: response.chart ?? null, place: response.place ?? null, interview: response.interview ?? null }).catch(() => undefined);
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
      setItems((current) => current.map((item) => item.id === itemId ? { ...item, confirmation: null } : item).concat({ id: crypto.randomUUID(), role: "assistant", content: response.reply, confirmation: null, chart: null, place: response.place ?? null }));
      await refresh();
      setInterview(null);
      setAccountMode(false);
      setNotice("Salvo. O número já entra na visão geral.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  function choose(action: (typeof ACTIONS)[number]) {
    if (action.kind === "ask") {
      setAccountMode(false);
      void send(action.text, { guide: null, interview });
      return;
    }
    if (action.kind === "account") {
      setInterview(null);
      setAccountMode(true);
      void send(action.text, { guide: "account", interview: null });
      return;
    }
    setAccountMode(false);
    setInterview(null);
    void send(action.text, { guide: null, interview: null });
  }

  const accounts = data.accounts;
  const followUps = interview?.amountCents != null && !interview.description
    ? data.categories.filter((category) => category.kind === (interview.kind === "income" ? "income" : "expense")).slice(0, 6).map((category) => category.name)
    : interview?.description && !interview.occurredOn
      ? ["hoje", "ontem"]
      : interview?.occurredOn && !interview.accountId && accounts.length > 1
        ? accounts.map((account) => account.name)
        : [];

  return (
    <GuideContext.Provider value={{ openGuide, focusChart }}>
      {children}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-4">
          <div className="flex h-[100dvh] max-h-[100dvh] w-full flex-col border border-line bg-surface shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-3xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-accent">Assistente</p>
                <h2 className="mt-1 text-lg font-semibold">Chat do Contas</h2>
              </div>
              <button className="rounded-xl border border-line p-2" onClick={() => setOpen(false)} aria-label="Fechar"><X size={16} /></button>
            </div>
            <div ref={listRef} className="min-h-64 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {items.map((item) => (
                <div key={item.id} className={`w-fit max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${item.role === "user" ? "ml-auto bg-accent text-white" : "bg-surface-2"}`}>
                  <p className="whitespace-pre-line">{item.content}</p>
                  {item.chart ? <AnswerChart title={item.chart.title} kind={item.chart.kind} points={item.chart.points} /> : null}
                  {item.place ? <PlaceLink place={item.place} onGo={() => setOpen(false)} /> : null}
                  {item.confirmation ? <ConfirmationCard confirmation={item.confirmation} disabled={loading} confirmLabel="Pode salvar" onDismiss={() => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, confirmation: null } : entry))} onConfirm={(next) => void confirm(item.id, next)} /> : null}
                </div>
              ))}
              {notice ? <p className="rounded-2xl bg-income-soft px-4 py-3 text-sm leading-6 text-income">{notice}</p> : null}
            </div>
            <div className="space-y-3 border-t border-line px-4 py-3 sm:px-5 sm:py-4" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
              <div className="flex flex-wrap gap-2">
                {(followUps.length && !group ? followUps.map((label) => ({ label, text: label, kind: "entry" as const })) : group ? GROUP_ACTIONS : ACTIONS).map((action) => (
                  <button key={action.label} className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium" disabled={loading} type="button" onClick={() => followUps.length ? void send(action.text) : choose(action)}>{action.label}</button>
                ))}
                {interview || accountMode ? <button className="rounded-full border border-line px-3 py-1.5 text-xs text-muted" type="button" onClick={() => stopEntry("só isso")}>Cancelar</button> : null}
              </div>
              <textarea className="w-full rounded-2xl border border-line bg-canvas px-3 py-3 text-sm text-ink outline-none focus:border-accent" rows={2} value={text} placeholder="Escreva do seu jeito. Exemplo: devo 450 de aluguel" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
              <div className="flex gap-2">
                <button className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${listening ? "bg-expense text-white" : "bg-accent text-white"}`} onClick={listen} type="button">
                  {listening ? <Square size={16} /> : <Mic size={16} />}
                  {listening ? "Parar e enviar" : "Falar"}
                </button>
                <Button loading={loading} onClick={() => void send()}>Enviar</Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <button
          className={`attention fixed z-40 grid h-14 w-14 touch-none place-items-center rounded-full bg-accent text-white shadow-2xl sm:h-16 sm:w-16 ${bubble ? "" : "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-4 lg:bottom-5"}`}
          style={bubble ? { left: bubble.x, top: bubble.y } : undefined}
          type="button"
          aria-label="Falar com a IA"
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            drag.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, startX: event.clientX, startY: event.clientY, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current) return;
            if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 6) current.moved = true;
            const bottomLimit = window.innerWidth < 1024 ? 150 : 72;
            const x = Math.min(window.innerWidth - 64, Math.max(8, event.clientX - current.offsetX));
            const y = Math.min(window.innerHeight - bottomLimit, Math.max(8, event.clientY - current.offsetY));
            setBubble({ x, y });
          }}
          onPointerUp={() => {
            const moved = drag.current?.moved ?? false;
            drag.current = null;
            if (bubblePoint.current) localStorage.setItem("contas-bubble", JSON.stringify(bubblePoint.current));
            if (!moved) openGuide();
          }}
        >
          <Sparkles size={22} />
        </button>
      )}
    </GuideContext.Provider>
  );
}
