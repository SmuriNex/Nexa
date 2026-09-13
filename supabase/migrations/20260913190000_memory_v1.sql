-- Memory V1 stores only explicit, user-owned text memories.
-- No embeddings, vector search, automatic extraction, or privileged client path.
begin;

create table public.memories (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  scope text not null check (scope in ('global', 'app')),
  app text,
  category text not null check (category in ('preference', 'fact', 'instruction')),
  source text not null default 'user_explicit'
    check (source in ('user_explicit', 'app_context', 'system')),
  content text not null check (
    content = pg_catalog.btrim(content)
    and pg_catalog.length(content) between 1 and 2000
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint memories_scope_app_check check (
    (scope = 'global' and app is null)
    or (
      scope = 'app'
      and app is not null
      and app in ('nexa', 'ascent', 'erp')
    )
  )
);

create index memories_user_updated_idx
  on public.memories (user_id, updated_at desc, id desc);

alter table public.memories enable row level security;

-- Supabase may apply broad defaults to new public objects. Memory V1 exposes
-- only the columns required for explicit CRUD by the authenticated owner.
revoke all on public.memories from public, anon, authenticated, service_role;
grant select, delete on public.memories to authenticated;
grant insert (scope, app, category, content) on public.memories to authenticated;
grant update (scope, app, category, content) on public.memories to authenticated;

create policy memories_select_own on public.memories
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy memories_insert_own_explicit on public.memories
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and source = 'user_explicit'
  );

create policy memories_update_own_explicit on public.memories
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and source = 'user_explicit'
  )
  with check (
    user_id = (select auth.uid())
    and source = 'user_explicit'
  );

create policy memories_delete_own on public.memories
  for delete to authenticated
  using (user_id = (select auth.uid()));

create function nexa_private.touch_memory()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.source is distinct from old.source
    or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '23514',
      message = 'A identidade, a origem e a criacao da memoria sao imutaveis.';
  end if;

  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger memories_touch_updated_at
before update on public.memories
for each row execute function nexa_private.touch_memory();

revoke all on function nexa_private.touch_memory()
  from public, anon, authenticated, service_role;

commit;
