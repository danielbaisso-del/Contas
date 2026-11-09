import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envValue, HttpError, readHeader, type NodeRequest } from "./http";

function supabaseUrl(): string {
  return envValue("SUPABASE_URL", "VITE_SUPABASE_URL");
}

function anonKey(): string {
  return envValue("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
}

export async function requireUser(req: NodeRequest): Promise<{ id: string; email: string; token: string }> {
  const header = readHeader(req, "authorization");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Faça login novamente.");
  const url = supabaseUrl();
  const anon = anonKey();
  if (!url || !anon) throw new HttpError(500, "Configure a URL e a chave anon do Supabase no servidor.");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sua sessão expirou. Entre novamente.");
  return { id: data.user.id, email: data.user.email ?? "", token };
}

export function userClient(token: string): SupabaseClient {
  const url = supabaseUrl();
  const anon = anonKey();
  if (!url || !anon) throw new HttpError(500, "Configure a URL e a chave anon do Supabase no servidor.");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function adminClient(): SupabaseClient {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new HttpError(503, "Configure SUPABASE_SERVICE_ROLE_KEY só no servidor. Ela limita o uso da IA e não vai para o navegador.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function consumeAiQuota(userId: string): Promise<void> {
  const admin = adminClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const usage = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  if (usage.error) throw new HttpError(500, "Não consegui verificar o limite de uso da IA.");
  if ((usage.count ?? 0) >= 30) {
    throw new HttpError(429, "Você chegou a 30 pedidos de IA nesta hora. Esse limite protege a cota gratuita.");
  }
  const inserted = await admin.from("ai_usage").insert({ user_id: userId });
  if (inserted.error) throw new HttpError(500, "Não consegui registrar o uso da IA.");
}
