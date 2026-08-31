// 渲染出来之后，扫 DOM 里【用户真正看到的字符】有没有英文残留。
//
// 【为什么不数守卫的条数】：i18n 守卫今天报了四次"无新增"，而界面上整屏是英文 ——
// 每次都是它的判据漏了一种形状。守卫量的是源码，这里量的是渲染结果，两者独立。
// 源码全绿而渲染出英文，说明守卫又漏了；反过来则说明白名单放宽过头了。
//
// 判据是【常见英文虚词】而不是"含拉丁字母"：产品名（Marlo、Slack）、模型 id、
// 路径都会含拉丁字母，它们出现在中文界面里是对的。
const FUNCTION_WORDS =
  /\b(the|and|your|with|from|this|that|will|are|can|not|for|you|please|click|here|update|settings|connect|sign|allow|approve|folder|session|channel|message|model|file|search|install|available|coming|soon|failed|error|loading|waiting|about|before|after|when|what|which|need|needs|make|made|start|stop|open|close|show|hide|add|remove|delete|save|cancel|first|last|more|less|only|also|been|have|has|was|were|its|their|them|they|then|than|there|these|those)\b/i;

export function englishRunsIn(root: HTMLElement): string[] {
  const out: string[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walk.nextNode())) {
    const s = (n.textContent || "").trim();
    // 已经含中文的跳过：那是"中文里夹着一个专名"，是对的。
    if (s.length > 3 && FUNCTION_WORDS.test(s) && !/[一-鿿]/.test(s)) out.push(s);
  }
  return out;
}
