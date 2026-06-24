import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// posts 컬렉션: sync 스크립트가 src/content/posts/*.md 로 정규화해 넣는다.
const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    category: z.string().optional(),
    description: z.string().optional(),
    showSummary: z.boolean().default(false),
    aiSummary: z.boolean().default(false),
  }),
});

export const collections = { posts };
