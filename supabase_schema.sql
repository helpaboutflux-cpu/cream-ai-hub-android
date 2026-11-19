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
--    shared_pages     짧은 공유 링크(view.html?id=...)               (링크 보유자 읽기)
--    admin_users      관리자 이메일 목록                             (관리자만 확인)
--  관리자 전용 함수
--    admin_list_lk_accounts()  LK ID 가입 계정 목록 (관리자 세션만, 9번 항목)
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
-- 3. (계정 작업물 저장 없음)
--    개인 작업물(메모·일정·가계부·사진 등)은 서버에 올리지 않는다.
--    백업·복원은 이용자 본인의 Google Drive(lemon-gdrive.js)로만 한다.
--    예전 버전이 만들던 user_sync_data 테이블은 쓰지 않는다.
--    직접 정리하려면 아래 한 줄을 실행한다(되돌릴 수 없음).
--    drop table if exists public.user_sync_data;
-- ------------------------------------------------------------

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


-- ------------------------------------------------------------
-- 6. 계정 저장 한도 — 없음
--    계정에는 짧은 공유 링크와 원격 설정만 저장하므로 별도 용량 규칙을 두지 않는다.
--    개인 작업물 용량은 이용자 본인의 Google Drive 몫을 따른다.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 7. 권한 (Supabase 기본 권한 위에 명시)
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.site_config to anon, authenticated;
grant select on public.site_ads    to anon, authenticated;
grant select, insert, update, delete on public.site_config to authenticated;
grant select, insert, update, delete on public.site_ads    to authenticated;

-- ------------------------------------------------------------
-- 8. 관리자 등록 — 아래 주석을 풀고 본인 이메일을 넣어 한 번 실행하세요.
--    (관리자 콘솔에서 Supabase 로그인한 계정과 같은 이메일이어야 합니다)
-- ------------------------------------------------------------
-- insert into public.admin_users (email) values ('helpaboutflux@gmail.com')
--   on conflict (email) do nothing;

-- ------------------------------------------------------------
-- 9. 관리자 전용 — LK ID 계정 목록 조회
--    브라우저(관리자 콘솔)는 auth.users 를 직접 읽을 수 없다.
--    public.admin_users 에 등록된 관리자 이메일로 로그인한 세션만
--    이 함수를 통해 계정 목록(id·이메일·이름·로그인 방식·가입일·최근 로그인)을 받는다.
--    관리자 이메일이 등록되지 않은 상태에서 호출하면 'forbidden' 오류를 낸다.
--    관리자 콘솔의 LK ID 계정 탭에서 안내되는 SQL 과 같은 내용이다.
-- ------------------------------------------------------------
-- >> admin_list_lk_accounts
create or replace function public.admin_list_lk_accounts()
returns table (
  id                 uuid,
  email              text,
  display_name       text,
  provider           text,
  created_at         timestamptz,
  last_sign_in_at    timestamptz,
  email_confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  -- 관리자 세션이 아니면 어떤 줄도 돌려주지 않는다.
  if not public.is_site_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select u.id,
           u.email::text,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')::text,
           (u.raw_app_meta_data ->> 'provider')::text,
           u.created_at,
           u.last_sign_in_at,
           u.email_confirmed_at
      from auth.users u
     order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_lk_accounts() from public;
grant execute on function public.admin_list_lk_accounts() to authenticated;
-- << admin_list_lk_accounts

-- 확인용
select 'site_config'    as table_name, count(*) from public.site_config
union all
select 'site_ads',      count(*) from public.site_ads
union all
select 'shared_pages',  count(*) from public.shared_pages
union all
select 'admin_users',   count(*) from public.admin_users;