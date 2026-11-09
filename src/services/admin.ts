import { supabase } from "@/services/supabase";

export interface AdminAccount {
  name: string;
  institution: string;
  type: string;
  balanceCents: number;
  archived: boolean;
}

export interface AdminCard {
  name: string;
  bank: string;
  limitCents: number;
  committedCents: number;
  archived: boolean;
}

export interface AdminMovement {
  description: string;
  amountCents: number;
  type: string;
  status: string;
  occurredOn: string;
}

export interface Signup {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastSignInAt: string | null;
  balanceCents: number;
  incomeCents: number;
  spendingCents: number;
  pendingCents: number;
  openInvoicesCents: number;
  projectedEndCents: number;
  accounts: AdminAccount[];
  cards: AdminCard[];
  recent: AdminMovement[];
}

async function adminFetch(path: string): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Entre novamente para ver os cadastros.");
  return fetch(path, { headers: { Authorization: `Bearer ${token}` } });
}

export async function checkAdmin(): Promise<boolean> {
  const response = await adminFetch("/api/admin?probe=1");
  return response.ok;
}

export async function loadSignups(): Promise<Signup[]> {
  const response = await adminFetch("/api/admin");
  const payload = (await response.json().catch(() => ({}))) as { error?: string; users?: Signup[] };
  if (!response.ok) throw new Error(payload.error || "Não consegui carregar os cadastros.");
  return payload.users ?? [];
}
