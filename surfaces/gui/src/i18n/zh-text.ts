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
  "Approvals & questions go to the Inbox; the agent keeps working.": "审批和提问都进收件箱；助手会继续干活。",
  "Attach": "附件",
  "Connect a model": "连接一个模型",
  "Context meter unavailable for custom models.": "自定义模型没有上下文窗口信息，无法显示用量条。",
  "Context window": "上下文窗口",
  "Dismiss": "关闭",
  "Fetching the model list from the server": "正在从服务器获取模型列表",
  "Loading models…": "正在加载模型…",
  "Mode": "模式",
  "No model": "还没选模型",
  "No model connected — connect a model": "还没连模型 —— 去连一个",
  "Remove": "移除",
  "Send": "发送",
  "Send approvals to Inbox": "把待办发到收件箱",
  "Send approvals to the Inbox": "把需要你点头的事发到收件箱",
  "Session totals": "本次会话合计",
  "Token usage": "Token 用量",
  "Total": "合计",
  "Transcribing…": "正在转写…",
  "⏹ Stop": "⏹ 停止",
};
