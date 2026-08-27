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
import { promises as fs, readFileSync } from "node:fs";
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

// 이미지 파일 헤더에서 가로세로 비율(w/h) 판독. 한 줄 여러 장을 같은 높이로 정렬할 때 사용.
// png/jpeg/gif/webp 지원, 판독 실패(svg/avif 등)는 null → 호출부에서 폴백.
const _arCache = new Map();
function aspectOf(file) {
  if (_arCache.has(file)) return _arCache.get(file);
  let ar = null;
  try {
    const b = readFileSync(file);
    let w, h;
    if (b.readUInt32BE(0) === 0x89504e47) {            // PNG
      w = b.readUInt32BE(16); h = b.readUInt32BE(20);
    } else if (b.toString("ascii", 0, 3) === "GIF") {  // GIF
      w = b.readUInt16LE(6); h = b.readUInt16LE(8);
    } else if (b[0] === 0xff && b[1] === 0xd8) {        // JPEG: SOF 마커 탐색
      let o = 2;
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) { o++; continue; }
        const m = b[o + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          h = b.readUInt16BE(o + 5); w = b.readUInt16BE(o + 7); break;
        }
        o += 2 + b.readUInt16BE(o + 2);
      }
    } else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const fmt = b.toString("ascii", 12, 16);
      if (fmt === "VP8 ") { w = b.readUInt16LE(26) & 0x3fff; h = b.readUInt16LE(28) & 0x3fff; }
      else if (fmt === "VP8L") {
        const n = b.readUInt32LE(21);
        w = (n & 0x3fff) + 1; h = ((n >> 14) & 0x3fff) + 1;
      } else if (fmt === "VP8X") {
        w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
        h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      }
    }
    if (w > 0 && h > 0) ar = w / h;
  } catch { /* 판독 실패 → null */ }
  _arCache.set(file, ar);
  return ar;
}

// LLM 요약 (Claude Haiku). ANTHROPIC_API_KEY 없으면 비활성 → 본문 앞부분 폴백.
const AI_MODEL = "claude-haiku-4-5";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

async function llmSummarize(text) {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
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
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`   ⚠️ 요약 실패(HTTP ${res.status}): ${errText.slice(0, 300)}`);
      return null;
    }
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

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 옵시디언 콜아웃 타입 → 아이콘(노션풍). 미정의 타입은 note로 폴백.
const CALLOUT_ICONS = {
  note: "🗒️", abstract: "📋", summary: "📋", tldr: "📋",
  info: "ℹ️", todo: "✅", tip: "💡", hint: "💡", important: "💡",
  success: "✅", check: "✅", done: "✅",
  question: "❓", help: "❓", faq: "❓",
  warning: "⚠️", caution: "⚠️", attention: "⚠️",
  failure: "❌", fail: "❌", missing: "❌",
  danger: "🚫", error: "🚫", bug: "🐛",
  example: "📑", quote: "💬", cite: "💬",
};

/**
 * 옵시디언 콜아웃(`> [!type]+ 제목` + `> 본문...`)을
 * 노션풍 콜아웃 HTML(제목/본문)로 변환.
 * 본문은 앞뒤 빈 줄로 감싸 HTML 블록 안에서도 마크다운이 렌더되게 한다.
 */
function transformCallouts(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^>\s*\[!(\w+)\]([+-]?)\s*(.*)$/);
    if (!head) { out.push(lines[i]); continue; }
    const type = head[1].toLowerCase();
    // 제목: `<br>`(빈 제목 용도) 는 제거. 남은 게 없으면 제목줄 자체를 생략(제목 없는 콜아웃).
    const title = head[3].replace(/<br\s*\/?>/gi, "").trim();
    // 이어지는 인용 라인(`>`)을 본문으로 수집
    const bodyLines = [];
    let j = i + 1;
    for (; j < lines.length && /^>/.test(lines[j]); j++) {
      bodyLines.push(lines[j].replace(/^>\s?/, ""));
    }
    // 옵시디언에서 본문에 `>`를 안 붙인 경우: 헤더 바로 다음의 비인용 문단(빈 줄/다음 블록 전까지)도
    // 콜아웃 본문으로 흡수 → `>[!note] <br>` + 다음 줄 텍스트 = 제목 없는 콜아웃 박스 안의 본문.
    if (bodyLines.length === 0) {
      for (; j < lines.length; j++) {
        if (lines[j].trim() === "" || /^\s*(#|>|`{3,}|~{3,})/.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }
    }
    i = j - 1;
    const icon = CALLOUT_ICONS[type] || CALLOUT_ICONS.note;
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(`<div class="callout-box" data-callout="${type}">`);
    if (title) {
      out.push(`<div class="callout-box-title"><span class="callout-box-icon">${icon}</span>${escapeHtml(title)}</div>`);
    }
    if (bodyLines.some((l) => l.trim() !== "")) {
      out.push("");
      out.push(...bodyLines);
      out.push("");
    }
    out.push(`</div>`);
    out.push("");
  }
  return out.join("\n");
}

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

    // 펜스 코드블록 언어 식별자 소문자화 (```Kotlin → ```kotlin).
    // Shiki 언어 ID는 소문자라 대문자면 plaintext로 떨어진다.
    body = body.replace(/^(\s*`{3,}|\s*~{3,})([A-Za-z][\w+#-]*)/gm, (m, fence, lang) => fence + lang.toLowerCase());

    // 2-0) 옵시디언 콜아웃 → 노션풍 콜아웃 HTML.
    //      이미지 변환보다 먼저 실행: 콜아웃 본문을 평문으로 펼쳐야, 뒤에서 이미지를
    //      빈 줄로 감싸도 `>` 인용 그룹핑이 깨지지 않는다.
    body = transformCallouts(body);

    // 2-1) 이미지 임베드 ![[img.ext|size]] → <img>. 사이즈(|260, |260x180)는 width/height로 반영.
    //      한 줄에 여러 장이 붙어 있으면 .img-row 로 감싸 가로로 나란히 배치한다.
    //      raw HTML 뒤 텍스트가 마크다운으로 처리되도록 앞뒤 빈 줄로 분리한다(**굵게**·`코드` 인식).
    body = body.replace(/(?:!\[\[[^\]]*?\]\][ \t]*)+/g, (run) => {
      const imgs = [];
      for (const [, target, size] of run.matchAll(/!\[\[([^\]|#]+?)(?:\|([^\]]*))?\]\]/g)) {
        const name = path.basename(target.trim());
        if (!IMG_EXT.test(name)) continue; // 노트 임베드는 제거(추후 처리)
        usedAttachments.add(name);
        const src = `/attachments/${encodeURIComponent(name)}`;
        const w = size && (size.trim().match(/^(\d+)/) || [])[1]; // 옵시디언 지정 폭(폴백용)
        const ar = attachByName.has(name) ? aspectOf(attachByName.get(name)) : null; // 실제 가로세로 비율
        imgs.push({ src, w, ar });
      }
      if (imgs.length === 0) return "";
      // 한 장: 지정 폭을 그대로 반영(본문보다 크면 100%로 축소).
      if (imgs.length === 1) {
        const { src, w } = imgs[0];
        return `\n\n<img src="${src}" alt=""${w ? ` width="${w}"` : ""} />\n\n`;
      }
      // 여러 장: flex-grow 를 '가로세로 비율'로 주면 → 같은 높이로 정렬되며 본문 너비를 꽉 채움.
      //         비율 판독 실패 시 옵시디언 지정 폭으로 폴백.
      const cells = imgs
        .map(({ src, w, ar }) => {
          const g = ar ? ar.toFixed(4) : w;
          return `<img src="${src}" alt=""${g ? ` style="flex-grow:${g}"` : ""} />`;
        })
        .join("");
      return `\n\n<div class="img-row">${cells}</div>\n\n`;
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
    // showSummary: 콜아웃으로 노출할 "진짜 요약"인지(수동/AI=true, 폴백=false)
    // aiSummary:   그 요약이 LLM 생성인지(콜아웃 라벨 "AI Summary" 구분용)
    let description = field(p.fm, "description") || "";
    let showSummary = !!description; // 수동 작성 description 이면 콜아웃 노출
    let aiSummary = false;
    if (!description) {
      const h = hash(body);
      if (cache[h]) {
        description = cache[h]; aiSummary = true; showSummary = true;
      } else {
        const ai = await llmSummarize(body);
        if (ai) { cache[h] = ai; aiCount++; description = ai; aiSummary = true; showSummary = true; }
        else description = fallbackDesc(body); // 폴백은 메타용일 뿐, 콜아웃 X
      }
    }
    const fmOut =
      `---\n` +
      `title: ${JSON.stringify(p.title)}\n` +
      (date ? `date: ${date}\n` : "") +
      `tags: ${yamlList(tags)}\n` +
      (category ? `category: ${JSON.stringify(category)}\n` : "") +
      (description ? `description: ${JSON.stringify(description)}\n` : "") +
      (showSummary ? `showSummary: true\n` : "") +
      (aiSummary ? `aiSummary: true\n` : "") +
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
