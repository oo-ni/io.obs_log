-- ============================================================================
-- 블로그 댓글 시스템 스키마 (Supabase / PostgreSQL)
-- 대시보드 SQL Editor 에 통째로 실행하면 처음부터 구성됨. (재실행 안전하게 작성)
-- 브라우저가 supabase-js 로 직접 접근하고, 보안은 RLS + security definer 함수가 담당.
-- ============================================================================

-- ── 댓글 테이블 ─────────────────────────────────────────────────────────────
create table if not exists public.comments (
  id            bigint generated always as identity primary key,
  post_slug     text        not null,
  parent_id     bigint      references public.comments(id) on delete cascade, -- 대댓글
  user_id       uuid        not null references auth.users(id) on delete cascade,
  author_name   text        not null,
  author_avatar text,
  body          text        not null check (char_length(body) between 1 and 2000),
  is_secret     boolean     not null default false,  -- 비밀댓글
  created_at    timestamptz not null default now()
);
-- 기존 테이블에 컬럼만 추가하는 경우 대비
alter table public.comments add column if not exists is_secret boolean not null default false;

create index if not exists comments_post_slug_created_idx
  on public.comments (post_slug, created_at);

-- ── 관리자(블로그 주인) 테이블 ──────────────────────────────────────────────
-- 정책 없음 → 클라이언트가 직접 조회 불가. security definer 함수만 참조.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;

-- 관리자 여부 판별 (security definer: admins 테이블을 RLS 우회로 조회)
create or replace function public.is_admin(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = uid);
$$;

-- 현재 로그인 사용자가 관리자인지 (클라이언트에서 rpc 로 호출)
create or replace function public.is_current_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin(auth.uid());
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.comments enable row level security;

-- SELECT: 비밀댓글은 작성자/관리자만. (원본 테이블 직접 read 방어 — 실제 표시는 get_comments 사용)
drop policy if exists "read all"     on public.comments;
drop policy if exists "read visible" on public.comments;
create policy "read visible" on public.comments for select
  using (not is_secret or auth.uid() = user_id or public.is_admin(auth.uid()));

-- INSERT: 로그인 사용자가 본인 user_id 로만
drop policy if exists "insert own" on public.comments;
create policy "insert own" on public.comments for insert to authenticated
  with check (auth.uid() = user_id);

-- DELETE: 본인 또는 관리자(모더레이션)
drop policy if exists "delete own"          on public.comments;
drop policy if exists "delete own or admin" on public.comments;
create policy "delete own or admin" on public.comments for delete to authenticated
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

-- ── 마스킹 조회 함수 ────────────────────────────────────────────────────────
-- 비밀댓글이고 볼 권한이 없으면 작성자/본문/작성자ID 를 null 로 가려서 반환.
-- security definer 라 RLS 를 우회해 전체를 보되, 함수가 직접 마스킹하므로 안전.
create or replace function public.get_comments(p_slug text)
returns table (
  id            bigint,
  parent_id     bigint,
  user_id       uuid,
  author_name   text,
  author_avatar text,
  body          text,
  created_at    timestamptz,
  is_secret     boolean,
  can_view      boolean
)
language sql stable security definer set search_path = public
as $$
  select
    c.id,
    c.parent_id,
    case when v.ok then c.user_id       end,
    case when v.ok then c.author_name   end,
    case when v.ok then c.author_avatar end,
    case when v.ok then c.body          end,
    c.created_at,
    c.is_secret,
    v.ok
  from public.comments c
  cross join lateral (
    select (not c.is_secret
            or auth.uid() = c.user_id
            or public.is_admin(auth.uid())) as ok
  ) v
  where c.post_slug = p_slug
  order by c.created_at;
$$;

grant execute on function public.get_comments(text)  to anon, authenticated;
grant execute on function public.is_current_admin()  to anon, authenticated;

-- ── 스팸/어뷰징 방어 (INSERT 트리거) ────────────────────────────────────────
create or replace function public.check_comment_rate()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  recent_count int;
  last_at      timestamptz;
  link_count   int;
begin
  select count(*), max(created_at) into recent_count, last_at
    from public.comments
    where user_id = new.user_id and created_at > now() - interval '1 minute';

  if recent_count >= 5 then
    raise exception '댓글을 너무 빠르게 작성하고 있습니다. 잠시 후 다시 시도해주세요.';
  end if;
  if last_at is not null and last_at > now() - interval '5 seconds' then
    raise exception '조금 천천히 작성해주세요. (연속 작성 제한)';
  end if;

  -- 본문 내 'http' 4자 등장 횟수로 링크 개수 근사 → 3개 초과 차단
  link_count := (length(new.body) - length(replace(lower(new.body), 'http', ''))) / 4;
  if link_count > 3 then
    raise exception '링크가 너무 많습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists comment_rate_limit on public.comments;
create trigger comment_rate_limit
  before insert on public.comments
  for each row execute function public.check_comment_rate();

-- ── 관리자 등록 (본인 계정으로 최초 1회) ────────────────────────────────────
-- 먼저 각 소셜로 한 번씩 로그인해 auth.users 에 계정이 생긴 뒤 실행.
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'gdbsrjsdn@gmail.com'
--   on conflict do nothing;
