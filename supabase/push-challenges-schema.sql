-- ════════════════════════════════════════════════════════════
-- FiTrack V4 — Extension du schéma : Push + Défis
-- À exécuter dans : Supabase Dashboard > SQL Editor > New query
-- ════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- PUSH SUBSCRIPTIONS
-- ─────────────────────────────────────────────
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz default now(),
  unique(user_id, endpoint)
);

alter table push_subscriptions enable row level security;

-- L'utilisateur gère uniquement ses propres subscriptions
create policy "push_subs_select" on push_subscriptions for select using (auth.uid() = user_id);
create policy "push_subs_insert" on push_subscriptions for insert with check (auth.uid() = user_id);
create policy "push_subs_delete" on push_subscriptions for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- DÉFIS
-- ─────────────────────────────────────────────
create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  target_sessions int not null default 10,
  duration_days int not null default 30,
  start_date date not null default current_date,
  end_date date,
  code text unique not null default upper(substring(gen_random_uuid()::text, 1, 6)),
  is_public boolean default false,
  created_at timestamptz default now()
);

-- Calculer end_date via trigger (generated always as... non supporté dans toutes les versions)
create or replace function set_challenge_end_date()
returns trigger language plpgsql as $$
begin
  new.end_date := new.start_date + new.duration_days;
  return new;
end;
$$;

create trigger challenge_end_date_trigger
before insert or update on challenges
for each row execute function set_challenge_end_date();

alter table challenges enable row level security;

-- Tout le monde peut voir les défis publics
create policy "challenges_select_public" on challenges for select using (is_public = true or creator_id = auth.uid());
-- Le créateur peut modifier/supprimer
create policy "challenges_insert" on challenges for insert with check (auth.uid() = creator_id);
create policy "challenges_update" on challenges for update using (auth.uid() = creator_id);
create policy "challenges_delete" on challenges for delete using (auth.uid() = creator_id);

-- ─────────────────────────────────────────────
-- PARTICIPANTS AUX DÉFIS
-- ─────────────────────────────────────────────
create table if not exists challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz default now(),
  unique(challenge_id, user_id)
);

alter table challenge_participants enable row level security;

-- Tout participant d'un défi peut voir les autres participants
create policy "participants_select" on challenge_participants for select
  using (
    user_id = auth.uid() or
    challenge_id in (select challenge_id from challenge_participants where user_id = auth.uid())
  );
create policy "participants_insert" on challenge_participants for insert with check (auth.uid() = user_id);
create policy "participants_delete" on challenge_participants for delete using (auth.uid() = user_id);
