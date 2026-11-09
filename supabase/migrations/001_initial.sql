-- Contas: estrutura inicial do banco.
-- Execute este arquivo inteiro no SQL Editor do Supabase, uma vez.
-- Ele cria tabelas, protege os dados de cada pessoa e prepara as categorias padrão.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income', 'expense')),
  color text not null default '#1d4ed8',
  created_at timestamptz not null default now(),
  unique (user_id, name, kind)
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  institution text not null default '',
  type text not null check (type in ('checking', 'savings', 'cash', 'digital', 'other')),
  initial_balance_cents bigint not null default 0,
  color text not null default '#1d4ed8',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  bank text not null default '',
  limit_cents bigint not null check (limit_cents >= 0),
  closing_day integer not null check (closing_day between 1 and 31),
  due_day integer not null check (due_day between 1 and 31),
  color text not null default '#7c3aed',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.card_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credit_card_id uuid not null references public.credit_cards (id) on delete cascade,
  reference_month date not null,
  closing_on date not null,
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'paid')),
  paid_on date,
  payment_account_id uuid references public.accounts (id),
  payment_transaction_id uuid,
  unique (credit_card_id, reference_month)
);

create table if not exists public.recurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  type text not null check (type in ('income', 'expense')),
  category_id uuid references public.categories (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  credit_card_id uuid references public.credit_cards (id) on delete set null,
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  interval integer not null default 1 check (interval > 0),
  start_on date not null,
  end_on date,
  day_of_month integer check (day_of_month between 1 and 31),
  payment_method text,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  type text not null check (type in ('income', 'expense', 'transfer', 'invoice_payment')),
  category_id uuid references public.categories (id) on delete set null,
  account_id uuid references public.accounts (id),
  destination_account_id uuid references public.accounts (id),
  credit_card_id uuid references public.credit_cards (id),
  occurred_on date not null,
  due_on date,
  status text not null check (status in ('planned', 'pending', 'paid', 'received')),
  payment_method text,
  notes text,
  recurrence_id uuid references public.recurrences (id) on delete set null,
  installment_group_id uuid,
  installment_number integer,
  installment_total integer,
  invoice_id uuid references public.card_invoices (id) on delete set null,
  purchased_on date,
  external_id text,
  created_at timestamptz not null default now(),
  constraint transfer_needs_destination check (type <> 'transfer' or destination_account_id is not null),
  constraint transfer_accounts_differ check (destination_account_id is null or destination_account_id <> account_id),
  constraint card_purchase_is_not_bank_expense check (type <> 'expense' or credit_card_id is null or account_id is null)
);

alter table public.card_invoices
  drop constraint if exists card_invoices_payment_transaction_id_fkey;
alter table public.card_invoices
  add constraint card_invoices_payment_transaction_id_fkey
  foreign key (payment_transaction_id) references public.transactions (id) on delete set null;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target_cents bigint not null check (target_cents > 0),
  saved_cents bigint not null default 0 check (saved_cents >= 0),
  deadline date,
  monthly_contribution_cents bigint not null default 0 check (monthly_contribution_cents >= 0),
  color text not null default '#0f766e',
  created_at timestamptz not null default now()
);

create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  contributed_on date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, occurred_on desc);
create index if not exists transactions_invoice_idx on public.transactions (invoice_id);
create unique index if not exists transactions_external_uidx on public.transactions (user_id, external_id) where external_id is not null;
create unique index if not exists transactions_recurrence_uidx on public.transactions (recurrence_id, occurred_on) where recurrence_id is not null;
create index if not exists ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  insert into public.categories (user_id, name, kind, color)
  values
    (new.id, 'Salário', 'income', '#0f766e'),
    (new.id, 'Freelance', 'income', '#0369a1'),
    (new.id, 'Outras receitas', 'income', '#334155'),
    (new.id, 'Alimentação', 'expense', '#b45309'),
    (new.id, 'Mercado', 'expense', '#15803d'),
    (new.id, 'Moradia', 'expense', '#1d4ed8'),
    (new.id, 'Contas da casa', 'expense', '#7c3aed'),
    (new.id, 'Transporte', 'expense', '#0369a1'),
    (new.id, 'Saúde', 'expense', '#be123c'),
    (new.id, 'Educação', 'expense', '#1d4ed8'),
    (new.id, 'Lazer', 'expense', '#7c3aed'),
    (new.id, 'Assinaturas', 'expense', '#b45309'),
    (new.id, 'Compras', 'expense', '#334155'),
    (new.id, 'Outros', 'expense', '#64748b')
  on conflict (user_id, name, kind) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_card_purchase(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_group uuid := gen_random_uuid();
  v_card uuid;
  v_item jsonb;
  v_invoice uuid;
  v_desc text;
  v_cat uuid;
  v_notes text;
  v_purchased date;
  v_count integer;
  v_amount bigint;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.';
  end if;

  v_card := (p_payload->>'credit_card_id')::uuid;
  v_desc := btrim(coalesce(p_payload->>'description', ''));
  v_cat := nullif(p_payload->>'category_id', '')::uuid;
  v_notes := nullif(p_payload->>'notes', '');
  v_purchased := (p_payload->>'purchased_on')::date;

  if char_length(v_desc) < 2 then
    raise exception 'Informe uma descrição.';
  end if;
  if v_purchased is null then
    raise exception 'Informe a data da compra.';
  end if;
  if not exists (select 1 from public.credit_cards where id = v_card and user_id = v_uid and archived = false) then
    raise exception 'Cartão inválido.';
  end if;
  if v_cat is not null and not exists (select 1 from public.categories where id = v_cat and user_id = v_uid) then
    raise exception 'Categoria inválida.';
  end if;

  v_count := jsonb_array_length(p_payload->'installments');
  if v_count is null or v_count < 1 or v_count > 48 then
    raise exception 'A quantidade de parcelas precisa ficar entre 1 e 48.';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload->'installments')
  loop
    v_amount := (v_item->>'amount_cents')::bigint;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Parcela com valor inválido.';
    end if;

    insert into public.card_invoices (user_id, credit_card_id, reference_month, closing_on, due_on, status)
    values (
      v_uid,
      v_card,
      (v_item->>'reference_month')::date,
      (v_item->>'closing_on')::date,
      (v_item->>'due_on')::date,
      'open'
    )
    on conflict (credit_card_id, reference_month) do nothing;

    select id into v_invoice
    from public.card_invoices
    where credit_card_id = v_card
      and reference_month = (v_item->>'reference_month')::date;

    if v_invoice is null then
      raise exception 'Não foi possível preparar a fatura.';
    end if;
    if exists (
      select 1 from public.card_invoices
      where id = v_invoice and status = 'paid'
    ) then
      raise exception 'A fatura desse mês já está paga. Desfaça o pagamento antes de incluir uma compra nela.';
    end if;

    insert into public.transactions (
      user_id, description, amount_cents, type, category_id, credit_card_id,
      occurred_on, due_on, status, payment_method, notes,
      installment_group_id, installment_number, installment_total, invoice_id, purchased_on
    ) values (
      v_uid,
      case when v_count = 1 then v_desc else v_desc || ' (' || (v_item->>'number') || '/' || v_count || ')' end,
      v_amount,
      'expense',
      v_cat,
      v_card,
      (v_item->>'occurred_on')::date,
      (v_item->>'due_on')::date,
      'pending',
      'credit',
      v_notes,
      v_group,
      (v_item->>'number')::int,
      v_count,
      v_invoice,
      v_purchased
    );
  end loop;

  return v_group;
end;
$$;

create or replace function public.pay_invoice(p_invoice_id uuid, p_account_id uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invoice public.card_invoices%rowtype;
  v_total bigint;
  v_tx uuid;
  v_card_name text;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.';
  end if;

  select * into v_invoice
  from public.card_invoices
  where id = p_invoice_id and user_id = v_uid
  for update;

  if not found then
    raise exception 'Fatura não encontrada.';
  end if;
  if v_invoice.status = 'paid' then
    raise exception 'Essa fatura já está paga.';
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id and user_id = v_uid and archived = false) then
    raise exception 'Escolha uma conta válida para o pagamento.';
  end if;

  select coalesce(sum(amount_cents), 0) into v_total
  from public.transactions
  where invoice_id = p_invoice_id and user_id = v_uid and type = 'expense';

  if v_total <= 0 then
    raise exception 'Essa fatura ainda não tem compras.';
  end if;

  select name into v_card_name from public.credit_cards where id = v_invoice.credit_card_id;

  insert into public.transactions (
    user_id, description, amount_cents, type, account_id, credit_card_id,
    occurred_on, status, payment_method
  ) values (
    v_uid,
    'Pagamento da fatura ' || coalesce(v_card_name, 'do cartão') || ' ' || to_char(v_invoice.reference_month, 'MM/YYYY'),
    v_total,
    'invoice_payment',
    p_account_id,
    v_invoice.credit_card_id,
    p_date,
    'paid',
    'transfer'
  ) returning id into v_tx;

  update public.card_invoices
    set status = 'paid',
        paid_on = p_date,
        payment_account_id = p_account_id,
        payment_transaction_id = v_tx
    where id = p_invoice_id;

  update public.transactions
    set status = 'paid'
    where invoice_id = p_invoice_id and user_id = v_uid and type = 'expense';

  return v_tx;
end;
$$;

create or replace function public.undo_invoice_payment(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invoice public.card_invoices%rowtype;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.';
  end if;

  select * into v_invoice
  from public.card_invoices
  where id = p_invoice_id and user_id = v_uid
  for update;

  if not found then
    raise exception 'Fatura não encontrada.';
  end if;
  if v_invoice.status <> 'paid' then
    raise exception 'Essa fatura não está paga.';
  end if;

  update public.card_invoices
    set status = 'open',
        paid_on = null,
        payment_account_id = null,
        payment_transaction_id = null
    where id = p_invoice_id;

  update public.transactions
    set status = 'pending'
    where invoice_id = p_invoice_id and user_id = v_uid and type = 'expense';

  delete from public.transactions
    where id = v_invoice.payment_transaction_id
      and user_id = v_uid
      and type = 'invoice_payment';
end;
$$;

create or replace function public.add_goal_contribution(
  p_goal_id uuid,
  p_amount bigint,
  p_date date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Informe um valor maior que zero.';
  end if;
  if not exists (select 1 from public.goals where id = p_goal_id and user_id = v_uid) then
    raise exception 'Meta não encontrada.';
  end if;

  insert into public.goal_contributions (user_id, goal_id, amount_cents, contributed_on, notes)
  values (v_uid, p_goal_id, p_amount, p_date, nullif(p_notes, ''))
  returning id into v_id;

  update public.goals
    set saved_cents = saved_cents + p_amount
    where id = p_goal_id and user_id = v_uid;

  return v_id;
end;
$$;

create or replace function public.delete_goal_contribution(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.goal_contributions%rowtype;
begin
  if v_uid is null then
    raise exception 'Faça login para continuar.';
  end if;

  select * into v_row
  from public.goal_contributions
  where id = p_id and user_id = v_uid
  for update;

  if not found then
    raise exception 'Aporte não encontrado.';
  end if;

  update public.goals
    set saved_cents = greatest(0, saved_cents - v_row.amount_cents)
    where id = v_row.goal_id and user_id = v_uid;

  delete from public.goal_contributions where id = p_id and user_id = v_uid;
end;
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.accounts enable row level security;
alter table public.credit_cards enable row level security;
alter table public.card_invoices enable row level security;
alter table public.recurrences enable row level security;
alter table public.transactions enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists categories_own on public.categories;
create policy categories_own on public.categories
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists accounts_own on public.accounts;
create policy accounts_own on public.accounts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists cards_own on public.credit_cards;
create policy cards_own on public.credit_cards
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists invoices_own on public.card_invoices;
create policy invoices_own on public.card_invoices
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists recurrences_own on public.recurrences;
create policy recurrences_own on public.recurrences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists transactions_own on public.transactions;
create policy transactions_own on public.transactions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists goals_own on public.goals;
create policy goals_own on public.goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists contributions_own on public.goal_contributions;
create policy contributions_own on public.goal_contributions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists messages_own on public.assistant_messages;
create policy messages_own on public.assistant_messages
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on function public.create_card_purchase(jsonb) from public;
revoke all on function public.pay_invoice(uuid, uuid, date) from public;
revoke all on function public.undo_invoice_payment(uuid) from public;
revoke all on function public.add_goal_contribution(uuid, bigint, date, text) from public;
revoke all on function public.delete_goal_contribution(uuid) from public;

grant execute on function public.create_card_purchase(jsonb) to authenticated;
grant execute on function public.pay_invoice(uuid, uuid, date) to authenticated;
grant execute on function public.undo_invoice_payment(uuid) to authenticated;
grant execute on function public.add_goal_contribution(uuid, bigint, date, text) to authenticated;
grant execute on function public.delete_goal_contribution(uuid) to authenticated;
