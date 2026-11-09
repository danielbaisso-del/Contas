import type { AssistantResponse } from "@/domain/assistant";
import { supabase } from "@/services/supabase";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Entre novamente para usar a inteligência artificial.");
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "A IA não conseguiu concluir o pedido.");
  return payload as T;
}

export function askAssistant(body: unknown): Promise<AssistantResponse> {
  return postJson<AssistantResponse>("/api/assistant", body);
}

export function suggestCategories(descriptions: string[]): Promise<{ suggestions: Record<string, string> }> {
  return postJson("/api/categorize", { descriptions });
}
