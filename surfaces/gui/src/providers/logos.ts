// Provider logo registry (UX-DECISIONS §39): official brand marks for the onboarding
// provider gallery, vendored from the MIT-licensed lobe-icons set (same
// bundled-asset posture as the connector registry — no CDN at runtime). Keys are
// /v1/providers names; unknown names get no mark (the gallery falls back to a
// neutral monogram). PROVIDER_ORDER is the gallery order — recognition first,
// long tail behind the scroll fold.

import anthropic from "./logos/anthropic.svg";
import openai from "./logos/openai.svg";
import gemini from "./logos/gemini.svg";
import ollama from "./logos/ollama.svg";
import fireworks from "./logos/fireworks.svg";
import together from "./logos/together.svg";
import zai from "./logos/zai.svg";
import kimi from "./logos/kimi.svg";
import deepseek from "./logos/deepseek.svg";
import mistral from "./logos/mistral.svg";
import qwen from "./logos/qwen.svg";
import minimax from "./logos/minimax.svg";
import xai from "./logos/xai.svg";
import meta from "./logos/meta.svg";
// 我们自己的标。lobe-icons 是第三方图标集，当然不会有它 —— 少了这一个，
// ProviderMark 会退回首字母，Qumge 那张卡上就只有一个灰色的 "Q"。
import qumge from "./logos/qumge.svg";

export const PROVIDER_LOGOS: Record<string, string> = {
  anthropic,
  openai,
  gemini,
  meta,
  ollama,
  fireworks,
  together,
  zai,
  kimi,
  deepseek,
  mistral,
  qwen,
  minimax,
  xai,
  qumge,
};

export const PROVIDER_ORDER = [
  // 自家网关排第一：这个顺序的原则是"先放认得出的"，
  // 而 Marlo 的用户是从 qumge.com 下载来的。
  "qumge",
  "anthropic",
  "openai",
  "gemini",
  "meta",
  "ollama",
  "fireworks",
  "together",
  "zai",
  "kimi",
  "deepseek",
  "mistral",
  "qwen",
  "minimax",
  "xai",
];

export function providerRank(name: string): number {
  const i = PROVIDER_ORDER.indexOf(name);
  return i === -1 ? PROVIDER_ORDER.length : i;
}
