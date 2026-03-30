-- Takenos · Supabase Schema
-- Ejecutar en: Supabase Dashboard → SQL Editor

-- ─── Usuarios de Phyllo ──────────────────────────────────────────────────────
-- Guarda el mapeo entre un usuario de Takenos y su user_id en Phyllo.
create table if not exists phyllo_users (
  id            uuid primary key default gen_random_uuid(),
  phyllo_id     text unique not null,       -- user_id devuelto por Phyllo
  name          text not null,
  external_id   text unique not null,       -- tu ID interno (ej: email o UUID propio)
  created_at    timestamptz default now()
);

-- ─── Perfiles de Instagram ───────────────────────────────────────────────────
-- Guarda el último escaneo de Instagram para cada usuario.
create table if not exists instagram_profiles (
  id            uuid primary key default gen_random_uuid(),
  phyllo_user_id text references phyllo_users(phyllo_id) on delete cascade,
  username      text,
  full_name     text,
  bio           text,
  is_verified   boolean default false,
  is_business   boolean default false,
  followers     integer,
  following     integer,
  posts         integer,
  image_url     text,
  profile_url   text,
  scanned_at    timestamptz default now(),

  -- Solo un perfil activo por usuario (upsert por phyllo_user_id)
  unique (phyllo_user_id)
);

-- ─── Historial de escaneos ───────────────────────────────────────────────────
-- Registro de cada vez que se consultaron las métricas de un usuario.
create table if not exists scan_history (
  id            uuid primary key default gen_random_uuid(),
  phyllo_user_id text references phyllo_users(phyllo_id) on delete cascade,
  platform      text default 'instagram',
  followers     integer,
  following     integer,
  posts         integer,
  scanned_at    timestamptz default now()
);

-- ─── Perfiles de TikTok ─────────────────────────────────────────────────────
-- Guarda el último escaneo de TikTok para cada usuario.
create table if not exists tiktok_profiles (
  id            uuid primary key default gen_random_uuid(),
  phyllo_user_id text references phyllo_users(phyllo_id) on delete cascade,
  username      text,
  full_name     text,
  bio           text,
  is_verified   boolean default false,
  is_business   boolean default false,
  followers     integer,
  following     integer,
  posts         integer,
  image_url     text,
  profile_url   text,
  scanned_at    timestamptz default now(),
  unique (phyllo_user_id)
);

-- ─── Row Level Security (recomendado) ────────────────────────────────────────
alter table phyllo_users       enable row level security;
alter table instagram_profiles enable row level security;
alter table tiktok_profiles    enable row level security;
alter table scan_history       enable row level security;

create policy "service role only" on phyllo_users
  using (true) with check (true);

create policy "service role only" on instagram_profiles
  using (true) with check (true);

create policy "service role only" on tiktok_profiles
  using (true) with check (true);

create policy "service role only" on scan_history
  using (true) with check (true);
