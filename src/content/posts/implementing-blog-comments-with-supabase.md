---
title: "Implementing Blog Comments with Supabase"
date: 2026-06-30
tags: ["Blog", "Astro", "Supabase"]
category: "Backend/Astro"
description: "Static 블로그에서의 댓글 현재 개발중인 블로그는 빌드 시점에 Astro가 모든 페이지를 미리 HTML 파일로 구워두고, Vercel로 해당 정적 파일을 뿌려주기만 하는 방식입니다. Giscus로 \"서버 + DB + 로그인을\" G"
---

# Static 블로그에서의 댓글
현재 개발중인 블로그는 빌드 시점에 Astro가 모든 페이지를 미리 HTML 파일로 구워두고, Vercel로 해당 정적 파일을 뿌려주기만 하는 방식입니다.

Giscus로 "서버 + DB + 로그인을" GitHub 의존으로 처리하고 있지만, GitHub 계정이 없는 사람도 있을 것이기에(물론 개발자라면 있겠지만 개발 글만 올리고 싶지는 않아서)... 그리고 절대적으로 디자인이 안예쁘고 가독성이 떨어져서!! 커스텀 동적 댓글 기능을 만들고 싶었습니다.


# Serverless Functions
"댓글 기능 하나 넣자고 서버를 만들고, 언제 누가 쓸지 모르는 댓글 하나 때문에 서버를 24시간 켜둬야 할까?" 
→ 때문에 서버리스를 넣었습니다. 다음과 같은 기능을 원했어요.

- 평소엔 아무것도 안돌아감
- 누군가 POST 같은 요청을 보내야만 함수가 실행되고, 응답주고, 다시 잠듦
- 정적 사이트에 함수 몇 개만 동적으로 끼워넣을 수 있음

Astro는 이걸 "API 엔드포인트"라는 이름으로 지원합니다. `comments.ts`같은 파일을 만들고 `GET`/`POST` 함수를 export 하면, 빌드 시 Vercel이 이걸 서버리스 함수로 변환해줍니다.


# 정적인데 함수를 쓴다..?
여기서 한 가지 설정 개념이 필요한데, 지금은 `output: static`이라 100% 정적인 상태입니다.
때문에 페이지들은 정적으로 올리되, `/api/*` 파일들만 서버(함수)로 동작시키는 것이 필요합니다. Astro에서는 페이지별로 `export const prerender = true/false` 로 켜고 끌 수 있습니다. 

그래서 블로그 글은  전부 `pretender = true`, API만 `false`.

이때 `@astrojs/vercel` 어댑터를 설치해야 합니다. 어댑터는 **Astro가 만든 서버 코드를 Vercel이 이해하는 서버리스 함수 형식으로 번역해주는 플러그인** 역할을 합니다.


# 데이터베이스
댓글을 저장할 공간이 필요합니다. 결국 서버를 띄우긴 해야하는건데, 처음 했던 고민처럼 댓글 하나 넣자고 서버 구축은 너무 귀찮으니까 Supabase를 활용해보기로 했습니다.

Supabase는 오픈소스 기반 BaaS(Backend-as-a-Service) 플랫폼입니다.
- PostgreSQL 기반 RDB
- 자동 API 생성 (REST, GraphQL)
- 인증, 스토리지 등의 통합 백엔드 기능
- AI 앱 개발 최적화 (pgvector 벡터 확장)

대놓고 프론트에 집중하라고 만든 기능인 만큼, API 개발부터 DB 구축까지 단일 플랫폼에서 모두 지원해줍니다. 제일 맘에 들었던건 간편한 Authentication 기능. 이 부분은 아래에서 추가로 설명하겠습니다.

Vercel KV 같은 Redis 기반 키-값 저장소도 고려했지만, 결국 댓글 데이터는 유저 데이터가 포함될 수밖에 없는 구조라 RDB로 관리하는게 복잡도가 낮아보여 Supabase Postsgre를 선택했습니다.
![](/attachments/be_blog_spbs_3.png)


# 인증
댓글 수정, 삭제 기능은 있어야 할 것 같아서, 누가 썼는지를 보장하기 위해 인증 시스템을 도입해야 했습니다.
Supabase에 등록된 소셜로그인 Providers 중 Google과 Kakao, GitHub를 선택하여 소셜로그인을 구현하기로 했습니다.
![](/attachments/be_blog_spbs_1.png)
![](/attachments/be_blog_spbs_2.png)
**Supabase Auth** 기능을 활용하면, 코드 몇 줄로 OAuth 흐름을 구현할 수 있습니다.

Auth 클라이언트를 설정하고,
```typescript
export function getSupabase(): SupabaseClient | null {
	if (!isSupabaseConfigured) return null;
	if (!client) {
		client = createClient(url!, anonKey!, {
			auth: {
				persistSession: true, // 로그인 유지 (localStorage)
				detectSessionInUrl: true, // OAuth 리다이렉트 복귀 시 세션 자동 파싱
				autoRefreshToken: true,
			},
		});
	}
	return client;
}
```
OAuth 로그인을 수행합니다.
```typescript
b.onclick = () =>
	sb.auth.signInWithOAuth({
		provider: p.id as any,
		options: { redirectTo: window.location.href },
	});
```
세션 읽기(`getSession()`)로 현재 로그인 사용자를 확인하는데, 여기서 `me`로 이후 모든 분기처리를 수행했습니다.
```typescript
const {
	data: { session },
} = await sb.auth.getSession();
const me = session?.user ?? null;
```

코드로 OAuth 활성화 하는건 생각보다 어렵지 않았고, 오히려 품이 많이 들었던 부분은 Supabase Auth 대시보드에 GitHub, Google, Kakao 각각의 앱을 활성화 하고 클라이언트 정보를 하나하나 등록하는 부분이었습니다.

# 권한과 보안
Supabase의 PostgreSQL에는 <b>행 단위 보안(RLS, Row Level Security)</b>이라는 기능이 있습니다. DB 자체에 규칙을 박아두는 건데,
- "댓글 읽기는 누구나 가능"
- "댓글 쓰기는 로그인한 사람만"
- "댓글 삭제/수정은 작성자 본인만"

다음과 같은 설정을 DB 레벨에 걸어두면, API 코드에 실수가 있어도 DB단에서 방어가 됩니다. 댓글과 같은 사용자 데이터 기반 시스템을 설계할 때 참 좋은 기능이라고 생각합니다.

Supabase 대시보드의 SQL Editor에서 DDL로 RLS를 포함한 테이블 정의가 가능합니다.
```sql
create table public.comments (
  id            bigint generated always as identity primary key,
  post_slug     text        not null,
  parent_id     bigint      references public.comments(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  author_name   text        not null,
  author_avatar text,
  body          text        not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now()
);
create index comments_post_slug_created_idx on public.comments (post_slug, created_at);

alter table public.comments enable row level security;
create policy "read all"    on public.comments for select using (true);
create policy "insert own"  on public.comments for insert to authenticated with check (auth.uid() = user_id);
create policy "delete own"  on public.comments for delete to authenticated using (auth.uid() = user_id);
```

---
사실 여기까지면 기본적인 댓글 기능은 모두 구현했다고 봐도 무방한데, 있으면 좋겠다 싶은 기능을 추가하고 싶어서 
# 스팸 / 어뷰징 방어
사실 이 부분은 직접 관리해도 되지 않을까 했는데, 글이 많아지면 하나하나 관리하기도 힘들고, 무료라고는 하지만 500MB 한도가 있기 때문에 굳이 안만드는거 보다는 낫겠다 싶었습니다.
>[!Supabase 무료  플랜]+
> - 무제한 API 요청
> - 월 5만 명까지 활성 사용자 (MAU)
> - 500 MB 데이터베이스 용량
> - 공유 CPU, 500 MB RAM
> - 5 GB 대역폭
> - 1 GB 파일 스토리지
> - 커뮤니티 지원
> - 1주일 이상 미사용 시 프로젝트 일시 중단
> - 최대 2개 활성 프로젝트 제한

다음과 같은 규칙을 설정했습니다.
- 댓글 작성 시 로그인 필수 (사실 이것만 있어도 거의 다 걸러질 것 같긴 합니다)
- INSERT 트리거: 1분에 5개 초과 차단 / 직전 5초 내 연속 차단 / 링크(http) 3개 초과 차단

```sql
create or replace function public.check_comment_rate()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
	recent_count int;
	last_at timestamptz;
	link_count int;

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
```

# 비밀 댓글
비밀 댓글은 본문을 **실제로 못 읽게** 막아야 하므로, 클라이언트 필터가 아니라 **DB에서 마스킹**했습니다. 때문에 댓글 본문 조회는 기존 `.from('comments').select()`에서 `.rpc('get_comments')`호출로 교체했습니다.

비밀 댓글 기능은 공개 범위가 중요한데, `is_secret` 컬럼을 추가하고, <b>작성자 본인 + 블로그 주인(admin)</b>만 내용을 볼 수 있게 했습니다. `public.admins` 테이블을 추가하고 `security definer` 함수를 통해 관리자 여부를 판별하게 했습니다.

결론적으로 댓글 조회는 `rpc`+ RLS, insert/delete는 `.from()`+ RLS로 처리하는 구조가 완성되었습니다.

```sql
create or replace function public.get_comments(p_slug text)
returns table (
	id bigint,
	parent_id bigint,
	user_id uuid,
	author_name text,
	author_avatar text,
	body text,
	created_at timestamptz,
	is_secret boolean,
	can_view boolean
)
language sql stable security definer set search_path = public
as $$
	select
		c.id,
		c.parent_id,
		case when v.ok then c.user_id end,
		case when v.ok then c.author_name end,
		case when v.ok then c.author_avatar end,
		case when v.ok then c.body end,
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

grant execute on function public.get_comments(text) to anon, authenticated;
grant execute on function public.is_current_admin() to anon, authenticated;
```


### UI
![](/attachments/be_blog_spbs_4.png)
![](/attachments/be_blog_spbs_5.png)
## Reference
[Supabase Documentation, Auth](https://supabase.com/docs/guides/auth)
[Supabase Documentation, Database](https://supabase.com/docs/guides/database/connecting-to-postgres)
[Jane_Log, Supabase란 무엇인가!](https://velog.io/@hamjw0122/Supabase%EB%9E%80-%EB%AC%B4%EC%97%87%EC%9D%B8%EA%B0%80)
[Logto, AI 스타트업이 Supabase 를 선택하는 이유와 한계점](https://blog.logto.io/ko/supabase-ai-limitation)