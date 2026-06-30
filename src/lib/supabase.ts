import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/** 설정돼 있으면 Supabase 클라이언트, 아니면 null */
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

/** 소셜 프로필에서 표시 이름과 아바타를 추출 */
export function profileFrom(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): { name: string; avatar: string | null } {
  const m = user.user_metadata ?? {};
  const name =
    (m.full_name as string) ||
    (m.name as string) ||
    (m.user_name as string) || // GitHub
    (m.preferred_username as string) ||
    user.email?.split("@")[0] ||
    "익명";
  const avatarRaw =
    (m.avatar_url as string) || (m.picture as string) || null; // Google=picture
  const avatar =
    typeof avatarRaw === "string" && avatarRaw.startsWith("https://")
      ? avatarRaw
      : null;
  return { name, avatar };
}
