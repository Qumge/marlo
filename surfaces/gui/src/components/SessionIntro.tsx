import { useState } from "react";
import { useT } from "../i18n";
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
  const t = useT();
  const { roots, busy, error, addRoot } = useRoots(sessionId);
  const [addingFolder, setAddingFolder] = useState(false);

  const shared = roots.filter((r) => !r.primary);

  const pickFolder = () => {
    // A shared folder already exists → straight to the prompt; otherwise share one first.
    if (shared.length > 0) onPrefill(t("promptAnalyze"));
    else setAddingFolder((v) => !v);
  };

  return (
    <div className="intro">
      <h1 className="greeting">
        <span className="mark">✦</span> {t("introGreeting")}
      </h1>
      <p className="intro-lede">{t("introLede")}</p>

      <div className="intro-tasks">
        <button className="task-card" data-testid="intro-task-folder" onClick={pickFolder}>
          <span className="task-card-body">
            <span className="task-card-title">{t("taskAnalyzeTitle")}</span>
            <span className="task-card-sub">{t("taskAnalyzeSub")}</span>
          </span>
          <span className="task-card-act">{t("taskAnalyzeAct")}</span>
        </button>
        {addingFolder && (
          <div className="intro-addfolder">
            <AddFolderForm
              startOpen
              busy={busy}
              onAdd={async (path, writable) => {
                const ok = await addRoot(path, writable);
                if (ok !== false) onPrefill(t("promptAnalyze"));
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
          onClick={() => onPrefill(t("promptWrite"))}
        >
          <span className="task-card-body">
            <span className="task-card-title">{t("taskWriteTitle")}</span>
            <span className="task-card-sub">{t("taskWriteSub")}</span>
          </span>
          <span className="task-card-act">{t("taskStart")}</span>
        </button>

        <button
          className="task-card"
          data-testid="intro-task-tidy"
          onClick={() => onPrefill(t("promptTidy"))}
        >
          <span className="task-card-body">
            <span className="task-card-title">{t("taskTidyTitle")}</span>
            <span className="task-card-sub">{t("taskTidySub")}</span>
          </span>
          <span className="task-card-act">{t("taskStart")}</span>
        </button>
      </div>
    </div>
  );
}
