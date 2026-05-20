-- ============================================================
--  Дневник здоровья — настройка Supabase
--  Вставь весь этот файл в SQL Editor проекта Supabase и нажми Run.
--  Скрипт можно запускать повторно — он не ломает существующие данные.
-- ============================================================

-- ---------- Таблица записей дневника ----------
create table if not exists public.entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date            date not null,
  wake_time       text default '',
  glucose_morning numeric,
  breakfast       text default '',
  lunch           text default '',
  dinner          text default '',
  snacks          text default '',
  medications     text default '',
  workout         text default '',
  bed_time        text default '',
  notes           text default '',
  hrv_screenshot  text default '',
  saved_at        timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.entries enable row level security;

-- ---------- Политики доступа к записям (каждый видит только свои) ----------
drop policy if exists "entries_select" on public.entries;
create policy "entries_select" on public.entries
  for select using (auth.uid() = user_id);

drop policy if exists "entries_insert" on public.entries;
create policy "entries_insert" on public.entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "entries_update" on public.entries;
create policy "entries_update" on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "entries_delete" on public.entries;
create policy "entries_delete" on public.entries
  for delete using (auth.uid() = user_id);

-- ---------- Хранилище для скриншотов ВСР ----------
insert into storage.buckets (id, name, public)
values ('hrv', 'hrv', false)
on conflict (id) do nothing;

-- ---------- Политики хранилища (каждый работает только со своей папкой) ----------
drop policy if exists "hrv_select" on storage.objects;
create policy "hrv_select" on storage.objects
  for select using (
    bucket_id = 'hrv' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "hrv_insert" on storage.objects;
create policy "hrv_insert" on storage.objects
  for insert with check (
    bucket_id = 'hrv' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "hrv_update" on storage.objects;
create policy "hrv_update" on storage.objects
  for update using (
    bucket_id = 'hrv' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "hrv_delete" on storage.objects;
create policy "hrv_delete" on storage.objects
  for delete using (
    bucket_id = 'hrv' and (storage.foldername(name))[1] = auth.uid()::text
  );
