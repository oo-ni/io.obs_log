# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A personal tech blog: posts are written in Obsidian and published to a static Astro site (`output: static`). Deployed on Vercel (git-connected; push to `main` → auto build & deploy). Live at `ondl.site`.

## Commands

```bash
npm run dev      # dev server at http://localhost:4321 (live reload)
npm run build    # astro build && pagefind --site dist  (production)
npm run preview  # serve the built dist/ locally
npm run sync     # node sync.mjs — pull publish:true posts from the Obsidian Vault
npm run post     # sync + git add -A + commit + push (triggers Vercel deploy)
npx astro check  # type-check .astro / .ts (no separate lint or test setup exists)
```

- **Search only works after a production build** (`build` then `preview`). `npm run dev` has no Pagefind index, so the search page shows a notice.
- **AI summaries**: `ANTHROPIC_API_KEY=sk-ant-... npm run sync` enables LLM-generated `description`s (see Content pipeline). Without the key, sync still works (falls back to body text).
- There are no automated tests; verify changes by building and/or running the dev server.

## Content pipeline (sync.mjs)

`sync.mjs` is a dependency-free Node script that scans the Obsidian Vault and regenerates blog content. Vault path resolves as: CLI arg → `OBSIDIAN_VAULT` env var → `~/Obsidian Vault`. Key behavior:

- **Only `publish: true` posts are synced.** Everything else is ignored.
- **Generated, do-not-edit-by-hand**: `src/content/posts/*.md` and `public/attachments/*` are **wiped and rewritten on every sync**. Edit posts in Obsidian, not here.
- **Hierarchical category = `domain` + `stack[0]`** joined with `/` (e.g. `domain: Computer Science` + `stack: [Design Pattern]` → `Computer Science/Design Pattern`). An explicit `category` field overrides this. `tags` are a separate axis and never appear in the category tree.
- **Obsidian syntax conversion**: `![[img.png]]` → `![](/attachments/img.png)` (image copied to `public/attachments/`); `[[Note|alias]]` → a link if the target is a published post, otherwise plain text.
- **`description`**: manual value wins → else LLM summary via Claude Haiku (`claude-haiku-4-5`, called with raw `fetch`, no SDK) → else the body's opening text. LLM results are cached by content hash in `.summary-cache.json`, so unchanged posts are never re-summarized.

## Architecture

- **Layout** ([src/layouts/Base.astro](src/layouts/Base.astro)) takes a `sidebar` prop. `true` (default) → two-column grid with the category sidebar; `false` → centered `.prose-wrap` (used by home, post detail, search). All pages share the sticky header, footer, fonts, theme script, and View Transitions here.
- **Hierarchical categories** ([src/lib/categories.ts](src/lib/categories.ts)): `buildTree()` parses each post's `category` string (split on `/`) into a nested tree where a parent's count includes its children; `allCategoryPaths()` enumerates every node (parent and leaf) with its subtree's posts. Rendered recursively by [CategoryTree.astro](src/components/CategoryTree.astro) via `Astro.self`, and routed by `pages/categories/[...category].astro` (rest param → multi-segment paths).
- **Pages**: `/` is a landing page (intro + recent posts), `/posts` is the full list. `[...slug].astro` is post detail; tags and `archives` (year/month) are derived from the collection. Content schema is in [src/content.config.ts](src/content.config.ts).
- **Search**: Pagefind. The build command appends `pagefind --site dist`. Only post bodies are indexed — `data-pagefind-body` is on the post `<article>`, and `data-pagefind-ignore` is on the header, sidebar, and footer.
- **Comments**: Cusdis ([src/components/Comments.astro](src/components/Comments.astro)) — set `appId` there.

### View Transitions gotcha (important)

`<ClientRouter />` is enabled, so navigation swaps `<body>` without a full reload. **Do not attach one-time inline event listeners to elements** — they're lost on navigation. Instead:

- Bind interactive behavior via **event delegation on `document`** (theme toggle, mobile menu in Base.astro) or re-initialize on the **`astro:page-load`** event (search, comments).
- The theme (`<html data-theme>`) is re-applied from `localStorage` on **`astro:after-swap`** to prevent a flash/reset on navigation. Keep that handler when touching theme code.
- Dark-mode toggle uses `document.startViewTransition` for a circular reveal, scoped with a temporary `.theme-vt` class so it doesn't affect normal page transitions.

## Design system ([src/styles/global.css](src/styles/global.css))

All tokens are CSS variables. Three fonts, applied by role (don't change the body default without checking the per-element overrides near the top of the file):

- `--font-app` **Google Sans Code** — self-hosted via Astro Fonts API (`fonts` in [astro.config.mjs](astro.config.mjs) + `<Font>` in Base.astro). Used for header, sidebar profile, card category/tags, chips, code, home intro.
- `--font-serif` **Noto Serif KR** — the `body` default (post body, card excerpts).
- `--font-sans` **Pretendard** — page/post/card titles, headings, Categories, archive, footer.

Other notes: colors are AstroPaper light/dark tokens switched via `<html data-theme="light|dark">`; syntax highlighting is **disabled** (`markdown.syntaxHighlight: false`) so code renders in the single `--code` color; in-body links use a dashed underline, active nav uses a wavy one; `-webkit-font-smoothing` is intentionally left at default.
