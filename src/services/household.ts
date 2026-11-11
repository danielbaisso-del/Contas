import type { FinanceData } from "@/types/models";
import { supabase } from "@/services/supabase";

export interface HouseholdMemberView {
  id: string;
  name: string;
  email: string;
  status: "pending" | "accepted" | "declined";
  you: boolean;
}

export interface HouseholdInvite {
  id: string;
  householdName: string;
  fromName: string;
  fromEmail: string;
}

export interface HouseholdSummary {
  ready: boolean;
  household: { id: string; name: string } | null;
  members: HouseholdMemberView[];
  invites: HouseholdInvite[];
}

export interface HouseholdPart {
  name: string;
  you?: boolean;
  data: FinanceData;
}

export interface HouseholdFinance {
  household: { id: string; name: string };
  data: FinanceData;
  parts: HouseholdPart[];
}

async function call<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Entre novamente para usar o grupo.");
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let payload: { error?: string } = {};
  try {
    payload = raw ? (JSON.parse(raw) as { error?: string }) : {};
  } catch {
    throw new Error("Não consegui falar com o grupo. Publique de novo e confira as chaves do Supabase no servidor.");
  }
  if (!response.ok) throw new Error(payload.error || "Não consegui concluir o grupo.");
  return payload as T;
}

export function loadHousehold(): Promise<HouseholdSummary> {
  return call("/api/household", "GET");
}

export function loadHouseholdFinance(): Promise<HouseholdFinance> {
  return call("/api/household?view=finance", "GET");
}

export function invitePartner(email: string): Promise<{ ok: boolean }> {
  return call("/api/household", "POST", { action: "invite", email });
}

export function respondInvite(id: string, action: "accept" | "decline"): Promise<{ ok: boolean }> {
  return call("/api/household", "POST", { action, id });
}

export function leaveHousehold(): Promise<{ ok: boolean }> {
  return call("/api/household", "POST", { action: "leave" });
}
