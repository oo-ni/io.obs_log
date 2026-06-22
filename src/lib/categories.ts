import type { CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;

export type CatNode = {
  name: string;        // 표시용 세그먼트 이름 (예: "Redis")
  path: string[];      // 전체 경로 (예: ["Backend", "Redis"])
  slug: string;        // URL 슬러그 (예: "backend/redis")
  count: number;       // 서브트리 전체 글 수 (자식 포함)
  children: CatNode[];
};

const seg = (s: string) => s.trim();

/** 경로 세그먼트 배열 → URL 슬러그 ("Backend/Redis" → "backend/redis") */
export const catSlug = (parts: string[]) =>
  parts.map((p) => p.toLowerCase().replace(/\s+/g, "-")).join("/");

/** category 문자열("A/B/C")을 세그먼트 배열로 */
const parseCat = (cat?: string) =>
  (cat ?? "").split("/").map(seg).filter(Boolean);

/** 전체 글에서 계층 카테고리 트리를 만든다. 각 노드 count는 서브트리 글 수. */
export function buildTree(posts: Post[]): CatNode[] {
  const root: CatNode[] = [];
  for (const p of posts) {
    const parts = parseCat(p.data.category);
    if (parts.length === 0) continue;
    let level = root;
    const acc: string[] = [];
    for (const part of parts) {
      acc.push(part);
      let node = level.find((n) => n.name === part);
      if (!node) {
        node = { name: part, path: [...acc], slug: catSlug([...acc]), count: 0, children: [] };
        level.push(node);
      }
      node.count++;
      level = node.children;
    }
  }
  const sortRec = (nodes: CatNode[]) => {
    nodes.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(root);
  return root;
}

/** 카테고리 페이지용: 모든 노드(부모 포함)와 그 서브트리에 속한 글 목록 */
export function allCategoryPaths(posts: Post[]) {
  const map = new Map<string, { parts: string[]; posts: Set<Post> }>();
  for (const p of posts) {
    const parts = parseCat(p.data.category);
    const acc: string[] = [];
    for (const part of parts) {
      acc.push(part);
      const slug = catSlug([...acc]);
      if (!map.has(slug)) map.set(slug, { parts: [...acc], posts: new Set() });
      map.get(slug)!.posts.add(p);
    }
  }
  return [...map.values()].map((v) => ({
    parts: v.parts,
    slug: catSlug(v.parts),
    posts: [...v.posts].sort(
      (a, b) => (b.data.date?.valueOf() ?? 0) - (a.data.date?.valueOf() ?? 0)
    ),
  }));
}
