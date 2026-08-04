import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { i18nText } from "./i18n-transform";

// Standalone test config (kept separate from vite.config.ts so the production `vite build` is
// untouched). Reused by later frontend phases — add new `*.test.tsx` files under src/.
//
// 【i18nText 必须在这里，顺序也要和 vite.config.ts 一致】（2026-08-04 加）
// 在这之前测试跑的是【没经过 i18n 改写的】源码：上游 JSX 里的英文原样渲染，
// 而生产构建里它们会被包进 tx() 再查表。于是 no-english.ts 那把"渲染出来还有没有
// 英文"的尺子，从来没量到过这条路 —— 三个组件的 englishRunsIn 断言全绿，而真实
// 界面上 clear / › Tools / enabled 一直是英文。测试跑的东西和用户拿到的东西不是
// 一个，绿灯就只是绿灯。
//
// 对现有测试无影响：它们默认 locale=en，而 tx() 在 en 下原样返回英文。
export default defineConfig({
  plugins: [i18nText(), react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
