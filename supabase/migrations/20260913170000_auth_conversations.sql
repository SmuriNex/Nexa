-- Auth remains in auth.users. No application profile is required for this phase.
-- All user data is protected by RLS; privileged writes live in a non-exposed schema.
begin;

create schema if not exists nexa_private;
revoke all on schema nexa_private from public, anon;
grant usage on schema nexa_private to authenticated;

create table public.conversations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  app text not null check (app in ('nexa', 'ascent', 'erp')),
  title text not null default 'Nova conversa'
    check (
      pg_catalog.length(title) between 1 and 80
      and pg_catalog.length(pg_catalog.btrim(title)) > 0
    ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc, id desc);

create table public.messages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null
    check (pg_catalog.length(pg_catalog.btrim(content)) > 0)
    check (pg_catalog.length(content) <= 16000)
    check (role <> 'user' or pg_catalog.length(content) <= 4000),
  provider text check (provider is null or pg_catalog.length(provider) between 1 and 64),
  model text check (model is null or pg_catalog.length(model) between 1 and 128),
  request_id text check (request_id is null or pg_catalog.length(request_id) between 1 and 128),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint messages_role_metadata_check check (
    (role = 'user' and provider is null and model is null and request_id is null)
    or (role = 'assistant' and provider is not null and model is not null)
  )
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc, id desc);

-- One active fixed window per user and window size. An alternative window size
-- cannot reset the application's configured window through a direct RPC call.
create table public.rate_limit_windows (
  user_id uuid not null references auth.users (id) on delete cascade,
  window_seconds integer not null check (window_seconds between 1 and 3600),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, window_seconds)
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.rate_limit_windows enable row level security;

-- Remove any broad grants inherited from Supabase's public-schema defaults.
revoke all on public.conversations, public.messages, public.rate_limit_windows from public, anon, authenticated;
grant select, delete on public.conversations to authenticated;
grant insert (id, user_id, app, title) on public.conversations to authenticated;
grant update (title) on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, role, content) on public.messages to authenticated;
-- The rate table deliberately has no client grants or policies.

create policy conversations_select_own on public.conversations
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy conversations_insert_own on public.conversations
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy conversations_update_own on public.conversations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy conversations_delete_own on public.conversations
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy messages_select_own on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- Direct clients may add only their own user messages. Assistant messages are
-- reserved for the atomic server turn RPC, preventing assistant impersonation.
create policy messages_insert_own_user on public.messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.user_id = (select auth.uid())
    )
  );

create function nexa_private.touch_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.app is distinct from old.app
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '23514', message = 'A identidade e o aplicativo da conversa sao imutaveis.';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger conversations_touch_updated_at
before update on public.conversations
for each row execute function nexa_private.touch_conversation();

create function nexa_private.touch_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
  set updated_at = pg_catalog.clock_timestamp()
  where c.id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
after insert on public.messages
for each row execute function nexa_private.touch_conversation_from_message();

create function nexa_private.nexa_append_turn(
  p_user_id uuid,
  p_conversation_id uuid,
  p_create_new boolean,
  p_app text,
  p_user_content text,
  p_assistant_content text,
  p_provider text,
  p_model text,
  p_request_id text
)
returns table (conversation_id uuid, user_message_id uuid, assistant_message_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_owner_id uuid;
  v_app text;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
begin
  if v_user_id is null or auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Operacao privilegiada obrigatoria.';
  end if;

  if p_conversation_id is null or p_create_new is null
    or p_app is null or p_app not in ('nexa', 'ascent', 'erp')
    or p_user_content is null or pg_catalog.length(pg_catalog.btrim(p_user_content)) = 0
    or pg_catalog.length(p_user_content) > 4000
    or p_assistant_content is null or pg_catalog.length(pg_catalog.btrim(p_assistant_content)) = 0
    or pg_catalog.length(p_assistant_content) > 16000
    or p_provider is null or pg_catalog.length(p_provider) not between 1 and 64
    or pg_catalog.length(pg_catalog.btrim(p_provider)) = 0
    or p_model is null or pg_catalog.length(p_model) not between 1 and 128
    or pg_catalog.length(pg_catalog.btrim(p_model)) = 0
    or (p_request_id is not null and pg_catalog.length(p_request_id) not between 1 and 128)
  then
    raise exception using errcode = '22023', message = 'Turno de conversa invalido.';
  end if;

  if p_create_new then
    insert into public.conversations (id, user_id, app, title)
    values (
      p_conversation_id,
      v_user_id,
      p_app,
      pg_catalog.left(pg_catalog.btrim(p_user_content), 80)
    )
    on conflict (id) do nothing;

    if not found then
      raise exception using errcode = '42501', message = 'Conversa indisponivel.';
    end if;
  else
    select c.user_id, c.app into v_owner_id, v_app
    from public.conversations c
    where c.id = p_conversation_id
    for update;

    if not found or v_owner_id is distinct from v_user_id then
      raise exception using errcode = '42501', message = 'Conversa indisponivel.';
    end if;
    if v_app is distinct from p_app then
      raise exception using errcode = '22023', message = 'Aplicativo da conversa nao corresponde a solicitacao.';
    end if;
  end if;

  insert into public.messages (conversation_id, role, content)
  values (p_conversation_id, 'user', p_user_content)
  returning id into v_user_message_id;

  insert into public.messages (
    conversation_id, role, content, provider, model, request_id
  ) values (
    p_conversation_id, 'assistant', p_assistant_content, p_provider, p_model, p_request_id
  ) returning id into v_assistant_message_id;

  return query select p_conversation_id, v_user_message_id, v_assistant_message_id;
end;
$$;

-- Assistant persistence is the one privileged write in this phase. This entry
-- point is callable only by the Edge server role; the implementation receives
-- the user identity already verified by Auth and rechecks ownership and app.
create function public.nexa_append_turn(
  p_user_id uuid,
  p_conversation_id uuid,
  p_create_new boolean,
  p_app text,
  p_user_content text,
  p_assistant_content text,
  p_provider text,
  p_model text,
  p_request_id text
)
returns table (conversation_id uuid, user_message_id uuid, assistant_message_id uuid)
language sql
security definer
set search_path = ''
as $$
  select * from nexa_private.nexa_append_turn(
    p_user_id, p_conversation_id, p_create_new, p_app, p_user_content,
    p_assistant_content, p_provider, p_model, p_request_id
  );
$$;

create function nexa_private.nexa_consume_rate_limit(
  p_window_seconds integer,
  p_max_requests integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window_start timestamptz;
  v_count integer;
  v_retry integer;
begin
  if v_user_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Autenticacao obrigatoria.';
  end if;

  if p_window_seconds is null or p_window_seconds not between 1 and 3600
    or p_max_requests is null or p_max_requests not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Configuracao de rate limit invalida.';
  end if;

  v_window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from v_now) / p_window_seconds)
    * p_window_seconds
  );

  insert into public.rate_limit_windows as w (
    user_id, window_seconds, window_started_at, request_count, updated_at
  ) values (
    v_user_id, p_window_seconds, v_window_start, 1, v_now
  )
  on conflict (user_id, window_seconds) do update
    set window_started_at = excluded.window_started_at,
        request_count = case
          when w.window_started_at = excluded.window_started_at then w.request_count + 1
          else 1
        end,
        updated_at = excluded.updated_at
    where w.window_started_at < excluded.window_started_at
      or (
        w.window_started_at = excluded.window_started_at
        and w.request_count < p_max_requests
      )
  returning request_count into v_count;

  if found then
    return query select true, greatest(0, p_max_requests - v_count), 0;
    return;
  end if;

  -- The row lock serializes callers. A delayed request from the prior window
  -- cannot move the stored window backwards; it fails closed until retry.
  select w.window_started_at, w.request_count into v_window_start, v_count
  from public.rate_limit_windows w
  where w.user_id = v_user_id and w.window_seconds = p_window_seconds;

  v_retry := greatest(
    1,
    pg_catalog.ceil(extract(
      epoch from (v_window_start + p_window_seconds * interval '1 second'
        - pg_catalog.clock_timestamp())
    ))::integer
  );
  return query select false, 0, v_retry;
end;
$$;

create function public.nexa_consume_rate_limit(
  p_window_seconds integer,
  p_max_requests integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language sql
security invoker
set search_path = ''
as $$
  select * from nexa_private.nexa_consume_rate_limit(
    p_window_seconds, p_max_requests
  );
$$;

revoke all on function nexa_private.touch_conversation() from public, anon, authenticated;
revoke all on function nexa_private.touch_conversation_from_message() from public, anon, authenticated;
revoke all on function nexa_private.nexa_append_turn(uuid, uuid, boolean, text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function nexa_private.nexa_consume_rate_limit(integer, integer) from public, anon, authenticated;
revoke all on function public.nexa_append_turn(uuid, uuid, boolean, text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.nexa_consume_rate_limit(integer, integer) from public, anon, authenticated;

grant execute on function nexa_private.nexa_consume_rate_limit(integer, integer) to authenticated;
grant execute on function public.nexa_append_turn(uuid, uuid, boolean, text, text, text, text, text, text) to service_role;
grant execute on function public.nexa_consume_rate_limit(integer, integer) to authenticated;

commit;
