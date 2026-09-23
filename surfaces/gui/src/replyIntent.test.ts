import { describe, expect, it } from "vitest";
import { classifyReply } from "./replyIntent";

describe("classifyReply —— 卡片等待时，一句话算不算是 / 否", () => {
  it.each(["好", "好的", "好，装吧", "行，装上", "可以。", "嗯嗯", "装吧！", "OK", "yes", "没问题", "去装吧"])(
    "%s → yes",
    (t) => expect(classifyReply(t)).toBe("yes"),
  );

  it.each(["不用", "先不用", "不用了，谢谢", "算了", "不装", "别装", "No", "暂时不用"])("%s → no", (t) =>
    expect(classifyReply(t)).toBe("no"),
  );

  it.each([
    "有没有更简单的办法？",
    "装了要钱吗",
    "好是好，但我想先看看它能干嘛", // 带条件的话绝不能当同意
    "不好说，你先用别的办法试试", // 否定词开头的长句在讲别的事
    "帮我把第二页改一下",
    "",
    "   ",
  ])("%s → other", (t) => expect(classifyReply(t)).toBe("other"));
});
