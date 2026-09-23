// 卡片在等一个「是 / 否」的时候，用户打的字或说的话算不算回答？
//
// Marlo 的用户平时只是跟它说话（打字或语音），只有授权时才点一下（owner 2026-09-23）。
// 卡片等着、用户说一句「好，装吧」—— 如果这句话只是排在卡片后面，他会觉得 Marlo
// 没在听。所以卡片等待时，输入先当成对卡片的回答。
//
// 【为什么用词表，不交给模型】：「用户同意了」必须是用户自己说的，不能是模型读出来的。
// 让模型去判断，就等于让它自己给自己授权。词表做不到的（长句、条件句、「有没有更简单
// 的」），一律不当成是或否 —— 那是 "other"：卡片按「没装」收掉，原话交给模型继续。
//
// 判据收得很紧：整句（去掉标点和语气词）必须完全由肯定词组成才算 yes；以否定开头、
// 或整句是否定短语才算 no。宁可落到 other，也不能把一句带条件的话当成同意。

export type ReplyIntent = "yes" | "no" | "other";

const YES = [
  "好", "好的", "好啊", "好吧", "好嘞", "行", "行吧", "可以", "可以的", "可", "嗯", "嗯嗯", "对",
  "是", "是的", "要", "装", "装吧", "装上", "装上吧", "装一下", "安装", "安装吧", "去装", "去装吧",
  "同意", "没问题", "用吧", "用", "来吧", "ok", "okay", "yes", "yep", "sure", "yeah", "go", "install",
  // 卡片问的是一个动作时，用户最自然的是把动作说出来（「发吧」「连上」「看吧」）。
  "发", "发吧", "发出去", "发送", "发送吧", "去发", "连", "连吧", "连上", "连上吧", "读", "读吧",
  "看", "看吧", "允许", "批准", "执行", "执行吧", "做吧", "继续", "开始", "开始吧", "给", "给吧",
];
const NO = [
  "不", "不用", "不用了", "先不用", "先不", "不要", "不要了", "不装", "不装了", "算了", "别", "别装",
  "不需要", "暂时不用", "暂时不要", "不了", "免了", "no", "nope", "nah", "skip", "dontinstall",
];

// 句尾 / 句中可以忽略的：标点、空白、语气词。
const FILLER = /[\s,，.。!！~～、?？…]+|[呀啊吧呢哈啦]$/g;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/['’]/g, "").replace(FILLER, "");
}

// 「好，装吧」「行，装上」：由几个肯定词拼起来的也算 yes。按标点切开逐段判断。
function segments(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .split(/[\s,，.。!！~～、]+/)
    .map((s) => s.replace(/[?？…]+$/g, "").replace(/[呀啊呢哈啦]$/g, ""))
    .filter(Boolean);
}

export function classifyReply(text: string): ReplyIntent {
  const whole = normalize(text);
  if (!whole) return "other";
  // 问句不是回答（「装了会怎样？」「要钱吗？」）。
  if (/[?？]/.test(text) || /[吗么]$/.test(whole)) return "other";
  if (NO.includes(whole)) return "no";
  const parts = segments(text);
  if (parts.length > 0 && parts.every((p) => YES.includes(p))) return "yes";
  // 以明确的否定短语开头的短句（「不用了，谢谢」）。长句不算 —— 它多半在讲别的。
  if (whole.length <= 8 && NO.some((n) => n.length >= 2 && whole.startsWith(n))) return "no";
  // 否定 + 一个动作的短句：「先别发」「不连」「别删」「不要给」。
  if (whole.length <= 6 && /^(先)?(别|不要|不)/.test(whole)) return "no";
  return "other";
}
