-- ════════════════════════════════════════════════════════════
-- FiTrack V4 - Schéma de base de données Supabase
--
-- À exécuter dans : Supabase Dashboard > SQL Editor > New query
--
-- Principe de sécurité : chaque table a une colonne user_id qui
-- référence l'utilisateur connecté (auth.users). Les "policies"
-- RLS (Row Level Security) garantissent qu'un utilisateur ne peut
-- lire/modifier QUE ses propres lignes.
-- ════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. PROFILS (infos onboarding : silhouette, activité, objectif...)
-- ─────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  age int,
  sex text,
  height numeric,
  weight numeric,
  body_fat numeric,
  activity_level text,
  goal text,
  preferred_exercises jsonb default '[]',
  sessions_per_week int,
  session_duration int,
  goal_weeks int,
  level text,
  equip text,
  injuries jsonb,
  program jsonb,
  onboarding_done boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can view their own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can insert their own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update using (auth.uid() = id);


-- ─────────────────────────────────────────────
-- 2. SÉANCES (logger : exercices, sets, reps, poids, durée)
-- ─────────────────────────────────────────────
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  duration_seconds int,
  exercises jsonb not null default '[]',
  created_at timestamptz default now()
);

alter table sessions enable row level security;

create policy "Users can manage their own sessions"
  on sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- 3. RECORDS PERSONNELS (PR)
-- ─────────────────────────────────────────────
create table personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise text not null,
  muscle_group text,
  weight numeric not null,
  reps int not null,
  date date not null default current_date,
  created_at timestamptz default now()
);

alter table personal_records enable row level security;

create policy "Users can manage their own PRs"
  on personal_records for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- 4. POIDS & MENSURATIONS (suivi dans le temps)
-- ─────────────────────────────────────────────
create table body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  weight numeric,
  waist numeric,
  chest numeric,
  hips numeric,
  arms numeric,
  thighs numeric,
  created_at timestamptz default now()
);

alter table body_measurements enable row level security;

create policy "Users can manage their own measurements"
  on body_measurements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- 5. STREAK (série de jours consécutifs)
-- ─────────────────────────────────────────────
create table streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_count int not null default 0,
  best_count int not null default 0,
  last_active_date date,
  updated_at timestamptz default now()
);

alter table streaks enable row level security;

create policy "Users can manage their own streak"
  on streaks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- 6. BADGES (gamification)
-- ─────────────────────────────────────────────
create table badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_key text not null,
  unlocked_at timestamptz default now(),
  unique (user_id, badge_key)
);

alter table badges enable row level security;

create policy "Users can manage their own badges"
  on badges for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────
-- MIGRATION : programmation hebdomadaire (à exécuter si la table
-- "profiles" existe déjà depuis l'étape 2 — ajoute les nouvelles
-- colonnes sans rien supprimer)
-- ─────────────────────────────────────────────
alter table profiles add column if not exists sessions_per_week int;
alter table profiles add column if not exists session_duration int;
alter table profiles add column if not exists goal_weeks int;
alter table profiles add column if not exists program jsonb;

-- ─────────────────────────────────────────────
-- MIGRATION : profil sportif (niveau, matériel, blessures)
-- ─────────────────────────────────────────────
alter table profiles add column if not exists level text;
alter table profiles add column if not exists equip text;
alter table profiles add column if not exists injuries jsonb;

-- ─────────────────────────────────────────────
-- MIGRATION : ajustement calorique adaptatif
-- ─────────────────────────────────────────────
alter table profiles add column if not exists cal_adjustment numeric default 0;
