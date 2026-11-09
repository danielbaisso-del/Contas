export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function matchByName<T extends { name: string }>(items: T[], name: string | null | undefined): T | null {
  if (!name?.trim()) return null;
  const target = normalizeText(name);
  return (
    items.find((item) => normalizeText(item.name) === target) ??
    items.find((item) => {
      const current = normalizeText(item.name);
      return current.includes(target) || target.includes(current);
    }) ??
    null
  );
}

export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function errorMessage(error: unknown, fallback = "Não foi possível concluir a operação."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export function friendlyDbError(error: unknown): string {
  const message = errorMessage(error, "");
  if (/relation .* does not exist|schema cache|42P01/i.test(message)) {
    return "O banco ainda não foi preparado. Abra o SQL Editor do Supabase e execute o arquivo supabase/migrations/001_initial.sql.";
  }
  if (/duplicate key|unique/i.test(message)) {
    return "Esse registro entra em conflito com outro que já existe.";
  }
  if (/row-level security|permission denied|JWT/i.test(message)) {
    return "Você não tem permissão para alterar esse dado. Entre novamente se a sessão expirou.";
  }
  if (/violates foreign key/i.test(message)) {
    return "Esse item está ligado a outros lançamentos. Arquive-o ou remova os vínculos antes de excluir.";
  }
  return message || "Não foi possível concluir a operação.";
}
