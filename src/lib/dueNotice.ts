export async function enableDueNotices(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

export function dueNoticesEnabled(): boolean {
  return "Notification" in window && Notification.permission === "granted";
}

export async function notifyDueToday(items: Array<{ id: string; title: string; amount: string }>, today: string): Promise<void> {
  if (!dueNoticesEnabled() || !items.length) return;
  const key = `contas-avisos-${today}`;
  let seen = new Set<string>();
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    if (Array.isArray(saved)) seen = new Set(saved.filter((item): item is string => typeof item === "string"));
  } catch { /* um aviso antigo inválido não impede o de hoje */ }
  const fresh = items.filter((item) => !seen.has(item.id));
  if (!fresh.length) return;
  const body = fresh.map((item) => `${item.title}: ${item.amount}`).join("\n");
  const title = fresh.length === 1 ? "Conta de hoje" : `${fresh.length} contas hoje`;
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration) await registration.showNotification(title, { body, lang: "pt-BR" });
    else new Notification(title, { body, lang: "pt-BR" });
  } catch {
    new Notification(title, { body, lang: "pt-BR" });
  }
  for (const item of fresh) seen.add(item.id);
  localStorage.setItem(key, JSON.stringify([...seen]));
}
