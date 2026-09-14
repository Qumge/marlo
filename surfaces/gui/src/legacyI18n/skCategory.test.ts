import { describe, it, expect } from "vitest";
import { en, EN_CATEGORY } from "./en";
import { zh, ZH_CATEGORY } from "./zh";

// 「技能」页的分组页签：qumge 浏览只回精选，分组 key 是 qumge DomainPicks::DOMAINS 的领域 key
// （app/models/domain_picks.rb）。qumge 那边加了领域、这里没补译名，页签就会露出 kebab-case。
//
// 这份清单要和 qumge 的 DOMAINS 保持一致 —— 那边加一行，这边加一行、补两份译名。
const QUMGE_DOMAIN_KEYS = [
  "pdf", "docx", "spreadsheets", "slides", "browser", "scraping", "research", "social-media",
  "seo", "email", "copywriting", "image-design", "video", "data-analysis", "meetings",
  "office-automation", "frontend", "code-review", "testing", "devops-security", "database",
  "mcp-agents", "translation", "customer-support", "sales-crm", "ecommerce", "finance", "legal",
  "hr-recruiting", "education", "project-management", "mobile-dev", "audio",
];

describe("skCategory", () => {
  it("every qumge domain key has an English and a Chinese label", () => {
    expect(QUMGE_DOMAIN_KEYS.filter((k) => !(k in EN_CATEGORY))).toEqual([]);
    expect(QUMGE_DOMAIN_KEYS.filter((k) => !(k in ZH_CATEGORY))).toEqual([]);
  });

  it("uses the table when the key is known", () => {
    expect(en.skCategory("pdf")).toBe("PDF");
    expect(zh.skCategory("browser")).toBe("操作网页");
  });

  it("falls back to readable words — never raw kebab-case — for a key this build has not seen", () => {
    expect(en.skCategory("brand-new-domain")).toBe("Brand new domain");
    expect(zh.skCategory("brand-new-domain")).toBe("Brand new domain");
  });
});
