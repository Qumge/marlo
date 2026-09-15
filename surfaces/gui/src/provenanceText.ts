// 审批卡片上的来源警告（OPE-114 §1）：服务端 coworker/provenance.py 的 Match.render()
// 吐的是一句【固定词汇】的英文 ——
//
//   "<path> was <created|downloaded> by the agent <just now|1 step ago|N steps ago>"
//
// 【为什么在 GUI 这边翻译，而不是改服务端】同一句还写进审计记录、喂给 reviewer，
// 那两处要的是稳定的英文；而且服务端改成结构化字段是 Python 那边的活，会和上游
// 的 provenance.py 冲突。GUI 这边认出这套词汇、换成 t() 就够了。
//
// 【为什么单独一个文件】ApprovalCard.tsx 是上游改得最勤的组件之一，那边只留一行调用，
// 下次合并上游时冲突面最小。
//
// 【认不出就原样显示】这是一条安全警告：服务端哪天换了措辞，宁可在中文界面上显示
// 英文，也不能因为解析不了把它吞掉或者翻错。所以正则是锚定的、严格的 —— 连
// "1 steps ago" 这种服务端不会产出的形状也不认。
import { getI18n } from "react-i18next";

// 路径用贪婪匹配 + 句尾锚定：文件名里带 " was " 也切在最后一个动词前面。
// 步数只认服务端真会产出的形状：1 走单数那支，≥2 走复数那支（<=0 服务端写成 just now）。
const PROVENANCE = /^([\s\S]+) was (created|downloaded) by the agent (just now|1 step ago|([2-9]|[1-9]\d+) steps ago)$/;

export function provenanceText(raw: string): string {
  const m = PROVENANCE.exec(raw);
  if (!m) return raw;
  const [, path, verb, when, n] = m;
  // 模块级 fixed-T、调用时才取：模块加载那一刻 i18n 还没 init（见 ApprovalCard 顶上的注释）。
  const t = getI18n().getFixedT(null, "translation");
  const whenText =
    when === "just now"
      ? t("humanize.provenance.just_now")
      : t("humanize.provenance.steps_ago", { count: n ? Number(n) : 1 });
  // path 是 agent 定的文件名，【拼在前面】而不是作为 {{path}} 插值进去：实测 i18next 会把
  // 前一个变量值里的 "{{when}}" 当成后一个占位符替换掉（"{{when}}x.py" 渲染成 "刚才x.py
  // 是助手{{when}}…"）—— 恶意文件名能改写这条安全警告。两种语言里路径都在句首，拼接不损失什么。
  const rest =
    verb === "downloaded"
      ? t("humanize.provenance.downloaded", { when: whenText })
      : t("humanize.provenance.created", { when: whenText });
  return path + rest;
}
