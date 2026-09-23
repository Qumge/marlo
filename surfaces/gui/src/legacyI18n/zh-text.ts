// 按【英文原文】索引的中文 —— 给构建期 transform（i18n-transform.ts）用。
//
// 和 zh.ts 的分工：zh.ts 按【键】索引，给我们自己写的组件用（键比原文稳定，改文案
// 不用改代码，也支持带参数的函数值）。这一份按【原文】索引，给上游的 JSX 用 ——
// 因为那些文件我们一个字节都不想改。
//
// 【这张表不是手写的】用 `node packaging/check_i18n_text.mjs --list` 把源码里所有会
// 显示给用户的英文提取出来，缺的补进来。提取和构建共用 i18n-jsx.mjs 里的同一份判据，
// 所以"守卫看到的"和"用户看到的"不会分家。
//
// 查不到的原样显示英文（见 tx.ts）—— 故意的降级方向：上游新加一句话，用户看到英文
// （可用，只是没翻），而不是看到键名或空白（不可用）。
export const zhText: Record<string, string> = {
  "OpenWorker Cloud": "OpenWorker Cloud",
  "PR": "PR",
  "XXXX-XXXX": "XXXX-XXXX",
  "6:34 PM": "下午 6:34",
  "6:36 PM": "下午 6:36",
  " · asks": " · 需审批",
  " · oauth": " · OAuth",
  "(optional)": "（可选）",
  "+ Add server": "+ 添加服务器",
  "Advanced server settings": "服务器高级设置",
  "Archived (": "已归档 (",
  "Dismiss": "关闭",
  "MB": "MB",
  "Marlo still asks before using any of these. New ones become available in your next conversation —": "用这里的任何一个之前，Marlo 都还是会先问你。新加的会在下一次会话里生效 ——",
  "No MCP servers configured.": "还没有配置 MCP 服务器。",
  "Paste server JSON (name → config):": "粘贴服务器 JSON（名称 → 配置）：",
  "Show more (": "显示更多（",
  "Summarize #launch-room": "总结 #launch-room",
  "cancel": "取消",
  "default": "默认",
  "hide tools": "收起工具",
  "sign out": "退出登录",
  "tools": "工具",
  "use them now": "现在就用它们",
  "waiting for browser…": "等待浏览器…",
};
