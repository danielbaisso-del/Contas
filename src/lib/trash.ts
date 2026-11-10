export const TRASH_MARK = "[[lixeira]]";

export function isTrashed(notes: string | null | undefined): boolean {
  return (notes ?? "").startsWith(TRASH_MARK);
}

export function trashNotes(notes: string | null | undefined): string {
  if (isTrashed(notes)) return notes?.trim() || TRASH_MARK;
  const rest = notes?.trim() ?? "";
  return rest ? `${TRASH_MARK} ${rest}` : TRASH_MARK;
}

export function restoreNotes(notes: string | null | undefined): string | null {
  const cleaned = (notes ?? "").replace(/^\[\[lixeira\]\]\s?/, "").trim();
  return cleaned || null;
}

export function trashAccountName(name: string): string {
  const clean = name.trim();
  return clean.startsWith(`${TRASH_MARK} `) ? clean : `${TRASH_MARK} ${clean}`;
}

export function isTrashedAccount(account: { name: string; archived: boolean }): boolean {
  return account.archived && account.name.startsWith(`${TRASH_MARK} `);
}

export function visibleAccountName(name: string): string {
  return name.replace(/^\[\[lixeira\]\]\s*/, "").trim();
}
