import { useEffect, useState } from "react";
import {
  confirmSkillUpload,
  createSkill,
  updateSkill,
  type SkillUploadPreview,
} from "../../api";
import { useT } from "../../i18n";

const CARD = "rounded-xl2 border border-line bg-panel";
const FIELD_LABEL = "text-[12.5px] font-medium text-ink";
const INPUT =
  "w-full min-w-0 px-3 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent";
const BTN_ACCENT =
  "text-[12.5px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";
const BTN_BORDERED =
  "text-[12.5px] px-3 py-2 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0";

export type SkillDraft = {
  mode: "new" | "edit";
  name: string;
  description: string;
  instructions: string;
};

export const emptySkillDraft = (): SkillDraft => ({
  mode: "new",
  name: "",
  description: "",
  instructions: "",
});

export async function fileToB64(file: File): Promise<string> {
  // FileReader fallback: File.arrayBuffer is missing in some webviews (and jsdom).
  const buf =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as ArrayBuffer);
          r.onerror = () => reject(r.error);
          r.readAsArrayBuffer(file);
        });
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Settings ▸ Skills — the editor half of SKILLS-SPEC §5/§6: the write-it-yourself form
// and the import-preview card share this component because they're the same commitment
// (save something the worker will follow) shown two different ways.
export function SkillEditor({ draft, upload, onSaved, onCancel, onNotice, onError }: {
  draft: SkillDraft | null;
  upload: SkillUploadPreview | null;
  onSaved: () => void;
  onCancel: () => void;
  onNotice: (n: { name: string; text: string; tone: "ok" | "warn" } | null) => void;
  onError: (msg: string) => void;
}) {
  const t = useT();
  // 本地草稿：外层给初值，敲字不往上冒泡（每敲一个字都重渲染整页是没必要的）。
  const [local, setLocal] = useState<SkillDraft | null>(draft);
  useEffect(() => setLocal(draft), [draft]);

  const fail = (res: { ok?: boolean; error?: string }) => {
    onNotice(null);
    if (res.ok === false) {
      onError(res.error || t("skWentWrong"));
      return true;
    }
    onError("");
    return false;
  };

  const save = async () => {
    if (!local) return;
    const res =
      local.mode === "new"
        ? await createSkill({
            name: local.name.trim(),
            description: local.description.trim(),
            instructions: local.instructions,
          })
        : await updateSkill(local.name, {
            description: local.description.trim(),
            instructions: local.instructions,
          });
    if (fail(res)) return;
    // Confirmation copy (SKILLS-SPEC §4.1 #2): name-first, outcome + remedy only, in words a
    // person already owns — now / everywhere / off / start a new one. Never mechanism ("the
    // model will be told…") or engineering timing ("from the next message") — owner-driver
    // review rounds, 2026-07-27. The engine countermands disabled-but-loaded skills silently;
    // the copy promises only the guaranteed part. Only on create — editing an existing skill
    // is silent, same as the original SkillsTab.tsx save().
    if (local.mode === "new")
      onNotice({ name: local.name.trim(), text: t("skConfirmation"), tone: "ok" });
    onSaved();
  };

  const confirmUpload = async () => {
    if (!upload?.token) return;
    const res = await confirmSkillUpload(upload.token);
    if (fail(res)) return;
    onNotice({ name: upload.name || "Skill", text: t("skConfirmation"), tone: "ok" });
    onSaved();
  };

  if (!local && !upload) return null;

  return (
    <>
      {upload ? (
        <div className={`${CARD} p-4 mb-4`}>
          <div className="text-[13px] font-medium mb-1">{t("skReviewFirst")}</div>
          <p className="text-[12.5px] text-muted mb-3">{t("skReviewLede")}</p>
          <div className="text-[13px] mb-1">
            <span className="font-medium">{upload.name}</span>
            <span className="text-muted"> — {upload.description || t("skNoDescription")}</span>
          </div>
          <pre className="text-[12px] bg-paper border border-line rounded-lg p-3 whitespace-pre-wrap max-h-64 overflow-y-auto mb-2">
            {upload.instructions}
          </pre>
          {upload.files?.length ? (
            <div className="text-[12px] text-muted mb-2">
              {t("skBundledFiles")} {upload.files.join(", ")}
            </div>
          ) : null}
          <div className="flex gap-2 mt-3">
            <button className={BTN_ACCENT} onClick={confirmUpload}>
              {t("skInstallBtn")}
            </button>
            <button className={BTN_BORDERED} onClick={onCancel}>
              {t("skCancel")}
            </button>
          </div>
        </div>
      ) : null}

      {local ? (
        <div className={`${CARD} p-4 mb-4`}>
          <div className="text-[13px] font-medium mb-3">
            {local.mode === "new" ? t("skNewSkill") : t("skEditNamed")(local.name)}
          </div>
          <label className={FIELD_LABEL} htmlFor="skill-name">
            {t("skFieldName")}
          </label>
          <input
            id="skill-name"
            className={`${INPUT} mt-1 mb-3`}
            value={local.name}
            disabled={local.mode === "edit"}
            placeholder="weekly-report"
            onChange={(e) => setLocal({ ...local, name: e.target.value })}
          />
          <label className={FIELD_LABEL} htmlFor="skill-desc">
            {t("skFieldDesc")}
          </label>
          <input
            id="skill-desc"
            className={`${INPUT} mt-1 mb-3`}
            value={local.description}
            placeholder={t("skDescPlaceholder")}
            onChange={(e) => setLocal({ ...local, description: e.target.value })}
          />
          <label className={FIELD_LABEL} htmlFor="skill-instructions">
            {t("skFieldInstructions")}
          </label>
          <textarea
            id="skill-instructions"
            className={`${INPUT} mt-1 mb-3 min-h-[140px] font-mono`}
            value={local.instructions}
            placeholder={t("skInstructionsPlaceholder")}
            onChange={(e) => setLocal({ ...local, instructions: e.target.value })}
          />
          <div className="flex gap-2 mt-3">
            <button
              className={BTN_ACCENT}
              disabled={!local.name.trim() || !local.instructions.trim()}
              onClick={save}
            >
              {t("skSave")}
            </button>
            <button className={BTN_BORDERED} onClick={onCancel}>
              {t("skCancel")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
