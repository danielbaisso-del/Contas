import { parseMoneyToCents } from "@/lib/money";

export interface ParsedMovement {
  occurredOn: string;
  description: string;
  amountCents: number;
  type: "income" | "expense";
  externalId: string | null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseFlexibleDate(value: string): string | null {
  const text = value.trim();
  const br = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (br) {
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    return isoFromParts(year, Number(br[2]), Number(br[1]));
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return isoFromParts(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  return null;
}

function parseBankAmount(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || text.includes("-");
  const cents = parseMoneyToCents(text.replace(/[()]/g, ""));
  if (cents == null) return null;
  const absolute = Math.abs(cents);
  return negative ? -absolute : absolute;
}

function detectSeparator(headerLine: string): "," | ";" | "\t" {
  const scores = [
    { sep: ";" as const, count: headerLine.split(";").length },
    { sep: "," as const, count: headerLine.split(",").length },
    { sep: "\t" as const, count: headerLine.split("\t").length },
  ];
  scores.sort((a, b) => b.count - a.count);
  return scores[0]?.sep ?? ";";
}

export function parseDelimited(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "").trim();
  if (!source) return [];
  const firstLine = source.split(/\r?\n/)[0] ?? "";
  const separator = detectSeparator(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === separator) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], names: string[]): number {
  const normalized = headers.map((header) =>
    header
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase(),
  );
  return normalized.findIndex((header) => names.some((name) => header.includes(name)));
}

export function parseCsvStatement(text: string): ParsedMovement[] {
  const rows = parseDelimited(text);
  if (rows.length === 0) return [];
  const headers = rows[0] ?? [];
  const dateIndex = headerIndex(headers, ["data", "date", "dtposted"]);
  const descriptionIndex = headerIndex(headers, ["descricao", "historico", "memo", "lancamento", "description"]);
  const amountIndex = headerIndex(headers, ["valor", "amount", "quantia"]);
  const debitIndex = headerIndex(headers, ["debito", "saida"]);
  const creditIndex = headerIndex(headers, ["credito", "entrada"]);
  const typeIndex = headerIndex(headers, ["tipo", "trn"]);
  const hasHeader = dateIndex >= 0;
  const body = hasHeader ? rows.slice(1) : rows;

  return body.flatMap((columns) => {
    const occurredOn = parseFlexibleDate(columns[hasHeader ? dateIndex : 0] ?? "");
    const description = (columns[hasHeader ? descriptionIndex : 1] ?? "").trim();
    if (!occurredOn || !description) return [];

    let signed: number | null = null;
    if (hasHeader && debitIndex >= 0) {
      const debit = parseBankAmount(columns[debitIndex] ?? "");
      const credit = creditIndex >= 0 ? parseBankAmount(columns[creditIndex] ?? "") : null;
      if (debit && debit !== 0) signed = -Math.abs(debit);
      else if (credit && credit !== 0) signed = Math.abs(credit);
    }
    if (signed == null) {
      signed = parseBankAmount(columns[hasHeader ? amountIndex : 2] ?? "");
    }
    if (signed == null || signed === 0) return [];

    const typeText = (typeIndex >= 0 ? columns[typeIndex] : "")?.toLowerCase() ?? "";
    let type: "income" | "expense" = signed < 0 ? "expense" : "income";
    if (typeText.startsWith("d") || typeText.includes("debit") || typeText.includes("saida")) type = "expense";
    if (typeText.startsWith("c") || typeText.includes("credit") || typeText.includes("entrada")) type = "income";

    return [{ occurredOn, description, amountCents: Math.abs(signed), type, externalId: null }];
  });
}

function tagValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

export function parseOfxStatement(text: string): ParsedMovement[] {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTTRNRS>)/gi) ?? [];
  return blocks.flatMap((block) => {
    const occurredOn = parseFlexibleDate(tagValue(block, "DTPOSTED"));
    const description = tagValue(block, "MEMO") || tagValue(block, "NAME") || "Lançamento do extrato";
    const amount = Number(tagValue(block, "TRNAMT").replace(",", "."));
    if (!occurredOn || !Number.isFinite(amount) || amount === 0) return [];
    const kind = tagValue(block, "TRNTYPE").toUpperCase();
    const type = kind === "CREDIT" || amount > 0 ? "income" : "expense";
    return [{
      occurredOn,
      description,
      amountCents: Math.round(Math.abs(amount) * 100),
      type: kind === "DEBIT" ? "expense" : type,
      externalId: tagValue(block, "FITID") || null,
    }];
  });
}
