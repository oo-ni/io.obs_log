// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: "https://ondl.site",
  // 펜스 코드블록(```java 등)은 Shiki로 언어별 구문강조. 다크/라이트 듀얼 테마.
  markdown: {
    syntaxHighlight: "shiki",
    // defaultColor:false → 토큰에 --shiki-light/--shiki-dark 변수만 출력.
    // light/dark 색 적용을 전적으로 CSS(global.css)에서 제어 → 다크모드 토글이 확실.
    shikiConfig: { themes: { light: "github-light", dark: "github-dark" }, defaultColor: false },
  },
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
