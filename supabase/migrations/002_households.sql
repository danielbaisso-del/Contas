-- Grupos para casais ou mais pessoas. O navegador não lê estas tabelas.
-- Só a API do servidor, com a chave service_role, cria o convite e lê os números
-- depois que a outra pessoa aceita.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Nossas contas',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  email text not null,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists household_members_unique_email
  on public.household_members (household_id, email);

create index if not exists household_members_user_idx
  on public.household_members (user_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

revoke all on public.households from anon, authenticated;
revoke all on public.household_members from anon, authenticated;
