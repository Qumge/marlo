import { useState } from "react";
import { deleteSkill, revealSkill, updateSkill, type SkillRow } from "../../api";
import { useT } from "../../i18n";
import { Icon } from "../Icon";

const CARD = "rounded-xl2 border border-line bg-panel";
const BTN_BORDERED =
  "text-[12.5px] px-3 py-2 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0";
const BADGE =
  "text-[11px] px-2 py-0.5 rounded-full border border-line bg-paper text-muted shrink-0";

// Settings ▸ Skills — the installed-list half of SKILLS-SPEC §5/§6: enable/disable, edit,
// two-step delete, folder reveal for rich (multi-file) skills, source badge for anything
// that didn't come from the write-it-yourself door.
export function InstalledSkills({ rows, onEdit, onChanged, onNotice, onError }: {
  rows: SkillRow[];
  onEdit: (row: SkillRow) => void;
  onChanged: () => void;
  onNotice: (n: { name: string; text: string; tone: "ok" | "warn" } | null) => void;
  onError: (msg: string) => void;
}) {
  const t = useT();
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const fail = (res: { ok?: boolean; error?: string }) => {
    onNotice(null);
    if (res.ok === false) {
      onError(res.error || t("skWentWrong"));
      return true;
    }
    onError("");
    return false;
  };

  // 两步删除（SkillsTab.tsx:160-170 原样搬）：第一下上膛，第二下才发 DELETE。
  const remove = async (row: SkillRow) => {
    if (armedDelete !== row.name) {
      setArmedDelete(row.name);
      return;
    }
    setArmedDelete(null);
    const res = await deleteSkill(row.name);
    if (fail(res)) return;
    onNotice({ name: row.name, text: t("skRemoved"), tone: "warn" });
    onChanged();
  };

  // 空状态不在这里画：SkillsView 只在 rows.length > 0 时才渲染这个组件（它自己的
  // 空状态块负责那一半），所以 rows 在这里永远非空。
  return (
    <div className={`${CARD} divide-y divide-line`}>
      {rows.map((row) => (
        <div
          key={row.name}
          className="flex items-center gap-3 px-4 py-3"
          data-testid={`skill-${row.name}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[13px] font-medium ${row.enabled ? "" : "text-muted"}`}>
                {row.name}
              </span>
              {row.source !== "local" ? <span className={BADGE}>{row.source}</span> : null}
              {/* §6: a rich skill must not look identical to a one-file one. Styled as a
                  chip with a folder icon so it READS as clickable (live drive: plain
                  text hid the affordance). */}
              {row.files ? (
                <button
                  className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md border border-line bg-paper text-muted hover:text-ink hover:border-lineStrong shrink-0"
                  title={t("skShowFolder")}
                  onClick={() => revealSkill(row.name)}
                >
                  <Icon name="folder" size={11} /> {row.files} file{row.files === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
            {/* Full description, wrapping — a skill's one-liner is its menu entry; cutting
                it mid-word hid what the skill does (live drive). */}
            <div className="text-[12px] text-muted leading-relaxed">{row.description}</div>
          </div>
          <button className={BTN_BORDERED} title="Edit" onClick={() => onEdit(row)}>
            <Icon name="pencil" size={13} />
          </button>
          <button
            className={BTN_BORDERED}
            // aria-label 保持英文：它是给读屏和测试用的稳定句柄，不是可见文案。
            aria-label={`Delete ${row.name}`}
            data-testid={`remove-${row.name}`}
            onClick={() => remove(row)}
            onBlur={() => setArmedDelete(null)}
          >
            {armedDelete === row.name ? t("skConfirmDelete") : <Icon name="trash" size={13} />}
          </button>
          <label className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <input
              type="checkbox"
              role="switch"
              // aria-label 保持英文：它是给读屏和测试用的稳定句柄，不是可见文案。
              aria-label={`${row.name} enabled`}
              checked={row.enabled}
              onChange={(e) => {
                const on = e.target.checked;
                updateSkill(row.name, { enabled: on }).then((res) => {
                  if (!fail(res))
                    onNotice({
                      name: row.name,
                      text: on ? t("skConfirmation") : t("skTurnedOff"),
                      tone: on ? "ok" : "warn",
                    });
                  onChanged();
                });
              }}
            />
            {t("skOn")}
          </label>
        </div>
      ))}
    </div>
  );
}
