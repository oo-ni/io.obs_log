// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: "https://ondl.site",
  markdown: { syntaxHighlight: false },
  // Font 자체 호스팅
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Google Sans Code",
      cssVariable: "--font-google-sans-code",
      weights: [400, 500, 600, 700],
      styles: ["normal"],
    },
  ],
});
