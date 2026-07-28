// English is the source of truth. Every other locale is typed `typeof en`, so a
// missing or misspelled key fails `npm run build` — no extraction script, no
// lint rule, no drift. Five separate renames slipped through this codebase
// because the only thing watching was a person reading diffs.
//
// Values may be strings or functions of named arguments. Keep them flat and
// grouped by surface; a key is cheaper to find than a nested path.
export const en = {
  // -- chrome ---------------------------------------------------------------
  appName: "Marlo",
  beta: "BETA",
  starting: "Starting Marlo…",
  restoring: "Restoring your session…",

  // -- sidebar --------------------------------------------------------------
  newSession: "New session",
  search: "Search",
  automations: "Automations",
  // Sentence case: the header's CSS already uppercases it. Shouting in the
  // catalog changes the DOM text a screen reader announces and every test reads,
  // for a visual result CSS was already producing.
  recent: "Recent",
  noConversations: "No conversations yet.",
  notSignedIn: "Not signed in",

  // -- session intro --------------------------------------------------------
  // 问他的苦，不是"我能帮你做什么"——后者把负担推回给用户，而一个白领面对
  // 空白输入框最常见的反应就是关掉。
  introGreeting: "What takes most of your week?",
  introLede:
    "Tell me the part you least want to be doing — I'll take a run at it. Or just say what you need below.",
  taskAnalyzeTitle: "Analyze the files in a directory",
  taskAnalyzeSub: "I'll read them and summarize what matters",
  taskAnalyzeAct: "Pick a folder →",
  taskWriteTitle: "Write one document from a folder of files",
  taskWriteSub: "I'll read them and draft it for you to edit",
  taskTidyTitle: "Sort out a folder that's become a mess",
  taskTidySub: "I'll propose names and an order, and wait for your go-ahead",
  taskStart: "Start →",
  // The prompts themselves, not just the labels. A Chinese reader who clicks a
  // Chinese card and watches an English sentence appear in the composer has been
  // handed someone else's app — and the model answers in whatever it was asked in.
  promptAnalyze: "Analyze the files in this folder and summarize what matters.",
  promptWrite:
    "Read the files in this folder and write me one document that pulls the important parts together. Save it in the folder.",
  promptTidy:
    "Look through this folder, tell me how you'd rename and organise the files so they make sense, and do it once I say yes.",

  // -- composer -------------------------------------------------------------
  composerPlaceholder: "Ask the coworker…  (drop or paste files)",
  askForApproval: "Ask for approval",
  modeDiscuss: "Discuss",
  modeDiscussSub: "Chat and explore — no edits or commands",
  modeAskSub: "Ask before edits and commands",
  modeFull: "Full access",
  modeFullSub: "Run everything without asking",
  noModel: "No model",

  // -- right rail -----------------------------------------------------------
  progress: "Progress",
  progressEmpty:
    "For longer multi-step tasks, progress will appear here while Marlo plans, uses tools, waits for approval, and produces artifacts.",
  artifacts: "Artifacts",
  artifactsEmpty: "No previewable files yet.",
  access: "Access",
  working: "Working...",
  workingOnThis: "Working on this task.",
  workingWithTools: (n: number) =>
    `Working on this task with ${n} tool call${n === 1 ? "" : "s"} so far.`,
  nToolCallsSoFar: (n: number) => `${n} tool call${n === 1 ? "" : "s"} so far.`,

  // -- onboarding -----------------------------------------------------------
  welcomeTo: "Welcome to Marlo",
  onboardLede:
    "Connect to Qumge to get started — one sign-in, every model, and your key stays on this Mac.",
  connectToQumge: "Connect to Qumge",
  useOwnKey: "Use your own API key instead",
  skipSetup: "Skip setup",
  next: "Next",
  onboardModelsNote: "Models can be enabled or hidden anytime in Settings ▸ Models.",

  // -- qumge device flow ----------------------------------------------------
  openBrowser: "Open browser",
  deviceHint:
    "Didn't open? The address above already carries your code — paste it into any browser, on this Mac or another device.",
  connectedToQumge: "Connected to Qumge",
  connecting: "Connecting…",
  signInDenied: "Sign-in was denied.",
  codeExpired: "That code expired before it was used.",
  connectFailed: "Something went wrong connecting to Qumge.",
  tryAgain: "Try again",

  // -- sidebar --------------------------------------------------------------
  workingNow: "Working now",
  sleeping: "Sleeping (will wake itself)",
  sessionActions: "Session actions",
  confirmDelete: "Click again to permanently delete",
  deleteQ: "Delete?",
  delete: "Delete",
  groupAndFilter: "Group & filter conversations",
  newProject: "New project",
  startWithPersona: "Start with a specific persona",

  // -- right rail -----------------------------------------------------------
  showSaveFolder: "Show the folder where these files are saved",
  refreshArtifacts: "Refresh artifacts",
  back: "Back",
  reload: "Reload",
  openInDefaultApp: "Open in default app",
  copyFullPath: "Copy full path",
  showInFolder: "Show in folder",
  loading: "Loading…",
  emptyFile: "Empty file.",
  renderingPdf: "Rendering PDF…",
  parsingSpreadsheet: "Parsing spreadsheet…",

  // -- composer -------------------------------------------------------------
  dismiss: "Dismiss",
  attach: "Attach",
  transcribing: "Transcribing…",
  connectAModel: "Connect a model",
  fetchingModels: "Fetching the model list from the server",
  loadingModels: "Loading models…",
  sendApprovalsToInbox: "Send approvals to Inbox",
  sendApprovalsToInboxTitle: "Send approvals to the Inbox",
  remove: "Remove",

  // -- settings: language ---------------------------------------------------
  balanceTitle: "Qumge credit — click to add more",
  balanceLowTitle: "Running low on credit — click to top up",
  addCredit: "Add credit",

  // -- sidebar + rail chrome ------------------------------------------------
  // These keys existed from the first translation pass; the components around
  // them kept their English literals, so a Chinese user got a Chinese greeting
  // inside an English window. The catalog was never the missing half.
  noMatchingConversations: "No matching conversations.",
  showLess: "Show less",
  showMore: (n: number) => `Show ${n} more`,
  // Deliberately NOT the same string as groupAndFilter ("Group & filter…"),
  // which is the tooltip: a screen reader reads "&" as an ampersand mid-sentence.
  // Collapsing the two into one key is exactly how a switch lost its accessible
  // name earlier in this rename.
  groupAndFilterAria: "Group and filter conversations",
  groupBy: "Group by",
  groupPersona: "Persona",
  groupChronological: "Chronological",
  showProducedFiles: "Show files this conversation produced",
  noSources: "no sources",
  nFolders: (n: number) => `${n} folder${n === 1 ? "" : "s"}`,
  giveFolderAccess: "+ Give access to a folder…",

  // -- 对话里的授权卡片 -----------------------------------------------------
  connectRequestTitle: (title: string) => `Connect ${title}?`,
  // 中转方那一行只在真有第三方时渲染 —— 见 ConnectorRequestCard 的注释。
  connectBrokeredBy: (who: string) => `The sign-in is handled by ${who}.`,
  connectNow: "Connect",
  checkYourBrowser: "Check your browser…",
  notNow: "Not now",

  // -- 连接页（Connectors + MCP 合成一页）-----------------------------------
  // 用户看到的是一件事：「Marlo 能用什么」。Connectors 和 MCP 的区别是实现细节
  // ——一个是账号、一个是工具服务器——而分成两个标签会让人以为要在两处各配一次。
  // MCP 收进「高级」：它有用，但一个非技术用户不该在这里被 stdio/HTTP 拦住。
  connectionsTitle: "Connections",
  connectionsSub: "What Marlo can use on your behalf. Connected ones come first.",
  advancedToolServers: "Advanced: tool servers",
  advancedToolServersSub: "Connect an MCP server — extra tools, shared across all your coworkers.",

  // 连接器名里【只有普通名词】需要翻译。Gmail / Slack / Notion 是专名，翻译它们
  // 只会让人对不上自己在别处见到的那个东西；Browser、Email 是普通名词，在中文
  // 界面里保持英文就是没做完本地化。
  //
  // 放在这里而不是 descriptors.py：那边是【数据】（一份服务清单），这里是【界面
  // 文案】。同一个字段两种身份，分界就在"它是不是专名"。
  connectorTitleBrowser: "Browser",
  connectorTitleEmail: "Email",

  // 连接列表的分组标题。分组本身由后端给（descriptors 的 group），
  // 这里只负责文案。
  groupMail: "Mail",
  groupCalendar: "Calendar",
  groupChat: "Chat",
  groupFiles: "Files & drives",
  groupWeb: "Web",
  groupOther: "Everything else",
  // 这个版本连不上的连接器上那一行。不说"暂不可用"——用户会以为是我们坏了。
  connectorWaitingUpstream: "Waiting on the provider",
  // 邮件类的死胡同有出路：同一个邮箱用 IMAP 连得上。别让人以为是坏了。
  connectorUseImapInstead: "Use Email (IMAP) →",
  connect: "Connect",
  validating: "Validating…",
  searchPlaceholder: "Search",

  // 「能力」页。分类是【能力 / 连接】两类，而能力之前一个界面都没有。
  // 它是【管理台】不是发现入口：发现发生在对话里（规格 D'）。
  abilities: "Abilities",
  abilitiesSub: "What Marlo knows how to do. It finds new ones itself while you work.",
  abilitiesEmpty: "Nothing installed yet.",
  abilitiesEmptyHow: "You don't pick these from a list — tell Marlo what you need done and it looks for one.",
  abilitiesWhere: (dir: string) => `Installed to ${dir}`,
  abilitiesSearch: "Search Qumge's catalog…",
  abilitiesInstalled: "Installed",
  abilitiesFound: "From the catalog",
  abilitiesInstall: "Add",
  abilitiesInstalling: "Adding…",
  abilitiesRemove: "Remove",
  abilitiesNeeds: "needs a connection:",
  abilitiesNoResults: "Nothing found. Try describing the job instead of naming a tool.",
  abilitiesVetted: "Vetted by Qumge",
  abilitiesMore: "Load more",
  abilitiesLoading: "Loading…",
  abilitiesView: "What it does",
  abilitiesClose: "Close",
  abilitiesUntrusted: "This text comes from a public catalog. Marlo reads it as guidance, never as orders.",
  gatewayBrowse: "Browse Qumge models",
  gatewaySearch: "Filter by name or vendor…",
  gatewayHint: "One key, every model below. Add the ones you want in the picker.",
  gatewayAdd: "Add",
  gatewayAdded: "Added",

  // -- 连接器详情页 ---------------------------------------------------------
  connNotConnected: "Not connected",
  connDefault: "Default",
  connAccounts: "Accounts",
  connRemove: "remove",
  connWaiting: "Waiting",
  connListening: "Listening",
  connDismiss: "Dismiss",
  connPeople: "People",
  connTools: "Tools",
  connThread: "Thread",
  connThreads: "Threads",
  connPortals: "Portals",
  connSandbox: "Sandbox",
  connRecent: "RECENT",
  connRecommended: "Recommended",
  connNothingMatches: "Nothing matches.",
  connDisconnectAccount: "Disconnect this account",
  connDisconnectMailbox: "Disconnect this mailbox",
  connDisconnectPortal: "Disconnect this portal",
  connUnsubscribe: "Unsubscribe this session",
  connDirectMessages: "Direct messages",
  connHiddenFields: "Hidden fields",
  connNeverShowAgents: "Never show agents",
  connTypeName: "Type a name…",
  connLabelPlaceholder: "Label name, e.g. Personal",
  connPropertyPlaceholder: "Property name, e.g. salary",
  connEmailPlaceholder: "name@example.com or @domain.com",
  connPickFromDirectory: "Pick from the workspace directory",
  connNamesFromSlack: "Names come from Slack automatically. IDs show on hover.",
  connSetByInstaller: "Set by the workspace installer.",
  connStrippedEverywhere: "Stripped from every record agents read, across all portals.",
  connRemoveApprovalOwner: "remove approval owner",
  connRemoveApprovalFirst: "Remove approval-owner access before removing this person.",
  connPasteBothTokens: "Paste both tokens",
  connSocketModeSteps: "Enable Socket Mode, add bot scopes, install it to your workspace",
  connPromise: "Promise",
  connCoworker: "Coworker",

  // -- 通用界面 -------------------------------------------------------------
  uiAbout: "About",
  uiActivity: "Activity",
  uiAttach: "Attach",
  uiBackToSources: "Back to sources",
  uiCloseGallery: "Close gallery",
  uiCopyMessage: "Copy message",
  uiCopyPath: "Copy path",
  uiDismiss: "Dismiss",
  uiFolders: "Folders",
  uiInbox: "Inbox",
  uiInstalled: "Installed",
  uiMessage: "Message",
  uiMode: "Mode",
  uiModels: "Models",
  uiOpen: "Open",
  uiPersona: "Persona",
  uiReason: "Reason",
  uiRecentLabel: "Recent",
  uiRemove: "Remove",
  uiRemoveLower: "remove",
  uiSend: "Send",
  uiSession: "Session",
  uiSource: "Source",
  uiSources: "Sources",
  uiTasks: "Tasks",
  uiTools: "Tools",
  uiWhen: "When",
  uiWorkspace: "Workspace",
  uiUnsubscribe: "Unsubscribe",
  uiUnrouted: "Unrouted",
  uiRecommended: "Recommended",
  uiComingSoon: "Coming soon",
  uiNotSetUp: "Not set up",
  uiMac: "Mac",
  uiShowSidebar: "Show sidebar",
  uiShowSidebarKey: "Show sidebar (⌘B)",
  uiShowInFolder: "Show in folder",
  uiOpenDefaultApp: "Open in default app",
  uiPickFolder: "Pick a folder",
  uiChooseLocation: "Choose location",
  uiChoosePersona: "Choose a persona",
  uiAddPersonas: "Add personas",
  uiPersonaGallery: "Persona Gallery",
  uiSignInGallery: "Sign in to browse the Gallery",
  uiSearchPersonas: "Search personas",
  uiSearchChats: "Search chats",
  uiSearchConnectors: "Search connectors…",
  uiDeletePersona: "Delete this persona",
  uiEnablePersona: "Enable this persona",
  uiEnableServer: "Enable this server",
  uiNewProject: "New project",
  uiDefaultForNew: "New sessions get by default",
  uiDefaultForNewSessions: "Default for new sessions",
  uiDefaultMode: "Default mode",
  uiInPicker: "In the composer's picker",
  uiIncludedModels: "Included models",
  uiAddAnotherModel: "Add another model…",
  uiNoModel: "No model connected — connect a model",
  uiNoChats: "No chats found.",
  uiNoTools: "No tools.",
  uiNoAudit: "No audit events yet.",
  uiEmptySheet: "Empty sheet.",
  uiTryTask: "Try a task",
  uiFirstAutomation: "Create your first automation",
  uiConnectTools: "Connect your everyday tools",
  uiConnectionsBenefit: "Connections for full benefit",
  uiStartWorking: "Start working with Coworker",
  uiSessionAccess: "Session access",
  uiSessionActions: "Session actions",
  uiUnattendedApprovals: "Unattended approvals",
  uiFolderRequest: "The agent is requesting access to a folder",
  uiPlanProposed: "The agent proposed a plan",
  uiPlanChange: "What should change about the plan?",
  uiWaitingAgent: "Waiting for agent...",
  uiUpdateAvailable: "Update available",
  uiReloadPreview: "Reload preview",
  uiFolderPathPlaceholder: "Choose or paste a folder path…",
  uiWriteToggle: "Off = read-only. Tick to let the agent write here.",
  uiLocalDirectory: "Local directory",
  uiAddChannel: "Add a channel",
  uiChannelSubs: "Channel subscriptions",
  uiChannelsListened: "Channels this session listens to",
  uiNoChannels: "Not subscribed to any channel.",
  uiStopListening: "Stop listening",
  uiListensTo: "Listens to",
  uiInboxRoutes: "Inbox routes to",
  uiAllowedToMessage: "Allowed to message",
  uiRecentSenders: "Recent senders",
  uiDeliveredHere: "Delivered here only.",
  uiEnabledTapMute: "Enabled for this session — tap to mute here",
  uiNoneYetMessageBot: "None yet. Message the bot once and it'll show here.",
  uiAllowAndDeliver: "Add the sender to the allow-list and deliver this message now",
  uiAllowDiscard: "Add the sender to the allow-list; this message is discarded",
  uiDiscardMessage: "Throw this message away",
  uiToolsExposed: "Tools exposed to Marlo",

  // -- 数据数组里的界面文字（模板/导航/筛选器）---------------------------
  tplGithubDigest: "GitHub digest",
  tplGithubBlurb: "Merged PRs and commits, posted to your team's Slack.",
  tplPipelineDigest: "Pipeline digest",
  tplPipelineBlurb: "Deals that moved — and deals going quiet — posted to Slack.",
  tplMorningBrief: "Morning brief",
  tplMorningBlurb: "Calendar and unread email, summarized before your day starts.",
  tplNewsBriefing: "Morning news briefing",
  tplNewsBlurb: "A 5-bullet tech & world news digest, saved as markdown.",
  tplInboxDigest: "Inbox digest",
  tplInboxBlurb: "One short digest of your unread email.",
  tplFolderCleanup: "Folder cleanup",
  tplFolderBlurb: "Sort recent Downloads into tidy folders by type.",
  tplNoConnections: "No connections needed",
  freqDaily: "Every day",
  freqWeekdays: "Weekdays",
  freqMon: "Mondays",
  freqTue: "Tuesdays",
  freqWed: "Wednesdays",
  freqThu: "Thursdays",
  freqFri: "Fridays",
  freqSat: "Saturdays",
  freqSun: "Sundays",
  deliverInApp: "In the app",
  navGeneral: "General",
  navModels: "Models",
  navVoiceInput: "Voice input",
  navPersonas: "Personas",
  filterAll: "All",
  filterQuestions: "Questions",
  filterApprovals: "Approvals",
  agentChat: "Chat",
  agentCode: "Code",
  agentCoworker: "Coworker",
  connBrowserLabel: "Browser",
  connEmailLabel: "Email",
  connGranola: "Granola",
  connGranolaBlurb: "Meeting notes & transcripts — sign in with your Granola account.",
  scheduledOnlyWhileOpen: "Runs only while Marlo is open — a missed schedule catches up once when you next open it.",

  // -- 设置页 ---------------------------------------------------------------
  setGeneral: "General",
  setModels: "Models",
  setPersonas: "Personas",
  setMemory: "Memory",
  setVoiceInput: "Voice input",
  setAppearance: "Appearance",
  setTheme: "Theme",
  setSidebar: "Sidebar",
  setFiles: "Files",
  setConvPerCoworker: "Conversations shown per coworker",
  setTrustedWorkspaces: "Trusted workspaces",
  setNoTrusted: "No workspaces are trusted.",
  setOpenAtLogin: "Open at login",
  setOpenAtLoginSub: "Launch Marlo automatically when you sign in.",
  setKeepAwake: "Keep this system awake",
  setKeepAwakeSub: "Prevent idle sleep so scheduled tasks fire on time.",
  setTokenSavings: "Token savings",
  setMaxPages: "Max pages",
  setMaxSize: "Max size",
  setPdfFallback: "PDFs on models without native PDF support",
  setMicTest: "Microphone test",
  setDownloadModel: "Download model",
  setRepair: "Repair",
  setVerified: "Verified",
  setProcessor: "Processor",
  setThisDevice: "This device",
  setPrivateByDesign: "Private by design.",
  setVoiceDesktopOnly: "Voice Input setup is available in the Marlo desktop app.",
  setPickFolder: "Pick a folder",
  setBrowseGallery: "Browse the Persona Gallery",

  // -- 自动化页 -------------------------------------------------------------
  autoTitle: "Automations",
  autoRuns: "Runs",
  autoNoRuns: "No runs yet.",
  autoOpenRun: "Open this run's conversation",
  autoDelete: "Delete automation",
  autoEdit: "Edit",
  autoRepeat: "Repeat",
  autoEveryDay: "Every day",
  autoWeekdays: "Weekdays",
  autoWeekends: "Weekends",
  autoWhen: "When",
  autoTime: "Time",
  autoTitleField: "Title",
  autoTitlePlaceholder: "Title (e.g. Daily standup notes)",
  autoInstructions: "Instructions",
  autoInstructionsPlaceholder: "What should it do each run? (e.g. Summarize today's calendar and open tasks.)",
  autoDeliverTo: "Deliver to",
  autoPostToChannel: "Post to channel",
  autoRepository: "Repository",
  autoOwnerRepo: "owner/repo",
  autoAllowedNoAsk: "Allowed without asking",
  autoWillAskAgain: "This automation will ask for approval again",
  cancel: "Cancel",
  abilitiesSearchFailed: "Couldn't reach the catalog:",

  // -- account (sidebar footer) ---------------------------------------------
  // The footer used to report sign-in to OpenWorker Cloud — a third party whose
  // connectors this build does not support — so someone signed in to Qumge read
  // "Not signed in" beside their own balance. It names the account that pays for
  // the models now, and every string here says Qumge because that is what it is.
  accountOf: (email: string) => `${email} · Qumge`,
  accountAria: (email: string) => `Account: ${email}`,
  accountAriaSignedOut: "Account: not signed in",
  signedInToQumge: "Signed in to Qumge",
  signInToQumge: "Sign in to Qumge",
  signedOutHint: "Not signed in — the models and skills come with a Qumge account",
  signOut: "Sign out",
  signOutOfQumge: "Sign out of Qumge",
  inbox: "Inbox",
  connectors: "Connectors",
  settings: "Settings",
  activity: "Activity",
  inboxNeedsYou: (n: number) => `Inbox — ${n} items need you`,

  language: "Language",
  languageSub: "Marlo's own text. What you write to it, and what it writes back, is up to you.",
  langEnglish: "English",
  langChinese: "中文",
};

// No `as const` above, deliberately. With it every value becomes a literal type
// and `Strings` demands that the Chinese catalog equal the English text exactly
// — the guard fires on every translated line and never on a missing one, which
// is precisely backwards.
export type Strings = typeof en;
