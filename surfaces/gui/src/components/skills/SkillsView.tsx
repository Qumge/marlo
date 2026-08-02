import { useEffect, useRef, useState } from "react";
import { listSkills, stageSkillUpload, type SkillRow, type SkillUploadPreview } from "../../api";
import { useT } from "../../i18n";
import { Icon } from "../Icon";
import { PanelHead } from "../IntegrationsView";
import { GRP_H } from "../connectors/ui";
import { InstalledSkills } from "./InstalledSkills";
import { SkillCatalog } from "./SkillCatalog";
import { SkillEditor, emptySkillDraft, fileToB64, type SkillDraft } from "./SkillEditor";

const BTN_ACCENT =
  "text-[12.5px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";

type Notice = { name: string; text: string; tone: "ok" | "warn" };

// 技能 —— 唯一的一页。账号菜单里「Marlo 有什么」的三件之一（收件箱 / 技能 / 外部连接）。
//
// 【为什么只有一页】2026-08-02 之前这里是两页：账号菜单的「能力」和设置里的「技能」。
// 两者打的是同一个 GET /v1/skills —— 不是叫法不一致，是同一份数据渲染了两遍，而且
// 已经因此坏了三处（移除按钮打了不存在的路由、禁用状态看不见、从设置里点目录会把人
// 甩出设置）。规格：docs/superpowers/specs/2026-08-02-skills-naming-unification-design.md
//
// 【为什么目录常驻在下半页，而不是收进「添加」菜单】0e1b2a0 定过：没搜索时也要有列表，
// 用户得能自己看见目录里有什么。收进菜单等于推翻它。目录在同一页之后，「浏览目录」
// 那个门自己就不需要了 —— 添加菜单从四个门变回三个。
export function SkillsView({ onCreateSkill }: { onCreateSkill?: (description: string) => void }) {
  const t = useT();
  // null = 还没问到后端。空数组才是「真的一个都没有」—— 两者渲染不同的东西，
  // 一开始就用 [] 会让每次进页面都先闪一下空状态。
  const [rows, setRows] = useState<SkillRow[] | null>(null);
  const [error, setError] = useState("");
  // 状态变更的回执（SKILLS-SPEC §4.1 #2）：名字打头，用户才知道是【哪一条】技能。
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editor, setEditor] = useState<SkillDraft | null>(null);
  const [upload, setUpload] = useState<SkillUploadPreview | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => listSkills().then(setRows).catch(() => setRows([]));

  useEffect(() => {
    refresh();
    // 对话里装上的技能要能自己出现，不用重开页面。
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, []);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    const res = await stageSkillUpload(await fileToB64(file), file.name);
    if (res.ok === false) {
      setError(res.error || t("skWentWrong"));
      return;
    }
    setError("");
    setUpload(res);
  };

  return (
    <main className="flex-1 min-w-0 flex bg-paper">
      <div className="flex-1 min-w-0 overflow-y-auto hairline-scroll">
        <div className="max-w-4xl mx-auto px-7 py-6">
          <div className="flex items-start justify-between gap-3">
            <PanelHead title={t("skills")} sub={t("skillsSub")} />
            {/* 一个添加动作，后面三个门。第四个（浏览目录）不需要了 —— 目录就在下面。 */}
            <AddMenu
              open={addOpen}
              onToggle={() => setAddOpen((v) => !v)}
              onClose={() => setAddOpen(false)}
              onWrite={() => setEditor(emptySkillDraft())}
              onImport={() => fileInput.current?.click()}
              onAskMarlo={onCreateSkill}
            />
          </div>

          <input
            ref={fileInput}
            type="file"
            accept=".zip,.md"
            className="hidden"
            aria-label={t("skUploadLabel")}
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {error ? (
            <div className="text-[12.5px] text-red-500 mb-3" role="alert">
              {error}
            </div>
          ) : null}
          {notice ? <NoticeBar notice={notice} onDismiss={() => setNotice(null)} /> : null}

          <SkillEditor
            draft={editor}
            upload={upload}
            // 只收尾，【不要】在这里弹提示条 —— 提示由 SkillEditor 自己按 mode 决定
            // （新建弹、上传确认弹、编辑保存静默）。父层无条件弹会让「改一句说明」
            // 也冒出「—— 之后每次对话它都能用了。」这句只属于新建的话。
            onSaved={() => {
              setEditor(null);
              setUpload(null);
              refresh();
            }}
            onCancel={() => {
              setEditor(null);
              setUpload(null);
            }}
            onNotice={setNotice}
            onError={setError}
          />

          {/* 已装的在上面，目录在下面 —— 用户先关心"我现在有什么"，再看"还能有什么"。 */}
          {rows !== null && rows.length > 0 && (
            <>
              <div className={GRP_H + " !mt-0"}>
                {t("skInstalled")} · {rows.length}
              </div>
              <InstalledSkills
                rows={rows}
                onEdit={(row) =>
                  setEditor({
                    mode: "edit",
                    name: row.name,
                    description: row.description,
                    instructions: row.instructions,
                  })
                }
                onChanged={refresh}
                onNotice={setNotice}
                onError={setError}
              />
            </>
          )}

          {/* 空状态要【解释机制】，不是给一个"去逛逛"的按钮：一个刚装好的用户看到
              "还没装任何技能"，第一反应是"那我去哪儿装"，而正确答案是"你不用装"。
              InstalledSkills 自己那句空状态在这一页会和它打架，所以列表为空时整块
              不渲染，由这里回答。 */}
          {rows !== null && rows.length === 0 && (
            <div
              className="rounded-xl border border-line bg-panel/50 p-5 text-[13px] mb-2"
              data-testid="abilities-empty"
            >
              <div className="font-medium">{t("skEmpty")}</div>
              <div className="text-muted mt-1.5 leading-relaxed">{t("skEmptyHow")}</div>
            </div>
          )}

          <SkillCatalog
            installedNames={new Set((rows || []).map((r) => r.name))}
            onInstalled={refresh}
          />
        </div>
      </div>
    </main>
  );
}

// 「添加技能 ▾」—— 一个动作，后面三个门（SKILLS-SPEC §5）：自己写 / 导入文件 /
// 让 Marlo 做。不另开文件：它只有这一个用处。
function AddMenu({
  open,
  onToggle,
  onClose,
  onWrite,
  onImport,
  onAskMarlo,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onWrite: () => void;
  onImport: () => void;
  // 第三个门（SKILLS-SPEC §5.2）：开一个新对话，说明填进 composer —— 技能由它来
  // 写，写完通过 save_skill 问过你再加。
  onAskMarlo?: (description: string) => void;
}) {
  const t = useT();
  return (
    <div className="relative shrink-0">
      <button className={BTN_ACCENT} aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="plus" size={13} /> {t("skAdd")}
        </span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 w-80 rounded-xl2 border border-line bg-panel shadow-xl z-20 p-1.5"
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          >
            <button
              role="menuitem"
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper"
              onClick={() => {
                onClose();
                onWrite();
              }}
            >
              <div className="text-[13px] font-medium">{t("skDoorWrite")}</div>
              <div className="text-[11.5px] text-muted">{t("skDoorWriteSub")}</div>
            </button>
            <button
              role="menuitem"
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper"
              onClick={() => {
                onClose();
                onImport();
              }}
            >
              <div className="text-[13px] font-medium">{t("skDoorImport")}</div>
              <div className="text-[11.5px] text-muted">{t("skDoorImportSub")}</div>
            </button>
            <button
              role="menuitem"
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper disabled:opacity-40"
              disabled={!onAskMarlo}
              onClick={() => {
                onClose();
                onAskMarlo?.("");
              }}
            >
              <div className="text-[13px] font-medium">{t("skDoorMarlo")}</div>
              <div className="text-[11.5px] text-muted">{t("skDoorMarloSub")}</div>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// 状态变更的横幅。名字打头（是【哪一条】技能），颜色和列表区分开 —— 不然它会被
// 一眼掠过（测试者 2026-07-27）。
function NoticeBar({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className={
        "mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] " +
        (notice.tone === "ok"
          ? "bg-tealSoft/70 text-tealInk border-tealInk/20"
          : "bg-warnSoft/70 text-warnInk border-warnInk/20")
      }
    >
      <span className="min-w-0">
        <b>{notice.name}</b> {notice.text}
      </span>
      <button
        className="ml-auto shrink-0 opacity-60 hover:opacity-100"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
}
