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
  "% of the context window": "% 上下文窗口时压缩",
  "tokens, whichever is smaller": "tokens 时压缩，以先到者为准",
  "Auto-approve (experimental)": "自动批准（实验中）",
  "Adds an": "在模式选择器里加一个",
  "Auto-approve": "自动批准",
  "option to the mode picker. In that mode, your session model reviews each action that would normally need approval and clears the routine ones; anything doubtful still asks you. It can never allow something the rules block. One extra model call per check, billed to your usage.": "选项。开启后，会话所用的模型会先审一遍本该找你批准的动作，例行的直接放行；拿不准的仍然来问你。它永远不能放行规则禁止的事。每次审查多一次模型调用，计入你的用量。",
  "Shadow evaluation": "影子评估",
  "(for measuring)": "（用于评估）",
  "On any mode, the reviewer records what it": "任何模式下，审阅者都会把它",
  "would": "本会",
  "have decided next to your own choice — without changing anything. Lets you see how it would behave before trusting it. Also costs one model call per approval.": "怎么判记在你自己的选择旁边 —— 不改变任何结果。让你在信任它之前先看看它会怎么做。同样是每次批准多一次模型调用。",
  "6:34 PM": "下午 6:34",
  "6:36 PM": "下午 6:36",
  " · asks": " · 需审批",
  " · oauth": " · OAuth",
  "(optional)": "（可选）",
  "+ Add server": "+ 添加服务器",
  "Advanced server settings": "服务器高级设置",
  "Archived (": "已归档 (",
  "Context meter unavailable for custom models.": "自定义模型没有上下文窗口信息，无法显示用量条。",
  "Context window": "上下文窗口",
  "Dismiss": "关闭",
  "Loading skills…": "正在加载技能…",
  "Loading…": "加载中…",
  "MB": "MB",
  "Marlo still asks before using any of these. New ones become available in your next conversation —": "用这里的任何一个之前，Marlo 都还是会先问你。新加的会在下一次会话里生效 ——",
  "No MCP servers configured.": "还没有配置 MCP 服务器。",
  "No matching skills.": "没有匹配的技能。",
  "Paste server JSON (name → config):": "粘贴服务器 JSON（名称 → 配置）：",
  "Session totals": "本次会话合计",
  "Show more (": "显示更多（",
  "Skills": "技能",
  "Starting Marlo…": "正在启动 Marlo…",
  "Summarize #launch-room": "总结 #launch-room",
  "Token usage": "Token 用量",
  "Total": "合计",
  "cancel": "取消",
  "default": "默认",
  "hide tools": "收起工具",
  "of": "/",
  "sign out": "退出登录",
  "tools": "工具",
  "use them now": "现在就用它们",
  "waiting for browser…": "等待浏览器…",
  "‹ Connectors": "‹ 外部连接",
};
