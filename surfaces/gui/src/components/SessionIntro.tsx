import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Attachment } from "../types";
import { useRoots } from "../useRoots";
import { AddFolderForm } from "./AddFolderForm";

// Empty-state for a fresh Cowork session (§27): a greeting, exactly three concrete template
// tasks, and the composer — nothing else. Each task carries its own setup: no icon tiles (the
// title is the row), connector dots on the sub-line (brand color = connected and enabled for
// this session, grayscale = not — §23's vocabulary), and sub-line copy that is always the task's
// OUTCOME, never connection state. Sources ready → "Start →" on hover, click prefills the
// composer. Not ready → "Configure ›" always visible (for a gated row the setup action IS the
// row's meaning), opening the §23 Session settings drawer — no second setup surface here.

// All three tasks work with nothing but a folder. Two of them used to be HubSpot
// and GitHub→Slack, whose "Configure ›" led to the connector sign-in — brokered by
// OpenWorker Cloud, a service this project does not run. That page is hidden now,
// so those rows were an invitation into a door that no longer opens.
//
// The prompts live in the string catalog with the labels: a card that reads
// Chinese and drops English into the composer gets an English answer back.

export function SessionIntro({
  sessionId,
  onPrefill,
}: {
  sessionId: string;
  onPrefill: (text: string, attachments?: Attachment[]) => void;
}) {
  const { t } = useTranslation();
  const { roots, busy, error, addRoot } = useRoots(sessionId);
  const [addingFolder, setAddingFolder] = useState(false);

  const shared = roots.filter((r) => !r.primary);

  const pickFolder = () => {
    // A shared folder already exists → straight to the prompt; otherwise share one first.
    if (shared.length > 0) onPrefill(t("intro.folder_prompt"));
    else setAddingFolder((v) => !v);
  };

  return (
    <div className="intro">
      <h1 className="greeting">
        <span className="mark">✦</span> {t("intro.greeting")}
      </h1>
      <p className="intro-lede">{t("intro.lede")}</p>

      <div className="intro-tasks">
        <button className="task-card" data-testid="intro-task-folder" onClick={pickFolder}>
          <span className="task-card-body">
            <span className="task-card-title">{t("intro.task_folder_title")}</span>
            <span className="task-card-sub">{t("intro.task_folder_sub")}</span>
          </span>
          <span className="task-card-act">{t("intro.task_folder_cta")}</span>
        </button>
        {addingFolder && (
          <div className="intro-addfolder">
            <AddFolderForm
              startOpen
              busy={busy}
              onAdd={async (path, writable) => {
                const ok = await addRoot(path, writable);
                if (ok !== false) onPrefill(t("intro.folder_prompt"));
                return ok;
              }}
              onDismiss={() => setAddingFolder(false)}
            />
            {error && <div className="roots-err">{error}</div>}
          </div>
        )}

        <button
          className="task-card"
          data-testid="intro-task-write"
          onClick={() => onPrefill(t("intro.write_prompt"))}
        >
          <span className="task-card-body">
            <span className="task-card-title">{t("intro.task_write_title")}</span>
            <span className="task-card-sub">{t("intro.task_write_sub")}</span>
          </span>
          <span className="task-card-act">{t("intro.cta_start")}</span>
        </button>

        <button
          className="task-card"
          data-testid="intro-task-tidy"
          onClick={() => onPrefill(t("intro.tidy_prompt"))}
        >
          <span className="task-card-body">
            <span className="task-card-title">{t("intro.task_tidy_title")}</span>
            <span className="task-card-sub">{t("intro.task_tidy_sub")}</span>
          </span>
          <span className="task-card-act">{t("intro.cta_start")}</span>
        </button>
      </div>
    </div>
  );
}
