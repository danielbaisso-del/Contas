import { addDays } from "@/lib/dates";
import { parseMoneyToCents } from "@/lib/money";
import { parseFlexibleDate } from "@/lib/statements";
import { matchByName, normalizeText } from "@/lib/utils";

const EXPENSE_HINTS: Array<{ category: string; words: string[] }> = [
  { category: "Mercado", words: ["mercado", "supermercado", "feira", "hortifruti"] },
  { category: "Alimentação", words: ["restaurante", "ifood", "lanche", "almoco", "jantar", "padaria", "cafe", "comida"] },
  { category: "Transporte", words: ["uber", "combustivel", "gasolina", "onibus", "metro", "estacionamento"] },
  { category: "Moradia", words: ["aluguel", "condominio"] },
  { category: "Contas da casa", words: ["luz", "energia", "agua", "internet", "telefone"] },
  { category: "Assinaturas", words: ["netflix", "spotify", "assinatura", "mensalidade"] },
  { category: "Saúde", words: ["farmacia", "medico", "hospital", "consulta"] },
  { category: "Lazer", words: ["cinema", "show", "viagem"] },
  { category: "Educação", words: ["curso", "faculdade", "escola", "livro"] },
];

const INCOME_HINTS: Array<{ category: string; words: string[] }> = [
  { category: "Salário", words: ["salario", "holerite"] },
  { category: "Freelance", words: ["freelance", "cliente"] },
];

export function extractExplicitAmounts(text: string): number[] {
  const patterns = [
    /R\$\s*[\d.]+(?:,\d{1,2})?/gi,
    /\b\d{1,3}(?:\.\d{3})+(?:,\d{2})\b/g,
    /\b\d+(?:,\d{2})\s*reais\b/gi,
    /\b\d+(?:[\.,]\d{3})*(?:,\d{2})?\s*reais\b/gi,
  ];
  const found = new Set<number>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const cents = parseMoneyToCents(match[0]);
      if (cents && cents > 0) found.add(cents);
    }
  }
  return [...found];
}

function bareNumbers(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/(?<![\d/.-])(\d{1,7})(?![\d/.-])/g)) {
    found.add(Number(match[1]));
  }
  return [...found];
}

export function resolveAmountCents(text: string, modelValue: number | null | undefined): number | null {
  const extracted = extractExplicitAmounts(text);
  if (extracted.length === 1) return extracted[0] ?? null;
  if (modelValue == null || !Number.isFinite(modelValue) || modelValue <= 0) return null;
  let cents = Number.isInteger(modelValue) ? Math.round(modelValue) : Math.round(modelValue * 100);
  if (extracted.includes(cents)) return cents;
  if (extracted.length > 1) return null;
  if (!/centavo/i.test(text) && bareNumbers(text).includes(cents) && cents < 10_000_000) cents *= 100;
  return cents > 0 ? cents : null;
}

export function resolveOccurredOn(text: string, today: string, modelDate?: string | null): { date: string; assumed: boolean } {
  const lower = normalizeText(text);
  if (/\bhoje\b/.test(lower)) return { date: today, assumed: false };
  if (/\bontem\b/.test(lower)) return { date: addDays(today, -1), assumed: false };
  if (/\bamanha\b/.test(lower)) return { date: addDays(today, 1), assumed: false };
  const numeric = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (numeric) {
    const source = numeric[3] ? numeric[0] : `${numeric[1]}/${numeric[2]}/${today.slice(0, 4)}`;
    const parsed = parseFlexibleDate(source);
    if (parsed) return { date: parsed, assumed: false };
  }
  const dayOnly = lower.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOnly) {
    const parsed = parseFlexibleDate(`${dayOnly[1]}/${today.slice(5, 7)}/${today.slice(0, 4)}`);
    if (parsed) return { date: parsed, assumed: false };
  }
  if (modelDate && /^\d{4}-\d{2}-\d{2}$/.test(modelDate)) return { date: modelDate, assumed: false };
  return { date: today, assumed: true };
}

export function suggestCategory<T extends { name: string; kind: string }>(
  text: string,
  categories: T[],
  type: "income" | "expense",
  modelName?: string | null,
): T | null {
  const matchedModel = matchByName(categories.filter((category) => category.kind === type), modelName);
  if (matchedModel) return matchedModel;
  const normalized = normalizeText(text);
  const hints = type === "income" ? INCOME_HINTS : EXPENSE_HINTS;
  const hint = hints.find((item) => item.words.some((word) => normalized.includes(normalizeText(word))));
  if (!hint) return null;
  return matchByName(categories.filter((category) => category.kind === type), hint.category);
}
