import type { Strings } from "./en";

// `: Strings` is the guard. Drop a key, misspell one, or add a key to en.ts and
// forget this file, and `npm run build` fails before anything ships.
//
// Translating for someone who does not write software: no "会话", no "配置", no
// "凭证". The English is already plain; the Chinese has to stay that way rather
// than drift into the register a developer would use.
export const zh: Strings = {
  appName: "Marlo",
  beta: "测试版",
  starting: "正在启动 Marlo…",
  restoring: "正在恢复你上次的进度…",

  newSession: "新建对话",
  search: "搜索",
  automations: "定时任务",
  recent: "最近",
  noConversations: "还没有对话",
  notSignedIn: "未登录",

  introGreeting: "你每周的时间花在哪儿？",
  introLede: "挑那件你最不想做的告诉我 —— 我来试试。也可以直接在下面说你要什么。",
  taskAnalyzeTitle: "看看一个文件夹里都有什么",
  taskAnalyzeSub: "我读一遍，把要紧的讲给你听",
  taskAnalyzeAct: "选个文件夹 →",
  taskWriteTitle: "把一堆文件写成一份文档",
  taskWriteSub: "我读完起草，你来改",
  taskTidyTitle: "整理一个已经乱掉的文件夹",
  taskTidySub: "我先给你看怎么改名、怎么排，你点头我再动手",
  taskStart: "开始 →",
  promptAnalyze: "看看这个文件夹里都有什么，把要紧的讲给我听。",
  promptWrite: "读一遍这个文件夹里的文件，写成一份文档，把重要的内容整合起来，存到这个文件夹里。",
  promptTidy: "看看这个文件夹，告诉我你打算怎么给这些文件改名、怎么归类，我同意了你再动手。",

  composerPlaceholder: "说说你要什么…（也可以把文件拖进来）",
  askForApproval: "动手前先问我",
  modeDiscuss: "只聊聊",
  modeDiscussSub: "只讨论，不改文件也不执行命令",
  modeAskSub: "改文件、执行命令前先问你",
  modeFull: "完全放手",
  modeFullSub: "什么都不问，直接做",
  noModel: "还没选模型",

  progress: "进展",
  progressEmpty:
    "遇到要分几步做的事，Marlo 的计划、用了什么工具、在等你点头、做出了什么，都会显示在这里。",
  artifacts: "产出",
  artifactsEmpty: "还没有可预览的文件",
  access: "可访问范围",
  working: "正在做…",
  workingOnThis: "正在做这件事。",
  workingWithTools: (n) => `正在做这件事，已经用了 ${n} 次工具。`,
  nToolCallsSoFar: (n) => `已经用了 ${n} 次工具。`,

  welcomeTo: "欢迎使用 Marlo",
  onboardLede: "连上 Qumge 就能开始 —— 登录一次，所有模型都能用，密钥只存在这台 Mac 上。",
  connectToQumge: "连接 Qumge",
  useOwnKey: "改用我自己的 API key",
  skipSetup: "先跳过",
  next: "下一步",
  onboardModelsNote: "模型随时可以在「设置 ▸ 模型」里开启或隐藏。",

  openBrowser: "打开浏览器",
  deviceHint:
    "没有自动打开？上面那个网址已经带上了你的验证码 —— 复制到任何浏览器里打开就行，这台 Mac 或别的设备都可以。",
  connectedToQumge: "已连接 Qumge",
  connecting: "正在连接…",
  signInDenied: "授权被拒绝了。",
  codeExpired: "这个验证码还没用就过期了。",
  connectFailed: "连接 Qumge 时出了点问题。",
  tryAgain: "重试",

  workingNow: "正在干活",
  sleeping: "休眠中（到点会自己醒）",
  sessionActions: "更多操作",
  confirmDelete: "再点一次就永久删除",
  deleteQ: "删除？",
  delete: "删除",
  groupAndFilter: "分组和筛选",
  newProject: "新建项目",
  startWithPersona: "指定一个角色开始",

  showSaveFolder: "打开这些文件所在的文件夹",
  refreshArtifacts: "刷新",
  back: "返回",
  reload: "重新加载",
  openInDefaultApp: "用默认程序打开",
  copyFullPath: "复制完整路径",
  showInFolder: "在访达中显示",
  loading: "加载中…",
  emptyFile: "空文件",
  renderingPdf: "正在渲染 PDF…",
  parsingSpreadsheet: "正在解析表格…",

  dismiss: "关闭",
  attach: "添加文件",
  transcribing: "正在转写…",
  connectAModel: "连接一个模型",
  fetchingModels: "正在从服务器获取模型列表",
  loadingModels: "正在加载模型…",
  sendApprovalsToInbox: "把待办发到收件箱",
  sendApprovalsToInboxTitle: "把需要你点头的事发到收件箱",
  remove: "移除",

  balanceTitle: "Qumge 余额 —— 点击充值",
  balanceLowTitle: "余额不多了 —— 点击充值",
  addCredit: "充值",

  noMatchingConversations: "没有匹配的对话",
  showLess: "收起",
  showMore: (n) => `还有 ${n} 条`,
  groupAndFilterAria: "分组和筛选对话",
  groupBy: "分组方式",
  groupPersona: "按角色",
  groupChronological: "按时间",
  showProducedFiles: "查看这次对话产出的文件",
  noSources: "没有外部来源",
  nFolders: (n) => `${n} 个文件夹`,
  giveFolderAccess: "+ 授权一个文件夹…",

  connectRequestTitle: (title) => `要连一下 ${title} 吗？`,
  connectBrokeredBy: (who) => `这次登录由 ${who} 中转。`,
  connectNow: "连接",
  checkYourBrowser: "去浏览器里完成…",
  notNow: "先不要",

  // -- 连接页（Connectors + MCP 合成一页）-----------------------------------
  connectionsTitle: "连接",
  connectionsSub: "Marlo 可以替你用的东西。已连接的排在前面。",
  advancedToolServers: "高级：工具服务器",
  advancedToolServersSub: "接入一个 MCP 服务器 —— 额外的工具，所有同事共用。",

  // 只翻普通名词 —— Gmail / Slack 这些专名不翻。
  connectorTitleBrowser: "浏览器",
  connectorTitleEmail: "邮箱",

  // 连接列表的分组标题。分组本身由后端给（descriptors 的 group），
  // 这里只负责文案。
  groupMail: "邮件",
  groupCalendar: "日历",
  groupChat: "聊天",
  groupFiles: "文件与网盘",
  groupWeb: "网页",
  groupOther: "其他",
  // 这个版本连不上的连接器上那一行。不说"暂不可用"——用户会以为是我们坏了。
  connectorWaitingUpstream: "等服务商审核",
  // 邮件类的死胡同有出路：同一个邮箱用 IMAP 连得上。别让人以为是坏了。
  connectorUseImapInstead: "改用邮箱（IMAP）→",
  connect: "连接",
  validating: "验证中…",
  searchPlaceholder: "搜索",

  // 「能力」页。分类是【能力 / 连接】两类，而能力之前一个界面都没有。
  // 它是【管理台】不是发现入口：发现发生在对话里（规格 D'）。
  abilities: "能力",
  abilitiesSub: "Marlo 会做的事。干活过程中它自己会去找新的。",
  abilitiesEmpty: "还没装任何能力。",
  abilitiesEmptyHow: "这些不用你从列表里挑 —— 跟 Marlo 说你要做什么，它自己会去找。",
  abilitiesWhere: (dir: string) => `装在 ${dir}`,
  abilitiesSearch: "搜 Qumge 的技能目录…",
  abilitiesInstalled: "已装",
  abilitiesFound: "目录里的",
  abilitiesInstall: "添加",
  abilitiesInstalling: "添加中…",
  abilitiesRemove: "移除",
  abilitiesNeeds: "需要先连：",
  abilitiesNoResults: "没搜到。试试直接说你要做的事，而不是工具的名字。",
  abilitiesVetted: "Qumge 精选",
  abilitiesSearchFailed: "连不上目录：",

  accountOf: (email) => `${email} · Qumge`,
  accountAria: (email) => `账号：${email}`,
  accountAriaSignedOut: "账号：未登录",
  signedInToQumge: "已登录 Qumge",
  signInToQumge: "登录 Qumge",
  signedOutHint: "未登录 —— 模型和技能都来自 Qumge 账号",
  signOut: "退出登录",
  signOutOfQumge: "退出 Qumge 登录",
  inbox: "收件箱",
  connectors: "外部连接",
  settings: "设置",
  activity: "操作记录",
  inboxNeedsYou: (n) => `收件箱 —— 有 ${n} 件事等你处理`,

  language: "语言",
  languageSub: "只影响 Marlo 自己的界面文字。你怎么跟它说话、它怎么回你，不受这里影响。",
  langEnglish: "English",
  langChinese: "中文",
};
