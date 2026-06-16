-- ════════════════════════════════════════════════════════════
-- FiTrack V4 — Défis de performance (scores hebdomadaires)
-- À exécuter dans : Supabase Dashboard > SQL Editor > New query
-- ════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- RÉSULTATS DES DÉFIS (défi hebdo + défis amis)
-- ─────────────────────────────────────────────
create table if not exists challenge_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_type_id text not null,   -- ex: 'pull_ups_1min', 'plank_hold'
  week_key text not null,            -- format 'YYYY-WW' (année-numéro de semaine)
  score numeric not null,            -- répétitions OU secondes
  friend_code text,                  -- non null si issu d'un défi entre amis
  logged_at timestamptz default now(),
  unique(user_id, challenge_type_id, week_key, coalesce(friend_code, ''))
);

alter table challenge_results enable row level security;

-- Lecture : tout le monde peut voir tous les scores (pour le classement)
create policy "challenge_results_select" on challenge_results for select using (true);
create policy "challenge_results_insert" on challenge_results for insert with check (auth.uid() = user_id);
create policy "challenge_results_update" on challenge_results for update using (auth.uid() = user_id);
create policy "challenge_results_delete" on challenge_results for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- DÉFIS ENTRE AMIS (défi custom partageable)
-- ─────────────────────────────────────────────
create table if not exists friend_challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  challenge_type_id text not null,
  week_key text not null,
  code text unique not null default upper(substring(gen_random_uuid()::text, 1, 6)),
  expires_at timestamptz default now() + interval '7 days',
  created_at timestamptz default now()
);

alter table friend_challenges enable row level security;

create policy "friend_challenges_select" on friend_challenges for select using (true);
create policy "friend_challenges_insert" on friend_challenges for insert with check (auth.uid() = creator_id);
