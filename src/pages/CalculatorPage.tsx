import { useState } from "react";
import { cx } from "@/lib/utils";

function parse(value: string): number {
  const number = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function show(value: number): string {
  const text = String(value);
  if (!Number.isFinite(value)) return "Erro";
  return text.includes("e") ? value.toLocaleString("pt-BR") : text.replace(".", ",");
}

export function CalculatorPage() {
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);

  function typeDigit(digit: string) {
    if (fresh || display === "0") {
      setDisplay(digit === "," ? "0," : digit);
      setFresh(false);
      return;
    }
    if (digit === "," && display.includes(",")) return;
    setDisplay(`${display}${digit}`);
  }

  function operate(next: string) {
    const current = parse(display);
    const result = stored == null || !operator || fresh ? current : calculate(stored, current, operator);
    setStored(result);
    setDisplay(show(result));
    setOperator(next);
    setFresh(true);
  }

  function equals() {
    if (stored == null || !operator) return;
    const result = calculate(stored, parse(display), operator);
    setDisplay(show(result));
    setStored(null);
    setOperator(null);
    setFresh(true);
  }

  function clear() {
    setDisplay("0");
    setStored(null);
    setOperator(null);
    setFresh(false);
  }

  const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ",", "=", "+"];

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Calculadora</h1>
      <div className="rounded-3xl border border-line bg-surface p-4">
        <p className="min-h-16 break-all text-right text-4xl font-semibold tabular-nums">{display}</p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          <button className="col-span-4 rounded-2xl bg-surface-2 py-3 text-sm font-medium" onClick={clear} type="button">Limpar</button>
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              className={cx("rounded-2xl py-4 text-lg font-medium", key === "=" ? "bg-accent text-white" : "+−×÷".includes(key) ? "bg-surface-2" : "border border-line")}
              onClick={() => {
                if (key === "=") equals();
                else if ("+−×÷".includes(key)) operate(key);
                else typeDigit(key);
              }}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function calculate(left: number, right: number, operator: string): number {
  if (operator === "+") return left + right;
  if (operator === "−") return left - right;
  if (operator === "×") return left * right;
  if (operator === "÷") return right === 0 ? Number.NaN : left / right;
  return right;
}
