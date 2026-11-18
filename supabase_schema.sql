-- ============================================================
--  Lemon soft · Soft Hub — Supabase schema (supabase_schema.sql)
--  ------------------------------------------------------------
--  Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 한 번만 실행하세요.
--  만든 뒤에는 아래 두 곳만 채우면 됩니다.
--    1) Settings → API 의 Project URL · anon public key
--       → lemon-cloud-config.js 또는 관리자 콘솔의 Supabase 탭
--    2) 관리자 이메일 등록 (맨 아래 '관리자 등록' 주석 참고)
--
--  테이블
--    site_config      사이트 상단 공지 · 홈 배너 · 광고 ON/OFF      (전 방문자 읽기)
--    site_ads         Flux Feed 광고 목록                            (전 방문자 읽기)
--    user_sync_data   로그인 사용자의 lemon_* / flux_* 데이터 백업   (본인만)
--    shared_pages     짧은 공유 링크(view.html?id=...)               (링크 보유자 읽기)
--    admin_users      관리자 이메일 목록                             (관리자만 확인)
--  모든 테이블에 RLS 가 켜져 있고, 쓰기는 관리자/본인으로 제한됩니다.
--  여러 번 실행해도 안전합니다(if not exists / drop policy if exists).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 0. 관리자 판별 함수
-- ------------------------------------------------------------
create table if not exists public.admin_users (
  email      text primary key,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
-- 정책을 만들지 않는다 → anon/authenticated 는 직접 읽고 쓸 수 없다.
-- 아래 SECURITY DEFINER 함수만 내부적으로 참조한다.

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admin_users a
     where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to anon, authenticated;

-- ------------------------------------------------------------
-- 1. site_config — 상단 공지 · 홈 배너 · 광고 설정
--    id: 'notice' | 'home' | 'ads'
-- ------------------------------------------------------------
create table if not exists public.site_config (
  id         text primary key,
  value      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_config enable row level security;

drop policy if exists "site_config public read"  on public.site_config;
drop policy if exists "site_config admin read"   on public.site_config;
drop policy if exists "site_config admin write"  on public.site_config;

create policy "site_config public read"
  on public.site_config for select
  to anon, authenticated
  using (id in ('notice', 'home', 'ads'));

create policy "site_config admin read"
  on public.site_config for select
  to authenticated
  using (public.is_site_admin());

create policy "site_config admin write"
  on public.site_config for all
  to authenticated
  using (public.is_site_admin())
  with check (public.is_site_admin());

-- ------------------------------------------------------------
-- 2. site_ads — Flux Feed 광고
-- ------------------------------------------------------------
create table if not exists public.site_ads (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  enabled    boolean not null default true,
  position   text not null default 'feed',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_ads_order_idx on public.site_ads (position, sort_order);

alter table public.site_ads enable row level security;

drop policy if exists "site_ads public read" on public.site_ads;
drop policy if exists "site_ads admin write" on public.site_ads;

create policy "site_ads public read"
  on public.site_ads for select
  to anon, authenticated
  using (true);

create policy "site_ads admin write"
  on public.site_ads for all
  to authenticated
  using (public.is_site_admin())
  with check (public.is_site_admin());

-- ------------------------------------------------------------
-- 3. user_sync_data — 로그인 사용자 클라우드 백업
-- ------------------------------------------------------------
create table if not exists public.user_sync_data (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists user_sync_data_user_idx on public.user_sync_data (user_id);

alter table public.user_sync_data enable row level security;

drop policy if exists "sync own rows" on public.user_sync_data;

create policy "sync own rows"
  on public.user_sync_data for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. shared_pages — 짧은 공유 링크 (view.html?id=짧은코드)
-- ------------------------------------------------------------
create table if not exists public.shared_pages (
  id         text primary key,
  kind       text not null default 'page',
  title      text,
  payload    jsonb not null default '{}'::jsonb,
  owner      uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  views      integer not null default 0,
  constraint shared_pages_id_format check (id ~ '^[A-Za-z0-9]{4,24}$'),
  constraint shared_pages_payload_size check (pg_column_size(payload) <= 262144)
);

create index if not exists shared_pages_created_idx on public.shared_pages (created_at desc);

alter table public.shared_pages enable row level security;

drop policy if exists "shared public read"  on public.shared_pages;
drop policy if exists "shared anyone create" on public.shared_pages;
drop policy if exists "shared owner delete"  on public.shared_pages;

-- 링크를 아는 사람은 누구나 읽을 수 있다(짧은 코드 = 접근 키).
-- 만료일이 지난 공유는 자동으로 보이지 않는다.
create policy "shared public read"
  on public.shared_pages for select
  to anon, authenticated
  using (expires_at is null or expires_at > now());

-- 로그인 없이도 만들 수 있다(로컬 모드와 같은 경험). 소유자는 로그인 시 기록.
create policy "shared anyone create"
  on public.shared_pages for insert
  to anon, authenticated
  with check (owner is null or owner = auth.uid());

create policy "shared owner delete"
  on public.shared_pages for delete
  to authenticated
  using (owner = auth.uid());

grant select, insert on public.shared_pages to anon;
grant select, insert, update, delete on public.shared_pages to authenticated;

-- 조회수 증가 (RLS 우회, 함수만 실행)
create or replace function public.share_view_hit(p_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shared_pages
     set views = views + 1
   where id = p_id
     and (expires_at is null or expires_at > now());
$$;

revoke all on function public.share_view_hit(text) from public;
grant execute on function public.share_view_hit(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 5. updated_at 자동 갱신
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_config_touch on public.site_config;
create trigger site_config_touch before update on public.site_config
  for each row execute function public.touch_updated_at();

drop trigger if exists site_ads_touch on public.site_ads;
create trigger site_ads_touch before update on public.site_ads
  for each row execute function public.touch_updated_at();

drop trigger if exists user_sync_touch on public.user_sync_data;
create trigger user_sync_touch before update on public.user_sync_data
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 7. 클라우드 저장 한도 (1인당 5MB) — 서버 보호
--    클라이언트(lemon-cloud.js)가 먼저 막지만, 다른 경로로 들어오는
--    대용량 업로드를 DB 에서도 막는다. 무료 플랜 DB 500MB 를 지키기 위한 장치다.
--    한도를 바꾸려면 아래 5242880(5MB) 숫자만 고쳐 다시 실행하면 된다.
-- ------------------------------------------------------------
-- 행마다 실제 저장 바이트를 기록한다.
-- lemon-cloud.js 가 이 컬럼을 읽어 "서버 기준 사용량"을 보여준다.
alter table public.user_sync_data
  add column if not exists size_bytes bigint not null default 0;

create index if not exists user_sync_data_size_idx on public.user_sync_data (user_id, size_bytes);

create or replace function public.enforce_user_sync_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
  declare
    quota  bigint := 5242880;   -- 5MB
    used   bigint;
    mine   bigint;
  begin
    mine := octet_length(coalesce(new.value::text, ''));
    new.size_bytes := mine;

    select coalesce(sum(octet_length(coalesce(value::text, ''))), 0)
      into used
      from public.user_sync_data
     where user_id = new.user_id
       and (tg_op = 'INSERT' or key <> new.key);

    if used + mine > quota then
      raise exception 'cloud-quota-exceeded: % + % > %', used, mine, quota
        using errcode = 'check_violation',
              hint = '클라우드 저장 한도(5MB)를 초과했습니다. 불필요한 파일/항목을 정리해 주세요.';
    end if;
    return new;
  end;
$$;

update public.user_sync_data
   set size_bytes = octet_length(coalesce(value::text, ''))
 where size_bytes = 0;

drop trigger if exists user_sync_quota on public.user_sync_data;
create trigger user_sync_quota
  before insert or update on public.user_sync_data
  for each row execute function public.enforce_user_sync_quota();

-- ------------------------------------------------------------
-- 8. 권한 (Supabase 기본 권한 위에 명시)
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.site_config to anon, authenticated;
grant select on public.site_ads    to anon, authenticated;
grant select, insert, update, delete on public.site_config to authenticated;
grant select, insert, update, delete on public.site_ads    to authenticated;
grant select, insert, update, delete on public.user_sync_data to authenticated;

-- ------------------------------------------------------------
-- 9. 관리자 등록 — 아래 주석을 풀고 본인 이메일을 넣어 한 번 실행하세요.
--    (관리자 콘솔에서 Supabase 로그인한 계정과 같은 이메일이어야 합니다)
-- ------------------------------------------------------------
-- insert into public.admin_users (email) values ('helpaboutflux@gmail.com')
--   on conflict (email) do nothing;

-- 확인용
select 'site_config'    as table_name, count(*) from public.site_config
union all
select 'site_ads',      count(*) from public.site_ads
union all
select 'shared_pages',  count(*) from public.shared_pages
union all
select 'admin_users',   count(*) from public.admin_users;