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
--    community_apps   커뮤니티 앱 전시 (portal.html 등록 → 관리자 승인)
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
-- 1. site_config — 상단 공지 · 홈 배너 · 광고 설정 · Cloudinary 연동
--    id: 'notice' | 'home' | 'ads' | 'cloudinary'
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
  using (id in ('notice', 'home', 'ads', 'cloudinary'));

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

-- ------------------------------------------------------------
-- 10. community_apps — 커뮤니티 앱 전시
--     개발자 포털(portal.html)에서 로그인한 이용자가 자기 서비스를 등록하면
--     관리자 콘솔(admin.html · 커뮤니티 승인)에서 승인/반려한다.
--     · 누구나 '승인된 앱'만 조회
--     · 본인은 자기 앱을 pending 상태로만 등록·수정(승인된 뒤 임의로 approved 유지 불가)
--     · 관리자는 모든 앱 조회·승인·반려·삭제
--     · screenshot_url 은 Cloudinary 업로드 주소 또는 직접 입력한 이미지 주소
--     관리자 콘솔의 커뮤니티 승인 탭에서 안내/복사하는 SQL 과 같은 내용이다.
-- ------------------------------------------------------------
-- >> community_apps
create table if not exists public.community_apps (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  author_name    text not null default '',
  name           text not null,
  description    text not null default '',
  url            text not null,
  category       text not null default 'utility',
  icon_id        text not null default 'globe',
  color          text not null default '#3b82f6',
  screenshot_url text not null default '',
  status         text not null default 'pending',
  reject_reason  text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint community_apps_url_http
    check (url ~* '^https?://'),
  constraint community_apps_status
    check (status in ('pending', 'approved', 'rejected')),
  constraint community_apps_category
    check (category in ('utility', 'productivity', 'media', 'game', 'dev', 'etc')),
  constraint community_apps_name_len
    check (char_length(btrim(name)) between 1 and 60),
  constraint community_apps_desc_len
    check (char_length(description) <= 400),
  constraint community_apps_color
    check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint community_apps_screenshot
    check (screenshot_url = '' or screenshot_url ~* '^https?://')
);

create index if not exists community_apps_status_idx
  on public.community_apps (status, created_at desc);
create index if not exists community_apps_owner_idx
  on public.community_apps (owner_id, created_at desc);

alter table public.community_apps enable row level security;

drop policy if exists "community public read"  on public.community_apps;
drop policy if exists "community owner insert" on public.community_apps;
drop policy if exists "community owner update" on public.community_apps;
drop policy if exists "community admin update" on public.community_apps;
drop policy if exists "community owner delete" on public.community_apps;

-- 승인된 앱은 누구나, 내 앱은 나만, 나머지는 관리자만 본다.
create policy "community public read"
  on public.community_apps for select
  to anon, authenticated
  using (status = 'approved' or auth.uid() = owner_id or public.is_site_admin());

-- 등록은 로그인한 본인 소유 + pending 만 허용한다.
create policy "community owner insert"
  on public.community_apps for insert
  to authenticated
  with check (auth.uid() = owner_id and status = 'pending');

-- 본인이 고치면 다시 승인 대기(pending)로 돌아간다.
-- 승인된 앱을 그대로 approved 로 유지한 채 내용만 바꾸는 것은 허용하지 않는다.
create policy "community owner update"
  on public.community_apps for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id and status = 'pending');

-- 관리자는 상태·반려 사유를 포함해 모든 컬럼을 바꿀 수 있다.
create policy "community admin update"
  on public.community_apps for update
  to authenticated
  using (public.is_site_admin())
  with check (public.is_site_admin());

create policy "community owner delete"
  on public.community_apps for delete
  to authenticated
  using (auth.uid() = owner_id or public.is_site_admin());

-- updated_at 자동 갱신
drop trigger if exists community_apps_touch on public.community_apps;
create trigger community_apps_touch before update on public.community_apps
  for each row execute function public.touch_updated_at();

-- 표 권한 (RLS 가 실제 제어를 맡고, 여기서는 PostgREST 접근만 열어 준다)
grant select on public.community_apps to anon;
grant select, insert, update, delete on public.community_apps to authenticated;

-- site_config 의 'cloudinary' 행도 공개 읽기 대상에 넣는다
-- (위 1번 항목과 같은 정책이다. 이 블록만 따로 실행해도 반영되도록 한 번 더 만든다.)
drop policy if exists "site_config public read" on public.site_config;
create policy "site_config public read"
  on public.site_config for select
  to anon, authenticated
  using (id in ('notice', 'home', 'ads', 'cloudinary'));
-- << community_apps

-- 확인용
select 'site_config'    as table_name, count(*) from public.site_config
union all
select 'site_ads',      count(*) from public.site_ads
union all
select 'shared_pages',  count(*) from public.shared_pages
union all
select 'admin_users',   count(*) from public.admin_users
union all
select 'community_apps', count(*) from public.community_apps;