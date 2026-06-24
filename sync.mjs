#!/usr/bin/env node
/**
 * Obsidian Vault → Astro 콘텐츠 동기화
 * - publish: true 인 글만 src/content/posts/<slug>.md 로 정규화 복사
 * - Obsidian 문법을 표준 마크다운으로 변환:
 *     ![[img.png]]      → ![](/attachments/img.png)  (+ public/attachments 로 복사)
 *     [[Note|alias]]    → [alias](/posts/slug)        (발행된 글이면 링크, 아니면 텍스트)
 * - frontmatter 정규화: title / date / tags / category / description
 * - description: 수동 값 우선, 없으면 LLM(Claude Haiku) 요약 → 본문 앞부분 폴백.
 *   LLM 요약은 ANTHROPIC_API_KEY 환경변수가 있을 때만 동작하고,
 *   본문 해시 기준으로 .summary-cache.json 에 캐시(안 바뀐 글은 재호출 안 함).
 *
 * 사용: node sync.mjs
 *   Vault 경로: 인자 > OBSIDIAN_VAULT 환경변수 > ~/Obsidian Vault
 *     node sync.mjs "/경로"   또는   OBSIDIAN_VAULT="/경로" node sync.mjs
 *   AI 요약: ANTHROPIC_API_KEY=... node sync.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// Vault 경로: CLI 인자 > OBSIDIAN_VAULT 환경변수 > 홈 디렉터리의 "Obsidian Vault"
const VAULT =
  process.argv[2] || process.env.OBSIDIAN_VAULT || path.join(os.homedir(), "Obsidian Vault");
const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "src/content/posts");
const ATTACH_DIR = path.join(ROOT, "public/attachments");
const CACHE_FILE = path.join(ROOT, ".summary-cache.json");
const SKIP_DIRS = new Set([".git", ".obsidian", "_templates", "node_modules"]);
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

// LLM 요약 (Claude Haiku). ANTHROPIC_API_KEY 없으면 비활성 → 본문 앞부분 폴백.
const AI_MODEL = "claude-haiku-4-5";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

async function llmSummarize(text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const prompt =
    "다음 블로그 글을 한국어로 2문장 이내로 요약해줘. 핵심만 간결하게, 군더더기·머리말 없이. " +
    "글에 없는 내용은 절대 지어내지 말 것. 요약문만 출력:\n\n---\n" +
    text.slice(0, 12000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) { console.warn(`   ⚠️ 요약 실패(HTTP ${res.status})`); return null; }
    const data = await res.json();
    const out = (data.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return out || null;
  } catch (e) { console.warn(`   ⚠️ 요약 오류: ${e.message}`); return null; }
}

async function walk(dir, acc = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const fmOf = (t) => (t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || null;
const bodyOf = (t) => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
const field = (fm, k) => (fm.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const isPublished = (fm) => !!fm && /^\s*publish:\s*true\s*$/m.test(fm);

// frontmatter 의 리스트 필드 파싱 (인라인 [a, b] / 블록 - a\n - b 모두 지원)
function parseList(fm, key) {
  const inline = fm.match(new RegExp(`^\\s*${key}:\\s*\\[(.*)\\]\\s*$`, "m"));
  if (inline) return inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const block = fm.match(new RegExp(`^\\s*${key}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`, "m"));
  if (block) return block[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return [];
}
const parseTags = (fm) => parseList(fm, "tags");

const slugify = (name) =>
  name.toLowerCase().trim()
    .replace(/[^\w가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const yamlList = (arr) => "[" + arr.map((t) => JSON.stringify(t)).join(", ") + "]";

async function rmrf(p) { await fs.rm(p, { recursive: true, force: true }); }

async function main() {
  const files = await walk(VAULT);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  // 1) 발행 글 수집 + 슬러그 맵
  const published = [];
  for (const f of mdFiles) {
    const text = await fs.readFile(f, "utf8");
    const fm = fmOf(text);
    if (!isPublished(fm)) continue;
    const base = path.basename(f, ".md");
    const title = field(fm, "title") || base;
    published.push({ f, fm, text, base, title, slug: slugify(base) });
  }
  const slugByName = new Map(published.map((p) => [p.base, p.slug]));
  const attachByName = new Map(files.map((f) => [path.basename(f), f]));

  // 2) 출력 폴더 초기화
  await rmrf(POSTS_DIR); await fs.mkdir(POSTS_DIR, { recursive: true });
  await rmrf(ATTACH_DIR); await fs.mkdir(ATTACH_DIR, { recursive: true });

  // 요약 캐시 로드 (본문 해시 → 요약). 안 바뀐 글은 LLM 재호출 안 함.
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")); } catch {}
  let aiCount = 0;

  // 본문 앞부분에서 description 폴백 생성
  const fallbackDesc = (body) =>
    body
      .replace(/```[\s\S]*?```/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[#>*_`~|-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 130);

  const usedAttachments = new Set();

  for (const p of published) {
    let body = bodyOf(p.text);

    // 2-1) 이미지 임베드 ![[img.ext|size]] → ![](/attachments/img.ext)
    body = body.replace(/!\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]/g, (m, target) => {
      const name = path.basename(target.trim());
      if (IMG_EXT.test(name)) { usedAttachments.add(name); return `![](/attachments/${encodeURIComponent(name)})`; }
      return ""; // 노트 임베드는 일단 제거(추후 처리)
    });

    // 2-2) 위키링크 [[Note|alias]] → 발행 글이면 링크, 아니면 텍스트
    body = body.replace(/\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, target, alias) => {
      const name = target.trim();
      const display = (alias || name).trim();
      const slug = slugByName.get(name);
      return slug ? `[${display}](/posts/${slug})` : display;
    });

    // 3) frontmatter 정규화
    const created = field(p.fm, "created") || "";
    const date = (created.match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
    const tags = parseTags(p.fm);
    // 계층 카테고리: domain(1단계) + stack[0](2단계) 으로 "A/B" 경로 생성.
    // 명시적 category 필드가 있으면 그걸 우선 사용.
    const domain = field(p.fm, "domain") || "";
    const stack = parseList(p.fm, "stack");
    const category =
      field(p.fm, "category") || [domain, stack[0]].filter(Boolean).join("/");
    // description: 수동 우선 → LLM 요약(해시 캐시) → 본문 앞부분 폴백
    let description = field(p.fm, "description") || "";
    if (!description) {
      const h = hash(body);
      if (cache[h]) {
        description = cache[h];
      } else {
        const ai = await llmSummarize(body);
        if (ai) { cache[h] = ai; aiCount++; description = ai; }
        else description = fallbackDesc(body);
      }
    }
    const fmOut =
      `---\n` +
      `title: ${JSON.stringify(p.title)}\n` +
      (date ? `date: ${date}\n` : "") +
      `tags: ${yamlList(tags)}\n` +
      (category ? `category: ${JSON.stringify(category)}\n` : "") +
      (description ? `description: ${JSON.stringify(description)}\n` : "") +
      `---\n\n`;

    await fs.writeFile(path.join(POSTS_DIR, `${p.slug}.md`), fmOut + body.trimStart(), "utf8");
  }

  // 4) 사용된 첨부 복사
  let copied = 0;
  for (const name of usedAttachments) {
    const src = attachByName.get(name);
    if (src) { await fs.copyFile(src, path.join(ATTACH_DIR, name)); copied++; }
  }

  // 요약 캐시 저장
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");

  console.log(`\n✅ 동기화 완료`);
  published.forEach((p) => console.log(`   - ${p.title}  →  /posts/${p.slug}`));
  console.log(`   글 ${published.length}개 · 첨부 ${copied}개 · AI 요약 ${aiCount}개 생성\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
