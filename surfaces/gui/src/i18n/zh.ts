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

  introGreeting: "今天想做点什么？",
  introLede: "挑一件事开始 —— 我来做，做完保存好。也可以直接在下面说你要什么。",
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
  noModel: "还没选模型",

  progress: "进展",
  progressEmpty:
    "遇到要分几步做的事，Marlo 的计划、用了什么工具、在等你点头、做出了什么，都会显示在这里。",
  artifacts: "产出",
  artifactsEmpty: "还没有可预览的文件",
  access: "可访问范围",

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
  remove: "移除",

  language: "语言",
  languageSub: "只影响 Marlo 自己的界面文字。你怎么跟它说话、它怎么回你，不受这里影响。",
  langEnglish: "English",
  langChinese: "中文",
};
