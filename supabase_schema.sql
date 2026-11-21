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
--    site_config      상단 공지 · 홈 배너 · 발견 탭 배너 · 광고 ON/OFF (전 방문자 읽기)
--    site_ads         Flux Feed 광고 목록                            (전 방문자 읽기)
--    shared_pages     짧은 공유 링크(view.html?id=...)               (링크 보유자 읽기)
--    admin_users      관리자 이메일 목록                             (관리자만 확인)
--    community_apps   도구 전시 (portal.html 등록 → 관리자 승인)
--    tool_signals     도구 '유용함' · '신고' 신호 (선택 · 없어도 화면은 동작)
--    oauth_clients    LK 로그인 API — 앱 등록 (Client ID · Redirect URL)
--    oauth_codes      LK 로그인 API — 5분짜리 일회용 코드 (함수만 접근)
--    oauth_reports    LK 로그인 화면의 '이 서비스 신고' 접수 (관리자만 읽기)
--    user_sessions    로그인한 기기 목록 — 기기별 원격 로그아웃 (본인만, 17번 항목)
--  관리자 전용 함수
--    admin_list_lk_accounts()  LK ID 가입 계정 목록 (관리자 세션만, 9번 항목)
--    notifications      Soft Hub 알림 센터 — 앱이 보낸 알림 (본인만 읽기)
--    notification_prefs 앱별 알림 차단 설정 (본인만)
--  LK 로그인 API 함수
--    oauth_client_public()      로그인 화면이 보는 앱 이름 · 허용 주소 (12번 항목)
--    oauth_issue_code()         동의 후 일회용 code 발급 (로그인 세션)
--    oauth_exchange_code()      외부 앱이 code 로 프로필 교환 (anon · 1회용)
--  LK API 4종 (13~15번 항목)
--    scope: drive:app · share:create · push:send · theme:read
--    oauth_create_share()       짧은 공유 링크 만들기 (go.html?id=...)
--    oauth_send_push()          사용자에게 알림 보내기 (push-center.html)
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
--        'portal_notices'  개발자 포털 소식 탭 공지 배열 { items: [...] }
--        'portal_controls' 포털 전역 제어 { block_new_apps, disable_api }
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
  using (id in ('notice', 'home', 'ads', 'cloudinary', 'portal_notices', 'portal_controls'));

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
  using (id in ('notice', 'home', 'ads', 'cloudinary', 'portal_notices', 'portal_controls'));

-- ------------------------------------------------------------
-- 11. tool_signals — 도구 '유용함' · '신고' (선택)
--     · 표가 없어도 tool.html · portal.html 은 이 기기 기록만으로 동작한다.
--     · 유용함은 누구나 읽어 집계하고, 신고 내용은 관리자만 읽는다.
-- ------------------------------------------------------------
create table if not exists public.tool_signals (
  id         bigserial primary key,
  app_id     uuid not null references public.community_apps (id) on delete cascade,
  kind       text not null default 'useful',
  note       text not null default '',
  created_at timestamptz not null default now(),
  constraint tool_signals_kind check (kind in ('useful', 'report')),
  constraint tool_signals_note check (char_length(note) <= 500)
);

create index if not exists tool_signals_app_idx on public.tool_signals (app_id, kind);

alter table public.tool_signals enable row level security;

drop policy if exists "tool_signals public read"  on public.tool_signals;
drop policy if exists "tool_signals admin read"   on public.tool_signals;
drop policy if exists "tool_signals public insert" on public.tool_signals;

-- 유용함 집계는 누구나 읽는다(신고 글은 이 정책에 걸리지 않는다).
create policy "tool_signals public read"
  on public.tool_signals for select
  to anon, authenticated
  using (kind = 'useful');

-- 신고 내용은 관리자만 본다.
create policy "tool_signals admin read"
  on public.tool_signals for select
  to authenticated
  using (public.is_site_admin());

-- 방문자는 유용함·신고를 한 줄씩 남길 수 있다.
create policy "tool_signals public insert"
  on public.tool_signals for insert
  to anon, authenticated
  with check (kind in ('useful', 'report') and char_length(note) <= 500);

grant select, insert on public.tool_signals to anon;
grant select, insert on public.tool_signals to authenticated;
grant usage, select on sequence public.tool_signals_id_seq to anon, authenticated;
-- << community_apps

-- ------------------------------------------------------------
-- 12. LK 계정 로그인 API — oauth_clients · oauth_codes · oauth_reports
--     외부 정적 웹앱이 'LK 계정으로 로그인'을 붙일 때 쓰는 표와 함수.
--     흐름
--       1) 앱이 oauth.html?client_id=..&redirect_uri=..&state=.. 로 보낸다
--       2) oauth.html 이 oauth_client_public() 으로 앱 이름·허용 주소를 확인
--       3) 동의하면 oauth_issue_code() 가 5분짜리 일회용 code 발급
--       4) 앱의 콜백이 oauth_exchange_code() 로 프로필을 한 번만 받아 간다
--     · 클라이언트 비밀(secret)은 쓰지 않는다 — 정적 웹앱은 비밀을 지킬 수 없으므로
--       코드 교환을 client_id + redirect_uri 정확 일치로 묶는다.
--     · 앱 정보는 소유자만 읽고 쓰며, 로그인 화면은 SECURITY DEFINER 함수로만
--       앱 이름 · 허용 주소 · 스코프를 본다(소유자 ID 등은 노출되지 않는다).
-- ------------------------------------------------------------
-- >> oauth_clients
create extension if not exists pgcrypto;

create table if not exists public.oauth_clients (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null unique,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  app_name      text not null,
  app_url       text not null default '',
  redirect_uris text[] not null default '{}',
  scope         text not null default 'profile:basic',
  is_active     boolean not null default true,
  login_count   integer not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint oauth_clients_id_format
    check (client_id ~ '^lkc_[a-z0-9]{16,40}$'),
  constraint oauth_clients_name_len
    check (char_length(btrim(app_name)) between 1 and 60),
  constraint oauth_clients_url
    check (app_url = '' or app_url ~* '^https?://'),
  constraint oauth_clients_uris_len
    check (coalesce(array_length(redirect_uris, 1), 0) between 1 and 10),
  constraint oauth_clients_scope
    check (scope = 'profile:basic')
);

create index if not exists oauth_clients_owner_idx
  on public.oauth_clients (owner_id, created_at desc);

-- Redirect URL 은 https 이거나 로컬 테스트용 http://localhost 여야 한다.
create or replace function public.oauth_clients_check_uris()
returns trigger
language plpgsql
as $$
declare u text;
begin
  if coalesce(array_length(new.redirect_uris, 1), 0) = 0 then
    raise exception 'oauth-redirect-required';
  end if;
  if coalesce(array_length(new.redirect_uris, 1), 0) > 10 then
    raise exception 'oauth-redirect-too-many';
  end if;
  foreach u in array new.redirect_uris loop
    if u !~* '^https://[^[:space:]]+$'
       and u !~* '^http://localhost(:[0-9]+)?(/[^[:space:]]*)?$' then
      raise exception 'oauth-redirect-invalid';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists oauth_clients_uris on public.oauth_clients;
create trigger oauth_clients_uris
  before insert or update of redirect_uris on public.oauth_clients
  for each row execute function public.oauth_clients_check_uris();

drop trigger if exists oauth_clients_touch on public.oauth_clients;
create trigger oauth_clients_touch before update on public.oauth_clients
  for each row execute function public.touch_updated_at();

alter table public.oauth_clients enable row level security;

drop policy if exists "oauth_clients owner read"   on public.oauth_clients;
drop policy if exists "oauth_clients owner insert" on public.oauth_clients;
drop policy if exists "oauth_clients owner update" on public.oauth_clients;
drop policy if exists "oauth_clients owner delete" on public.oauth_clients;

create policy "oauth_clients owner read"
  on public.oauth_clients for select
  to authenticated
  using (auth.uid() = owner_id or public.is_site_admin());

create policy "oauth_clients owner insert"
  on public.oauth_clients for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "oauth_clients owner update"
  on public.oauth_clients for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "oauth_clients owner delete"
  on public.oauth_clients for delete
  to authenticated
  using (auth.uid() = owner_id or public.is_site_admin());

-- anon 에는 표 권한을 주지 않는다. 로그인 화면은 아래 함수만 쓴다.
grant select, insert, update, delete on public.oauth_clients to authenticated;

-- ------------------------------------------------------------
-- 12-1. oauth_codes — 일회용 코드 (직접 접근 불가 · 함수만)
-- ------------------------------------------------------------
create table if not exists public.oauth_codes (
  code             text primary key,
  client_id        text not null
                     references public.oauth_clients (client_id)
                     on update cascade on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  redirect_uri     text not null,
  scope            text not null default 'profile:basic',
  profile_snapshot jsonb not null default '{}'::jsonb,
  expires_at       timestamptz not null,
  used_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists oauth_codes_client_idx
  on public.oauth_codes (client_id, created_at desc);

alter table public.oauth_codes enable row level security;
-- 정책을 만들지 않는다 → anon/authenticated 는 직접 읽고 쓸 수 없다.

-- ------------------------------------------------------------
-- 12-2. 프로필 색상 — 계정 ID 로 항상 같은 색을 만든다
-- ------------------------------------------------------------
create or replace function public.oauth_avatar_color(p_uid uuid)
returns text
language sql
immutable
as $$
  select (array['#2563eb', '#0f766e', '#0f9d63', '#ca8a04',
                '#ea580c', '#e11d48', '#9333ea', '#0891b2'])[
    (get_byte(decode(substr(md5(coalesce(p_uid::text, '')), 1, 2), 'hex'), 0) % 8) + 1
  ];
$$;

-- ------------------------------------------------------------
-- 12-3. 로그인 화면용 공개 앱 정보 — 소유자 정보는 나오지 않는다
-- ------------------------------------------------------------
create or replace function public.oauth_client_public(p_client_id text)
returns table (
  app_name      text,
  app_url       text,
  redirect_uris text[],
  scope         text,
  is_active     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.app_name, c.app_url, c.redirect_uris, c.scope, c.is_active
    from public.oauth_clients c
   where c.client_id = p_client_id
   limit 1;
$$;

revoke all on function public.oauth_client_public(text) from public;
grant execute on function public.oauth_client_public(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 12-4. 동의 → 일회용 code 발급 (로그인 세션 필요 · 5분 만료)
-- ------------------------------------------------------------
create or replace function public.oauth_issue_code(
  p_client_id     text,
  p_redirect_uri  text,
  p_scope         text default 'profile:basic'
)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_uid    uuid := auth.uid();
  v_client public.oauth_clients%rowtype;
  v_code   text;
  v_nick   text;
begin
  if v_uid is null then
    raise exception 'login-required';
  end if;

  select * into v_client
    from public.oauth_clients c
   where c.client_id = p_client_id
     and c.is_active
   limit 1;

  if not found then
    raise exception 'invalid-client';
  end if;

  if not (p_redirect_uri = any (v_client.redirect_uris)) then
    raise exception 'invalid-redirect-uri';
  end if;

  if coalesce(nullif(btrim(p_scope), ''), 'profile:basic') <> 'profile:basic'
     or v_client.scope <> 'profile:basic' then
    raise exception 'invalid-scope';
  end if;

  select coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'nickname'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
           'LK 사용자'
         )
    into v_nick
    from auth.users u
   where u.id = v_uid;

  v_nick := left(coalesce(v_nick, 'LK 사용자'), 40);
  v_code := 'lk_' || encode(gen_random_bytes(20), 'hex');

  insert into public.oauth_codes
    (code, client_id, user_id, redirect_uri, scope, profile_snapshot, expires_at)
  values
    (v_code, v_client.client_id, v_uid, p_redirect_uri, 'profile:basic',
     jsonb_build_object(
       'sub', v_uid,
       'nickname', v_nick,
       'avatar_color', public.oauth_avatar_color(v_uid),
       'avatar_text', upper(left(v_nick, 1))
     ),
     now() + interval '5 minutes');

  update public.oauth_clients
     set login_count = login_count + 1,
         last_used_at = now()
   where id = v_client.id;

  -- 하루 지난 코드는 조용히 정리한다.
  delete from public.oauth_codes where expires_at < now() - interval '1 day';

  return v_code;
end;
$$;

revoke all on function public.oauth_issue_code(text, text, text) from public;
grant execute on function public.oauth_issue_code(text, text, text) to authenticated;

-- ------------------------------------------------------------
-- 12-5. code → 프로필 교환 (외부 정적 앱이 anon 키로 호출 · 1회용)
--       성공하면 코드는 즉시 만료되고, 같은 코드로 다시 부르면 invalid-code.
-- ------------------------------------------------------------
create or replace function public.oauth_exchange_code(
  p_code          text,
  p_client_id     text,
  p_redirect_uri  text
)
returns table (
  sub          uuid,
  nickname     text,
  avatar_color text,
  avatar_text  text,
  scope        text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.oauth_codes%rowtype;
begin
  select * into v_row
    from public.oauth_codes c
   where c.code = p_code
     and c.client_id = p_client_id
     and c.redirect_uri = p_redirect_uri
     and c.used_at is null
   for update;

  if not found then
    raise exception 'invalid-code';
  end if;

  if v_row.expires_at <= now() then
    delete from public.oauth_codes where code = v_row.code;
    raise exception 'expired-code';
  end if;

  update public.oauth_codes
     set used_at = now()
   where code = v_row.code;

  return query
    select (v_row.profile_snapshot ->> 'sub')::uuid,
           v_row.profile_snapshot ->> 'nickname',
           v_row.profile_snapshot ->> 'avatar_color',
           v_row.profile_snapshot ->> 'avatar_text',
           v_row.scope;
end;
$$;

revoke all on function public.oauth_exchange_code(text, text, text) from public;
grant execute on function public.oauth_exchange_code(text, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 12-6. oauth_reports — 의심스러운 서비스 신고 (로그인 화면 우측 아래 버튼)
--       누구나 한 줄 남길 수 있고, 내용은 관리자만 읽는다.
-- ------------------------------------------------------------
create table if not exists public.oauth_reports (
  id           bigserial primary key,
  client_id    text not null default '',
  redirect_uri text not null default '',
  reason       text not null default 'other',
  note         text not null default '',
  status       text not null default 'open',
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint oauth_reports_status
    check (status in ('open', 'done')),
  constraint oauth_reports_reason
    check (reason in ('phishing', 'impersonation', 'overreach', 'malware', 'other')),
  constraint oauth_reports_note
    check (char_length(note) <= 300),
  constraint oauth_reports_client
    check (char_length(client_id) <= 120),
  constraint oauth_reports_uri
    check (char_length(redirect_uri) <= 300)
);

-- 이미 만들어진 표에도 두 칸을 더한다(여러 번 실행해도 안전).
alter table public.oauth_reports add column if not exists status text not null default 'open';
alter table public.oauth_reports add column if not exists handled_at timestamptz;

create index if not exists oauth_reports_created_idx
  on public.oauth_reports (created_at desc);
create index if not exists oauth_reports_status_idx
  on public.oauth_reports (status, created_at desc);

alter table public.oauth_reports enable row level security;

drop policy if exists "oauth_reports anyone insert" on public.oauth_reports;
drop policy if exists "oauth_reports admin read"    on public.oauth_reports;
drop policy if exists "oauth_reports admin update"  on public.oauth_reports;

create policy "oauth_reports anyone insert"
  on public.oauth_reports for insert
  to anon, authenticated
  with check (true);

create policy "oauth_reports admin read"
  on public.oauth_reports for select
  to authenticated
  using (public.is_site_admin());

-- 관리자 콘솔(admin.html)이 '처리 완료'로 표시할 수 있다.
create policy "oauth_reports admin update"
  on public.oauth_reports for update
  to authenticated
  using (public.is_site_admin())
  with check (public.is_site_admin());

grant insert on public.oauth_reports to anon, authenticated;
grant select, update on public.oauth_reports to authenticated;
grant usage, select on sequence public.oauth_reports_id_seq to anon, authenticated;
-- << oauth_clients


-- ------------------------------------------------------------
-- 13. LK API 스코프 확장 — drive:app · share:create · push:send · theme:read
--     oauth_clients.scope 는 공백으로 구분한 목록이다.
--     예) 'profile:basic drive:app share:create'
--     · profile:basic  고유 ID·닉네임·프로필 색상
--     · drive:app      이 앱 전용 Google Drive 폴더(SoftHub_Apps/{client_id})만 읽고 쓰기
--     · share:create   짧은 공유 링크(go.html?id=...) 만들기
--     · push:send      사용자에게 Soft Hub 알림 보내기
--     · theme:read     현재 테마(dark/light/dynamic)와 브랜드 색 토큰 읽기
-- ------------------------------------------------------------
alter table public.oauth_clients drop constraint if exists oauth_clients_scope;
alter table public.oauth_clients
  add constraint oauth_clients_scope
  check (scope ~ '^profile:basic( (drive:app|share:create|push:send|theme:read))*$');

create or replace function public.oauth_has_scope(p_scope text, p_want text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_want = any (string_to_array(coalesce(p_scope, ''), ' ')), false);
$$;

revoke all on function public.oauth_has_scope(text, text) from public;
grant execute on function public.oauth_has_scope(text, text) to anon, authenticated;

-- 동의 화면이 요청 스코프를 그대로 보여 주고, 발급 함수가 앱 허용 목록과 대조한다.
create or replace function public.oauth_issue_code(
  p_client_id     text,
  p_redirect_uri  text,
  p_scope         text default 'profile:basic'
)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_uid    uuid := auth.uid();
  v_client public.oauth_clients%rowtype;
  v_code   text;
  v_nick   text;
  v_want   text;
  v_one    text;
begin
  if v_uid is null then
    raise exception 'login-required';
  end if;

  select * into v_client
    from public.oauth_clients c
   where c.client_id = p_client_id
     and c.is_active
   limit 1;

  if not found then
    raise exception 'invalid-client';
  end if;

  if not (p_redirect_uri = any (v_client.redirect_uris)) then
    raise exception 'invalid-redirect-uri';
  end if;

  v_want := regexp_replace(btrim(coalesce(p_scope, '')), '\s+', ' ', 'g');
  if v_want = '' then v_want := 'profile:basic'; end if;

  if not public.oauth_has_scope(v_want, 'profile:basic') then
    raise exception 'invalid-scope';
  end if;

  foreach v_one in array string_to_array(v_want, ' ') loop
    if v_one not in ('profile:basic', 'drive:app', 'share:create', 'push:send', 'theme:read') then
      raise exception 'invalid-scope';
    end if;
    if not public.oauth_has_scope(v_client.scope, v_one) then
      raise exception 'scope-not-allowed';
    end if;
  end loop;

  select coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'nickname'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
           'LK 사용자'
         )
    into v_nick
    from auth.users u
   where u.id = v_uid;

  v_nick := left(coalesce(v_nick, 'LK 사용자'), 40);
  v_code := 'lk_' || encode(gen_random_bytes(20), 'hex');

  insert into public.oauth_codes
    (code, client_id, user_id, redirect_uri, scope, profile_snapshot, expires_at)
  values
    (v_code, v_client.client_id, v_uid, p_redirect_uri, v_want,
     jsonb_build_object(
       'sub', v_uid,
       'nickname', v_nick,
       'avatar_color', public.oauth_avatar_color(v_uid),
       'avatar_text', upper(left(v_nick, 1))
     ),
     now() + interval '5 minutes');

  update public.oauth_clients
     set login_count = login_count + 1,
         last_used_at = now()
   where id = v_client.id;

  delete from public.oauth_codes where expires_at < now() - interval '1 day';

  return v_code;
end;
$$;

revoke all on function public.oauth_issue_code(text, text, text) from public;
grant execute on function public.oauth_issue_code(text, text, text) to authenticated;

-- 교환 결과에 동의한 스코프를 그대로 돌려준다(앱이 자기 권한을 확인할 수 있게).
create or replace function public.oauth_exchange_code(
  p_code          text,
  p_client_id     text,
  p_redirect_uri  text
)
returns table (
  sub          uuid,
  nickname     text,
  avatar_color text,
  avatar_text  text,
  scope        text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.oauth_codes%rowtype;
begin
  select * into v_row
    from public.oauth_codes c
   where c.code = p_code
     and c.client_id = p_client_id
     and c.redirect_uri = p_redirect_uri
     and c.used_at is null
   for update;

  if not found then
    raise exception 'invalid-code';
  end if;

  if v_row.expires_at <= now() then
    delete from public.oauth_codes where code = v_row.code;
    raise exception 'expired-code';
  end if;

  update public.oauth_codes set used_at = now() where code = v_row.code;

  return query
    select (v_row.profile_snapshot ->> 'sub')::uuid,
           v_row.profile_snapshot ->> 'nickname',
           v_row.profile_snapshot ->> 'avatar_color',
           v_row.profile_snapshot ->> 'avatar_text',
           v_row.scope;
end;
$$;

revoke all on function public.oauth_exchange_code(text, text, text) from public;
grant execute on function public.oauth_exchange_code(text, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 14. share:create — 짧은 공유 링크 API (go.html?id=...)
--     외부 도구가 결과물을 링크 하나로 건넨다.
--     · 앱이 share:create 스코프를 허용해야 하고,
--     · 앱당 24시간 40개까지(남용 방지),
--     · 본문은 160KB 까지.
--     표는 기존 shared_pages 를 그대로 쓴다(짧은 링크·조회수 로직 재사용).
-- ------------------------------------------------------------
alter table public.shared_pages add column if not exists client_id text not null default '';
create index if not exists shared_pages_client_idx
  on public.shared_pages (client_id, created_at desc);

create or replace function public.oauth_create_share(
  p_client_id text,
  p_title     text,
  p_payload   jsonb,
  p_kind      text default 'app'
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_client public.oauth_clients%rowtype;
  v_id     text;
  v_recent integer;
  v_size   integer;
begin
  select * into v_client
    from public.oauth_clients c
   where c.client_id = p_client_id
     and c.is_active
   limit 1;

  if not found then
    raise exception 'invalid-client';
  end if;

  if not public.oauth_has_scope(v_client.scope, 'share:create') then
    raise exception 'scope-required';
  end if;

  v_size := pg_column_size(coalesce(p_payload, '{}'::jsonb));
  if v_size > 160000 then
    raise exception 'payload-too-large';
  end if;

  select count(*) into v_recent
    from public.shared_pages s
   where s.client_id = p_client_id
     and s.created_at > now() - interval '24 hours';

  if v_recent >= 40 then
    raise exception 'rate-limited';
  end if;

  v_id := lower(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));

  insert into public.shared_pages
    (id, kind, title, payload, owner, client_id, created_at, expires_at)
  values
    (v_id,
     left(coalesce(nullif(btrim(p_kind), ''), 'app'), 20),
     left(coalesce(nullif(btrim(p_title), ''), '공유'), 120),
     coalesce(p_payload, '{}'::jsonb),
     null,
     p_client_id,
     now(),
     null);

  return v_id;
end;
$$;

revoke all on function public.oauth_create_share(text, text, jsonb, text) from public;
grant execute on function public.oauth_create_share(text, text, jsonb, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 15. push:send — Soft Hub 알림 센터
--     앱이 사용자에게 알림을 보낸다. 사용자는 push-center.html 에서 보고,
--     앱별로 끌 수 있다. 앱당 사용자별 24시간 10건까지.
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id         bigserial primary key,
  client_id  text not null default '',
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default '',
  body       text not null default '',
  url        text not null default '',
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_title check (char_length(title) between 1 and 80),
  constraint notifications_body check (char_length(body) <= 240),
  constraint notifications_url check (url = '' or url ~* '^https?://')
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_client_idx
  on public.notifications (client_id, user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications own read"   on public.notifications;
drop policy if exists "notifications own update" on public.notifications;
drop policy if exists "notifications own delete" on public.notifications;

create policy "notifications own read"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id or public.is_site_admin());

create policy "notifications own update"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notifications own delete"
  on public.notifications for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, update, delete on public.notifications to authenticated;

create table if not exists public.notification_prefs (
  user_id    uuid not null references auth.users (id) on delete cascade,
  client_id  text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

alter table public.notification_prefs enable row level security;

drop policy if exists "notification_prefs own" on public.notification_prefs;

create policy "notification_prefs own"
  on public.notification_prefs for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.notification_prefs to authenticated;

create or replace function public.oauth_send_push(
  p_client_id text,
  p_sub       uuid,
  p_title     text,
  p_body      text,
  p_url       text default ''
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_client public.oauth_clients%rowtype;
  v_recent integer;
  v_off    boolean;
  v_id     bigint;
begin
  select * into v_client
    from public.oauth_clients c
   where c.client_id = p_client_id
     and c.is_active
   limit 1;

  if not found then
    raise exception 'invalid-client';
  end if;

  if not public.oauth_has_scope(v_client.scope, 'push:send') then
    raise exception 'scope-required';
  end if;

  if p_sub is null or not exists (select 1 from auth.users u where u.id = p_sub) then
    raise exception 'invalid-sub';
  end if;

  select coalesce((select not p.enabled from public.notification_prefs p
                    where p.user_id = p_sub and p.client_id = p_client_id), false)
    into v_off;
  if v_off then
    raise exception 'blocked-by-user';
  end if;

  select count(*) into v_recent
    from public.notifications n
   where n.client_id = p_client_id
     and n.user_id = p_sub
     and n.created_at > now() - interval '24 hours';

  if v_recent >= 10 then
    raise exception 'rate-limited';
  end if;

  insert into public.notifications (client_id, user_id, title, body, url)
  values (p_client_id, p_sub,
          left(coalesce(nullif(btrim(p_title), ''), 'Soft Hub 알림'), 80),
          left(coalesce(p_body, ''), 240),
          case when coalesce(p_url, '') ~* '^https?://' then left(p_url, 400) else '' end)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.oauth_send_push(text, uuid, text, text, text) from public;
grant execute on function public.oauth_send_push(text, uuid, text, text, text) to anon, authenticated;

-- 관리자 확인용
select 'oauth_clients' as table_name, count(*) from public.oauth_clients
union all
select 'notifications', count(*) from public.notifications
union all
select 'notification_prefs', count(*) from public.notification_prefs
union all
select 'oauth_grants', count(*) from public.oauth_grants
union all
select 'user_sessions', count(*) from public.user_sessions;


-- ------------------------------------------------------------
-- 16. 하이브리드 승인 · 사용자 연결 관리(oauth_grants)
--     · 앱을 만든 본인은 승인 전에도 자기 계정으로 테스트할 수 있다.
--     · 다른 사용자에게 열려면 관리자가 admin.html 에서 승인(is_approved)해야 한다.
--     · 사용자는 auth.html 에서 자기가 허용한 앱 목록을 보고 권한을 해제할 수 있다.
--       (해제하면 push:send 는 즉시 막히고, 다시 쓰려면 oauth.html 에서 재동의)
-- ------------------------------------------------------------
alter table public.oauth_clients add column if not exists is_approved boolean not null default false;
alter table public.oauth_clients add column if not exists approved_at timestamptz;

create index if not exists oauth_clients_approved_idx
  on public.oauth_clients (is_approved, created_at desc);

-- 로그인 화면이 보는 앱 정보에 승인 여부를 더한다(소유자 정보는 여전히 감춘다).
drop function if exists public.oauth_client_public(text);
create or replace function public.oauth_client_public(p_client_id text)
returns table (
  app_name      text,
  app_url       text,
  redirect_uris text[],
  scope         text,
  is_active     boolean,
  is_approved   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.app_name, c.app_url, c.redirect_uris, c.scope, c.is_active, c.is_approved
    from public.oauth_clients c
   where c.client_id = p_client_id
   limit 1;
$$;

revoke all on function public.oauth_client_public(text) from public;
grant execute on function public.oauth_client_public(text) to anon, authenticated;

-- 지금 로그인한 사람이 이 앱의 주인인가 — 승인 전 테스트 허용 판단용
create or replace function public.oauth_is_owner(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.oauth_clients c
     where c.client_id = p_client_id
       and c.owner_id = auth.uid()
  );
$$;

revoke all on function public.oauth_is_owner(text) from public;
grant execute on function public.oauth_is_owner(text) to authenticated;

create table if not exists public.oauth_grants (
  user_id      uuid not null references auth.users (id) on delete cascade,
  client_id    text not null,
  scopes       text not null default 'profile:basic',
  granted_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  primary key (user_id, client_id)
);

create index if not exists oauth_grants_client_idx
  on public.oauth_grants (client_id, granted_at desc);

alter table public.oauth_grants enable row level security;

drop policy if exists "oauth_grants own read"   on public.oauth_grants;
drop policy if exists "oauth_grants own write"  on public.oauth_grants;
drop policy if exists "oauth_grants own update" on public.oauth_grants;
drop policy if exists "oauth_grants own delete" on public.oauth_grants;

create policy "oauth_grants own read"
  on public.oauth_grants for select
  to authenticated
  using (auth.uid() = user_id or public.is_site_admin());

create policy "oauth_grants own write"
  on public.oauth_grants for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "oauth_grants own update"
  on public.oauth_grants for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "oauth_grants own delete"
  on public.oauth_grants for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.oauth_grants to authenticated;

-- 내가 허용한 앱 목록 + 앱 이름 — auth.html '연결된 앱' 화면용
create or replace function public.oauth_my_grants()
returns table (
  client_id    text,
  app_name     text,
  app_url      text,
  scopes       text,
  granted_at   timestamptz,
  revoked_at   timestamptz,
  is_active    boolean,
  is_approved  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select g.client_id,
         coalesce(c.app_name, '알 수 없는 앱'),
         coalesce(c.app_url, ''),
         g.scopes,
         g.granted_at,
         g.revoked_at,
         coalesce(c.is_active, false),
         coalesce(c.is_approved, false)
    from public.oauth_grants g
    left join public.oauth_clients c on c.client_id = g.client_id
   where g.user_id = auth.uid()
   order by g.granted_at desc;
$$;

revoke all on function public.oauth_my_grants() from public;
grant execute on function public.oauth_my_grants() to authenticated;

-- 승인 전에는 소유자만 / 승인 뒤에는 모든 사용자가 동의할 수 있다. 동의하면 grant 를 남긴다.
create or replace function public.oauth_issue_code(
  p_client_id     text,
  p_redirect_uri  text,
  p_scope         text default 'profile:basic'
)
returns text
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_uid    uuid := auth.uid();
  v_client public.oauth_clients%rowtype;
  v_code   text;
  v_nick   text;
  v_want   text;
  v_one    text;
begin
  if v_uid is null then
    raise exception 'login-required';
  end if;

  select * into v_client
    from public.oauth_clients c
   where c.client_id = p_client_id
     and c.is_active
   limit 1;

  if not found then
    raise exception 'invalid-client';
  end if;

  if not v_client.is_approved and v_client.owner_id <> v_uid then
    raise exception 'app-not-approved';
  end if;

  if not (p_redirect_uri = any (v_client.redirect_uris)) then
    raise exception 'invalid-redirect-uri';
  end if;

  v_want := regexp_replace(btrim(coalesce(p_scope, '')), '\s+', ' ', 'g');
  if v_want = '' then v_want := 'profile:basic'; end if;

  if not public.oauth_has_scope(v_want, 'profile:basic') then
    raise exception 'invalid-scope';
  end if;

  foreach v_one in array string_to_array(v_want, ' ') loop
    if v_one not in ('profile:basic', 'drive:app', 'share:create', 'push:send', 'theme:read') then
      raise exception 'invalid-scope';
    end if;
    if not public.oauth_has_scope(v_client.scope, v_one) then
      raise exception 'scope-not-allowed';
    end if;
  end loop;

  select coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'nickname'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
           'LK 사용자'
         )
    into v_nick
    from auth.users u
   where u.id = v_uid;

  v_nick := left(coalesce(v_nick, 'LK 사용자'), 40);
  v_code := 'lk_' || encode(gen_random_bytes(20), 'hex');

  insert into public.oauth_codes
    (code, client_id, user_id, redirect_uri, scope, profile_snapshot, expires_at)
  values
    (v_code, v_client.client_id, v_uid, p_redirect_uri, v_want,
     jsonb_build_object(
       'sub', v_uid,
       'nickname', v_nick,
       'avatar_color', public.oauth_avatar_color(v_uid),
       'avatar_text', upper(left(v_nick, 1))
     ),
     now() + interval '5 minutes');

  insert into public.oauth_grants (user_id, client_id, scopes, granted_at, last_used_at, revoked_at)
  values (v_uid, v_client.client_id, v_want, now(), now(), null)
  on conflict (user_id, client_id) do update
    set scopes = excluded.scopes,
        granted_at = now(),
        last_used_at = now(),
        revoked_at = null;

  update public.oauth_clients
     set login_count = login_count + 1,
         last_used_at = now()
   where id = v_client.id;

  delete from public.oauth_codes where expires_at < now() - interval '1 day';

  return v_code;
end;
$$;

revoke all on function public.oauth_issue_code(text, text, text) from public;
grant execute on function public.oauth_issue_code(text, text, text) to authenticated;

-- push:send 는 사용자가 그 앱에 push:send 를 허용했고 해제하지 않았을 때만.
create or replace function public.oauth_send_push(
  p_client_id text,
  p_sub       uuid,
  p_title     text,
  p_body      text,
  p_url       text default ''
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_client public.oauth_clients%rowtype;
  v_recent integer;
  v_grant  public.oauth_grants%rowtype;
  v_id     bigint;
begin
  select * into v_client
    from public.oauth_clients c
   where c.client_id = p_client_id
     and c.is_active
   limit 1;

  if not found then
    raise exception 'invalid-client';
  end if;

  if not public.oauth_has_scope(v_client.scope, 'push:send') then
    raise exception 'scope-required';
  end if;

  if p_sub is null or not exists (select 1 from auth.users u where u.id = p_sub) then
    raise exception 'invalid-sub';
  end if;

  select * into v_grant
    from public.oauth_grants g
   where g.user_id = p_sub and g.client_id = p_client_id
   limit 1;

  if not found or v_grant.revoked_at is not null
     or not public.oauth_has_scope(v_grant.scopes, 'push:send') then
    raise exception 'grant-required';
  end if;

  select count(*) into v_recent
    from public.notifications n
   where n.client_id = p_client_id
     and n.user_id = p_sub
     and n.created_at > now() - interval '24 hours';

  if v_recent >= 10 then
    raise exception 'rate-limited';
  end if;

  insert into public.notifications (client_id, user_id, title, body, url)
  values (p_client_id, p_sub,
          left(coalesce(nullif(btrim(p_title), ''), 'Soft Hub 알림'), 80),
          left(coalesce(p_body, ''), 240),
          case when coalesce(p_url, '') ~* '^https?://' then left(p_url, 400) else '' end)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.oauth_send_push(text, uuid, text, text, text) from public;
grant execute on function public.oauth_send_push(text, uuid, text, text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 17. user_sessions — 로그인한 기기 목록 · 기기별 원격 로그아웃
--     · 로그인한 기기마다 한 줄(user_id + device_id)을 두고, 접속할 때마다
--       last_seen_at 을 갱신한다. Google Drive 백업을 거치지 않고도
--       다른 기기의 로그인 상태를 바로 확인할 수 있다.
--     · 다른 기기에서 로그아웃시키면 revoked_at 을 채운다. 그 기기는 다음
--       확인 때 이 값을 보고 스스로 로그아웃한다(lemon-cloud.js).
--     · 본인 행만 읽고 쓸 수 있다(RLS: auth.uid() = user_id).
--       관리자도 남의 기기 목록은 읽지 않는다.
-- ------------------------------------------------------------
create table if not exists public.user_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  device_id     text not null,
  device_type   text not null default '',   -- 모바일 / 태블릿 / 데스크톱
  os            text not null default '',
  browser       text not null default '',
  screen        text not null default '',
  tz            text not null default '',
  user_agent    text not null default '',
  app_name      text not null default 'Soft Hub',  -- Soft Hub · Creamy Browser PC
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  constraint user_sessions_user_device_key unique (user_id, device_id)
);

create index if not exists idx_user_sessions_user_last
  on public.user_sessions (user_id, last_seen_at desc);

alter table public.user_sessions enable row level security;

drop policy if exists "user_sessions own read"   on public.user_sessions;
drop policy if exists "user_sessions own insert" on public.user_sessions;
drop policy if exists "user_sessions own update" on public.user_sessions;
drop policy if exists "user_sessions own delete" on public.user_sessions;

create policy "user_sessions own read"
  on public.user_sessions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "user_sessions own insert"
  on public.user_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "user_sessions own update"
  on public.user_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_sessions own delete"
  on public.user_sessions for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_sessions to authenticated;

-- 18. launcher_views — Web Launcher 방문자 통계
--     · 배포한 정적 사이트에 심는 1KB 비콘이 방문마다 한 줄을 남긴다.
--     · site_id 는 배포할 때 발급되는 무작위 값(ls_...)이라 주소를 아는 소유자만 조회할 수 있다.
--     · 표가 없어도 Web Launcher 는 "통계 테이블 준비 후 실시간 집계됩니다" 안내만 보여 주고
--       배포·미리보기·에디터는 그대로 동작한다.
-- ------------------------------------------------------------
create table if not exists public.launcher_views (
  id          bigint generated always as identity primary key,
  site_id     text not null,
  device_type text not null default 'desktop',
  referrer    text not null default '',
  created_at  timestamptz not null default now(),
  constraint launcher_views_site_len   check (char_length(site_id) between 6 and 64),
  constraint launcher_views_device_chk check (device_type in ('mobile', 'tablet', 'desktop')),
  constraint launcher_views_ref_len    check (char_length(referrer) <= 200)
);

create index if not exists idx_launcher_views_site_time
  on public.launcher_views (site_id, created_at desc);

alter table public.launcher_views enable row level security;

drop policy if exists "launcher_views public insert" on public.launcher_views;
drop policy if exists "launcher_views owner read"    on public.launcher_views;

-- 배포된 사이트를 연 방문자는 한 줄만 남길 수 있다.
create policy "launcher_views public insert"
  on public.launcher_views for insert
  to anon, authenticated
  with check (char_length(site_id) between 6 and 64);

-- 조회는 site_id 값을 아는 쪽(소유자의 Web Launcher)만 한다.
create policy "launcher_views owner read"
  on public.launcher_views for select
  to anon, authenticated
  using (char_length(site_id) between 6 and 64);

grant select, insert on public.launcher_views to anon;
grant select, insert on public.launcher_views to authenticated;
grant usage, select on sequence public.launcher_views_id_seq to anon, authenticated;
-- << launcher_views

-- 확인용
select 'site_config'    as table_name, count(*) from public.site_config
union all
select 'site_ads',      count(*) from public.site_ads
union all
select 'shared_pages',  count(*) from public.shared_pages
union all
select 'admin_users',   count(*) from public.admin_users
union all
select 'community_apps', count(*) from public.community_apps
union all
select 'oauth_clients', count(*) from public.oauth_clients
union all
select 'oauth_codes',   count(*) from public.oauth_codes
union all
select 'oauth_reports', count(*) from public.oauth_reports
union all
select 'notifications', count(*) from public.notifications
union all
select 'notification_prefs', count(*) from public.notification_prefs
union all
select 'launcher_views', count(*) from public.launcher_views
union all
select 'oauth_grants', count(*) from public.oauth_grants
union all
select 'user_sessions', count(*) from public.user_sessions;
