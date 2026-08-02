import { useRef, useState } from "react";
import { useEffect } from "react";
import { listSkills, stageSkillUpload, type SkillRow, type SkillUploadPreview } from "../api";
import { Icon } from "./Icon";
import { t } from "../i18n";
import { InstalledSkills } from "./skills/InstalledSkills";
import { SkillEditor, emptySkillDraft, fileToB64, type SkillDraft } from "./skills/SkillEditor";

// Settings ▸ Skills (SKILLS-SPEC §5/§6) — the management home: the LIST is the page; every
// add-surface appears only when summoned from the single "Add skill" menu (the three doors:
// write form / import / start-a-conversation). Everything a user creates here is GLOBAL —
// "skills are things your worker knows everywhere". Creation-by-AI is a CONVERSATION (the
// menu's third door starts one; the worker proposes via save_skill) — there is no
// in-Settings drafting and no description box: the composer is where you describe it.
// Persona-bundled skills arrive with personas (§10), managed on the persona page, not here.

const BTN_ACCENT =
  "text-[12.5px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";

export function SkillsTab({
  onCreateSkill,
  onBrowseCatalog,
}: {
  // The doorway (SKILLS-SPEC §5.2): starts a new conversation with the description
  // prefilled in the composer — the worker builds the skill and proposes it via save_skill.
  onCreateSkill?: (description: string) => void;
  // 【第四个门，我们加的】qumge.com 的公开目录（4500+ 条）。上游的三个门都是
  // "从无到有做一个"或"把已有的一份搬进来"；这个是【货源】—— 别人已经写好的。
  //
  // 放进这个菜单而不是另开一个入口：用户不该看见两个"技能"的地方。装进来之后
  // 它就是这张列表里一个普通的全局技能（install 走 SkillStore.create），能编辑、
  // 能启用禁用、能删 —— 所以它属于这里。
  onBrowseCatalog?: () => void;
}) {
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [editor, setEditor] = useState<SkillDraft | null>(null);
  const [upload, setUpload] = useState<SkillUploadPreview | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState("");
  // The state-change callout (SKILLS-SPEC §4.1 #2): name-first so the user knows WHICH
  // skill, and visually distinct so it can't be skimmed past (tester ask 2026-07-27).
  const [notice, setNotice] = useState<{ name: string; text: string; tone: "ok" | "warn" } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  // Confirmation copy (SKILLS-SPEC §4.1 #2): name-first, outcome + remedy only, in words a
  // person already owns — now / everywhere / off / start a new one. Never mechanism ("the
  // model will be told…") or engineering timing ("from the next message") — owner-driver
  // review rounds, 2026-07-27. The engine countermands disabled-but-loaded skills silently;
  // the copy promises only the guaranteed part.
  const CONFIRMATION = t("skConfirmation");

  const refresh = () => listSkills().then(setRows);
  useEffect(() => {
    refresh();
  }, []);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    const res = await stageSkillUpload(await fileToB64(file), file.name);
    if (res.ok === false) {
      setError(res.error || t("skWentWrong"));
      return;
    }
    setError("");
    setUpload(res);
  };

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[16px] font-semibold">Skills</h2>
          <p className="text-[12.5px] text-muted mt-1 leading-relaxed">
            Reusable instructions the worker can follow in every conversation. Off here means
            off everywhere.
          </p>
        </div>
        {/* One add-action, three doors behind it (SKILLS-SPEC §5): the list is the page. */}
        <div className="relative shrink-0">
          <button
            className={BTN_ACCENT}
            aria-haspopup="menu"
            aria-expanded={addOpen}
            onClick={() => setAddOpen((v) => !v)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon name="plus" size={13} /> Add skill
            </span>
          </button>
          {addOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 top-full mt-1.5 w-80 rounded-xl2 border border-line bg-panel shadow-xl z-20 p-1.5"
                onKeyDown={(e) => e.key === "Escape" && setAddOpen(false)}
              >
                <button
                  role="menuitem"
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper"
                  onClick={() => {
                    setAddOpen(false);
                    setEditor(emptySkillDraft());
                  }}
                >
                  <div className="text-[13px] font-medium">Write it myself</div>
                  <div className="text-[11.5px] text-muted">
                    A name, a description, and the instructions
                  </div>
                </button>
                <button
                  role="menuitem"
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper"
                  onClick={() => {
                    setAddOpen(false);
                    fileInput.current?.click();
                  }}
                >
                  <div className="text-[13px] font-medium">Import a file</div>
                  <div className="text-[11.5px] text-muted">
                    A .zip or SKILL.md someone shared — you review before it installs
                  </div>
                </button>
                <button
                  role="menuitem"
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper disabled:opacity-40"
                  disabled={!onCreateSkill}
                  onClick={() => {
                    setAddOpen(false);
                    onCreateSkill?.("");
                  }}
                >
                  <div className="text-[13px] font-medium">Create with Marlo</div>
                  <div className="text-[11.5px] text-muted">
                    Starts a conversation — the worker builds it and asks before adding it to
                    your skills
                  </div>
                </button>
                <button
                  role="menuitem"
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-paper disabled:opacity-40"
                  disabled={!onBrowseCatalog}
                  data-testid="skills-browse-catalog"
                  onClick={() => {
                    setAddOpen(false);
                    onBrowseCatalog?.();
                  }}
                >
                  <div className="text-[13px] font-medium">Browse the Qumge catalog</div>
                  <div className="text-[11.5px] text-muted">
                    Thousands of ready-made skills — you read one before it installs
                  </div>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,.md"
        className="hidden"
        aria-label="Upload a skill archive"
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
      {notice ? (
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
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      ) : null}

      <SkillEditor
        draft={editor}
        upload={upload}
        onSaved={(name) => {
          setEditor(null);
          setUpload(null);
          setNotice({ name, text: CONFIRMATION, tone: "ok" });
          refresh();
        }}
        onCancel={() => {
          setEditor(null);
          setUpload(null);
        }}
        onNotice={setNotice}
        onError={setError}
      />
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
    </section>
  );
}
