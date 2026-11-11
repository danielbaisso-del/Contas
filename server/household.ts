import { buildDashboard } from "@/finance/engine";
import { monthKey, todayISO } from "@/lib/dates";
import { normalizeText } from "@/lib/utils";
import { mapAccount, mapCard, mapCategory, mapInvoice, mapRecurrence, mapTransaction } from "@/services/mappers";
import type { Account, CardInvoice, Category, CreditCard, FinanceData, Recurrence, Transaction } from "@/types/models";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, readJson, sendJson, type NodeRequest, type NodeResponse } from "./http";
import { adminClient, requireUser } from "./supabase";

const SETUP = "Falta criar as tabelas do grupo no Supabase. Abra o SQL Editor e rode o arquivo supabase/migrations/002_households.sql.";

interface MemberRow {
  id: string;
  household_id: string;
  user_id: string | null;
  email: string;
  status: "pending" | "accepted" | "declined";
  invited_by: string;
}

export interface HouseholdPart {
  name: string;
  you: boolean;
  data: FinanceData;
}

export interface HouseholdBundle {
  household: { id: string; name: string };
  parts: HouseholdPart[];
  data: FinanceData;
}

function missingTable(message: string): boolean {
  return /household|schema cache|relation|does not exist/i.test(message);
}

function asMembers(rows: unknown): MemberRow[] {
  return (rows as MemberRow[] | null ?? []).map((row) => ({
    id: String(row.id),
    household_id: String(row.household_id),
    user_id: row.user_id ? String(row.user_id) : null,
    email: String(row.email ?? "").toLowerCase(),
    status: row.status,
    invited_by: String(row.invited_by),
  }));
}

async function rowsFor(admin: SupabaseClient, table: string, userIds: string[]): Promise<Record<string, unknown>[]> {
  if (!userIds.length) return [];
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await admin.from(table).select("*").in("user_id", userIds).range(from, from + 999);
    if (error) {
      if (missingTable(error.message)) throw new HttpError(503, SETUP);
      throw new HttpError(500, "Não consegui ler os lançamentos do grupo.");
    }
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return rows;
}

function dataFor(userId: string, packed: {
  accounts: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  cards: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  recurrences: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
}): FinanceData {
  const own = (rows: Record<string, unknown>[]) => rows.filter((row) => String(row.user_id ?? "") === userId);
  return {
    accounts: own(packed.accounts).map(mapAccount),
    categories: own(packed.categories).map(mapCategory),
    cards: own(packed.cards).map(mapCard),
    transactions: own(packed.transactions).map((row) => ({ ...mapTransaction(row), notes: null, externalId: null })),
    recurrences: own(packed.recurrences).map((row) => ({ ...mapRecurrence(row), notes: null })),
    invoices: own(packed.invoices).map(mapInvoice),
    goals: [],
    contributions: [],
  };
}

function mergeParts(parts: HouseholdPart[]): FinanceData {
  const categories: Category[] = [];
  const categoryMap = new Map<string, string>();
  const accounts: Account[] = [];
  const cards: CreditCard[] = [];
  const transactions: Transaction[] = [];
  const recurrences: Recurrence[] = [];
  const invoices: CardInvoice[] = [];

  for (const part of parts) {
    for (const category of part.data.categories) {
      const key = `${category.kind}:${normalizeText(category.name)}`;
      const existing = categories.find((item) => `${item.kind}:${normalizeText(item.name)}` === key);
      const id = existing?.id ?? category.id;
      if (!existing) categories.push({ ...category, id });
      categoryMap.set(category.id, id);
    }
    accounts.push(...part.data.accounts.map((account) => ({ ...account, name: `${part.name} · ${account.name}` })));
    cards.push(...part.data.cards.map((card) => ({ ...card, name: `${part.name} · ${card.name}` })));
    const remap = (id: string | null) => (id ? categoryMap.get(id) ?? id : null);
    transactions.push(...part.data.transactions.map((transaction) => ({ ...transaction, categoryId: remap(transaction.categoryId), notes: null })));
    recurrences.push(...part.data.recurrences.map((recurrence) => ({ ...recurrence, categoryId: remap(recurrence.categoryId), notes: null })));
    invoices.push(...part.data.invoices);
  }

  return { accounts, categories, cards, transactions, recurrences, invoices, goals: [], contributions: [] };
}

async function namesFor(admin: SupabaseClient, members: MemberRow[]): Promise<Map<string, string>> {
  const ids = members.map((member) => member.user_id).filter((id): id is string => Boolean(id));
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const { data, error } = await admin.from("profiles").select("id, full_name").in("id", ids);
  if (error) return names;
  for (const row of data ?? []) names.set(String(row.id), String(row.full_name ?? "").trim());
  return names;
}

function displayName(member: MemberRow, names: Map<string, string>): string {
  const named = member.user_id ? names.get(member.user_id) : "";
  if (named) return named;
  return member.email.split("@")[0] || "Pessoa";
}

async function memberships(admin: SupabaseClient, userId: string, email: string): Promise<MemberRow[]> {
  const [byUser, byEmail] = await Promise.all([
    admin.from("household_members").select("*").eq("user_id", userId),
    admin.from("household_members").select("*").eq("email", email),
  ]);
  const error = byUser.error ?? byEmail.error;
  if (error) {
    if (missingTable(error.message)) throw new HttpError(503, SETUP);
    throw new HttpError(500, "Não consegui ler o grupo.");
  }
  const merged = new Map<string, MemberRow>();
  for (const row of [...asMembers(byUser.data), ...asMembers(byEmail.data)]) merged.set(row.id, row);
  return [...merged.values()];
}

async function findAuthUser(admin: SupabaseClient, email: string): Promise<{ id: string; email: string } | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new HttpError(500, "Não consegui procurar esse e-mail. Confira a chave do servidor.");
    const found = data.users.find((user) => (user.email ?? "").toLowerCase() === email);
    if (found?.email) return { id: found.id, email: found.email.toLowerCase() };
    if (data.users.length < 200) break;
  }
  return null;
}

async function acceptedHousehold(admin: SupabaseClient, userId: string, email: string): Promise<{ householdId: string; members: MemberRow[] } | null> {
  const mine = await memberships(admin, userId, email);
  const accepted = mine.find((member) => member.status === "accepted");
  if (!accepted) return null;
  const { data, error } = await admin.from("household_members").select("*").eq("household_id", accepted.household_id);
  if (error) throw new HttpError(500, "Não consegui ler as pessoas do grupo.");
  return { householdId: accepted.household_id, members: asMembers(data) };
}

export async function householdBundle(userId: string, email: string): Promise<HouseholdBundle | null> {
  const admin = adminClient();
  const group = await acceptedHousehold(admin, userId, email.toLowerCase());
  if (!group) return null;
  const accepted = group.members.filter((member) => member.status === "accepted" && member.user_id);
  const ids = accepted.map((member) => member.user_id as string);
  const [accounts, categories, cards, transactions, recurrences, invoices, names, household] = await Promise.all([
    rowsFor(admin, "accounts", ids),
    rowsFor(admin, "categories", ids),
    rowsFor(admin, "credit_cards", ids),
    rowsFor(admin, "transactions", ids),
    rowsFor(admin, "recurrences", ids),
    rowsFor(admin, "card_invoices", ids),
    namesFor(admin, accepted),
    admin.from("households").select("id, name").eq("id", group.householdId).maybeSingle(),
  ]);
  if (household.error || !household.data) throw new HttpError(500, "Não encontrei o grupo.");
  const packed = { accounts, categories, cards, transactions, recurrences, invoices };
  const parts = accepted.map((member) => ({
    name: displayName(member, names),
    you: member.user_id === userId,
    data: dataFor(member.user_id as string, packed),
  }));
  return {
    household: { id: String(household.data.id), name: String(household.data.name || "Nossas contas") },
    parts,
    data: mergeParts(parts),
  };
}

export async function handleHousehold(req: NodeRequest, res: NodeResponse): Promise<void> {
  try {
    const user = await requireUser(req);
    const email = user.email.toLowerCase();
    const admin = adminClient();
    if (req.method === "GET") {
      const view = new URL(req.url ?? "/", "http://localhost").searchParams.get("view");
      if (view === "finance") {
        const bundle = await householdBundle(user.id, email);
        if (!bundle) throw new HttpError(404, "Aceite um convite para ver os números do grupo.");
        const today = todayISO();
        const month = monthKey(today);
        sendJson(res, 200, {
          household: bundle.household,
          data: bundle.data,
          parts: bundle.parts,
          people: bundle.parts.map((part) => {
            const model = buildDashboard(part.data, month, today);
            return { name: part.name, incomeCents: model.incomeCents, spendingCents: model.spendingCents, pendingCents: model.pendingCents };
          }),
        });
        return;
      }
      const mine = await memberships(admin, user.id, email);
      const accepted = mine.find((member) => member.status === "accepted");
      const householdId = accepted?.household_id ?? null;
      const { data: householdRows, error: householdError } = householdId
        ? await admin.from("households").select("id, name").eq("id", householdId).maybeSingle()
        : { data: null, error: null };
      if (householdError) throw new HttpError(500, "Não consegui ler o grupo.");
      const { data: memberRows, error: memberError } = householdId
        ? await admin.from("household_members").select("*").eq("household_id", householdId)
        : { data: [], error: null };
      if (memberError) throw new HttpError(500, "Não consegui ler as pessoas do grupo.");
      const members = asMembers(memberRows).filter((member) => member.status !== "declined");
      const names = await namesFor(admin, members);
      const invites = mine.filter((member) => member.status === "pending" && member.invited_by !== user.id && (member.user_id === user.id || member.email === email));
      const inviteHouseholds = invites.length
        ? await admin.from("households").select("id, name, created_by").in("id", invites.map((invite) => invite.household_id))
        : { data: [], error: null };
      if (inviteHouseholds.error) throw new HttpError(500, "Não consegui ler o convite.");
      const creators = [...new Set((inviteHouseholds.data ?? []).map((row) => String(row.created_by)))];
      const creatorProfiles = creators.length
        ? await admin.from("profiles").select("id, full_name").in("id", creators)
        : { data: [], error: null };
      const creatorNames = new Map((creatorProfiles.data ?? []).map((row) => [String(row.id), String(row.full_name ?? "")]));
      const creatorEmails = new Map<string, string>();
      if (creators.length) {
        for (let page = 1; page <= 10; page += 1) {
          const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
          if (listed.error) break;
          for (const authUser of listed.data.users) {
            if (authUser.email && creators.includes(authUser.id)) creatorEmails.set(authUser.id, authUser.email);
          }
          if (listed.data.users.length < 200) break;
        }
      }
      sendJson(res, 200, {
        ready: true,
        household: householdRows ? { id: householdRows.id, name: householdRows.name } : null,
        members: members.map((member) => ({
          id: member.id,
          name: displayName(member, names),
          email: member.user_id === user.id ? member.email : member.status === "pending" ? member.email : "",
          status: member.status,
          you: member.user_id === user.id,
        })),
        invites: invites.map((invite) => {
          const household = (inviteHouseholds.data ?? []).find((row) => String(row.id) === invite.household_id);
          const creator = household ? String(household.created_by) : "";
          return {
            id: invite.id,
            householdName: household ? String(household.name) : "Nossas contas",
            fromName: creatorNames.get(creator) || (creatorEmails.get(creator)?.split("@")[0] ?? "Alguém"),
            fromEmail: creatorEmails.get(creator) ?? "",
          };
        }),
      });
      return;
    }
    if (req.method !== "POST") throw new HttpError(405, "Use GET ou POST.");
    const body = await readJson(req);
    const action = String(body.action ?? "");
    if (action === "invite") {
      const targetEmail = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) throw new HttpError(400, "Escreva um e-mail válido.");
      if (targetEmail === email) throw new HttpError(400, "Use o e-mail da outra pessoa, não o seu.");
      const target = await findAuthUser(admin, targetEmail);
      if (!target) throw new HttpError(400, "Essa pessoa ainda não tem cadastro. Peça para ela criar a conta com este e-mail e convide de novo.");
      const targetGroups = await memberships(admin, target.id, target.email);
      if (targetGroups.some((member) => member.status === "accepted")) {
        const mine = await acceptedHousehold(admin, user.id, email);
        if (mine && targetGroups.some((member) => member.status === "accepted" && member.household_id === mine.householdId)) {
          throw new HttpError(400, "Vocês já estão no mesmo grupo.");
        }
        throw new HttpError(400, "Essa pessoa já faz parte de outro grupo.");
      }
      let householdId = (await acceptedHousehold(admin, user.id, email))?.householdId ?? "";
      if (!householdId) {
        const created = await admin.from("households").insert({ name: "Nossas contas", created_by: user.id }).select("id").single();
        if (created.error || !created.data) throw new HttpError(500, "Não consegui criar o grupo.");
        householdId = String(created.data.id);
        const self = await admin.from("household_members").insert({
          household_id: householdId,
          user_id: user.id,
          email,
          status: "accepted",
          invited_by: user.id,
          responded_at: new Date().toISOString(),
        });
        if (self.error) throw new HttpError(500, "Não consegui entrar no grupo.");
      }
      const existing = targetGroups.find((member) => member.household_id === householdId);
      if (existing?.status === "pending") throw new HttpError(400, "O convite já está esperando a resposta.");
      if (existing) {
        const updated = await admin.from("household_members").update({
          status: "pending",
          user_id: target.id,
          invited_by: user.id,
          responded_at: null,
        }).eq("id", existing.id);
        if (updated.error) throw new HttpError(500, "Não consegui reenviar o convite.");
      } else {
        const inserted = await admin.from("household_members").insert({
          household_id: householdId,
          user_id: target.id,
          email: target.email,
          status: "pending",
          invited_by: user.id,
        });
        if (inserted.error) throw new HttpError(500, "Não consegui enviar o convite.");
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (action === "accept" || action === "decline") {
      const id = String(body.id ?? "");
      const { data, error } = await admin.from("household_members").select("*").eq("id", id).maybeSingle();
      if (error || !data) throw new HttpError(404, "Não encontrei esse convite.");
      const invite = asMembers([data])[0];
      if (!invite || invite.status !== "pending") throw new HttpError(400, "Esse convite já foi respondido.");
      if (invite.user_id !== user.id && invite.email !== email) throw new HttpError(403, "Esse convite é de outra pessoa.");
      if (invite.invited_by === user.id) throw new HttpError(400, "Quem enviou o convite não pode aceitar no lugar da outra pessoa.");
      if (action === "accept") {
        const current = await acceptedHousehold(admin, user.id, email);
        if (current && current.householdId !== invite.household_id) throw new HttpError(400, "Você já está em outro grupo. Saia dele antes de aceitar este.");
        const saved = await admin.from("household_members").update({
          status: "accepted",
          user_id: user.id,
          email,
          responded_at: new Date().toISOString(),
        }).eq("id", invite.id);
        if (saved.error) throw new HttpError(500, "Não consegui aceitar o convite.");
      } else {
        const saved = await admin.from("household_members").update({ status: "declined", responded_at: new Date().toISOString() }).eq("id", invite.id);
        if (saved.error) throw new HttpError(500, "Não consegui recusar o convite.");
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (action === "leave") {
      const current = await acceptedHousehold(admin, user.id, email);
      if (!current) throw new HttpError(400, "Você não está em um grupo.");
      const mine = current.members.find((member) => member.user_id === user.id && member.status === "accepted");
      if (!mine) throw new HttpError(400, "Você não está em um grupo.");
      const removed = await admin.from("household_members").delete().eq("id", mine.id);
      if (removed.error) throw new HttpError(500, "Não consegui sair do grupo.");
      const still = current.members.filter((member) => member.id !== mine.id && member.status === "accepted");
      if (!still.length) await admin.from("households").delete().eq("id", current.householdId);
      sendJson(res, 200, { ok: true });
      return;
    }
    throw new HttpError(400, "Não entendi esse pedido do grupo.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Não consegui concluir o grupo.";
    if (!(error instanceof HttpError)) console.error(error);
    sendJson(res, status, { error: message });
  }
}
