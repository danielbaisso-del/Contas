import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { centsToInput, formatBRL, parseMoneyToCents, variationPercent } from "@/lib/money";
import { cx } from "@/lib/utils";

export const fieldClass = "w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20";

export function cxJoin(...parts: Array<string | false | null | undefined>) {
  return cx(...parts);
}

export function Button({ variant = "primary", loading = false, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; loading?: boolean }) {
  const variants = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
    ghost: "text-ink hover:bg-surface-2",
    danger: "bg-expense text-white hover:opacity-90",
  };
  return (
    <button {...props} type={props.type ?? "button"} disabled={props.disabled || loading} className={cx("inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60", variants[variant], className)}>
      {loading ? "Aguarde..." : children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-xs leading-5 text-muted">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldClass, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldClass, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldClass, "min-h-24 resize-y", props.className)} />;
}

export function MoneyText({ cents, tone = "neutral" }: { cents: number; tone?: "neutral" | "income" | "expense" | "auto" }) {
  const resolved = tone === "auto" ? (cents > 0 ? "income" : cents < 0 ? "expense" : "neutral") : tone;
  return <span className={cx("tabular-nums", resolved === "income" && "text-income", resolved === "expense" && "text-expense")}>{formatBRL(cents)}</span>;
}

export function MoneyField({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (value: number | null) => void; hint?: string }) {
  const [text, setText] = useState(value == null ? "" : centsToInput(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value == null ? "" : centsToInput(value));
  }, [focused, value]);
  return (
    <Field label={label} hint={hint}>
      <input
        className={fieldClass}
        inputMode="decimal"
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseMoneyToCents(event.target.value);
          onChange(parsed == null ? null : Math.abs(parsed));
        }}
        onBlur={() => {
          const parsed = parseMoneyToCents(text);
          const positive = parsed == null ? null : Math.abs(parsed);
          onChange(positive);
          setText(positive == null ? "" : centsToInput(positive));
          setFocused(false);
        }}
      />
    </Field>
  );
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={cx("max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-2xl sm:rounded-3xl", wide ? "sm:max-w-3xl" : "sm:max-w-xl")} onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded-full p-1 text-muted hover:bg-surface-2" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm() {
  const [state, setState] = useState<null | { message: string; resolve: (value: boolean) => void }>(null);
  function confirm(message: string) {
    return new Promise<boolean>((resolve) => setState({ message, resolve }));
  }
  function close(value: boolean) {
    state?.resolve(value);
    setState(null);
  }
  const dialog = state ? (
    <Modal title="Confirmar" onClose={() => close(false)}>
      <p className="text-sm leading-6 text-muted">{state.message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => close(false)}>Cancelar</Button>
        <Button variant="danger" onClick={() => close(true)}>Confirmar</Button>
      </div>
    </Modal>
  ) : null;
  return { confirm, dialog };
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{text}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Delta({ current, previous, positiveIsGood = true }: { current: number; previous: number; positiveIsGood?: boolean }) {
  const percent = variationPercent(current, previous);
  if (percent == null) return <p className="text-xs text-muted">Sem base no mês anterior</p>;
  if (percent === 0) return <p className="text-xs text-muted">Igual ao mês anterior</p>;
  const up = percent > 0;
  const good = positiveIsGood ? up : !up;
  return <p className={cx("text-xs font-medium", good ? "text-income" : "text-expense")}>{up ? "▲" : "▼"} {Math.abs(percent)}% em relação ao mês anterior</p>;
}
