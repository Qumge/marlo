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
