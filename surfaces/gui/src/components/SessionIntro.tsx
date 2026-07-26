import { useState } from "react";
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
const FOLDER_PROMPT = "Analyze the files in this folder and summarize what matters.";
const WRITE_PROMPT =
  "Read the files in this folder and write me one document that pulls the important parts together. Save it in the folder.";
const TIDY_PROMPT =
  "Look through this folder, tell me how you'd rename and organise the files so they make sense, and do it once I say yes.";

export function SessionIntro({
  sessionId,
  onPrefill,
}: {
  sessionId: string;
  onPrefill: (text: string, attachments?: Attachment[]) => void;
}) {
  const { roots, busy, error, addRoot } = useRoots(sessionId);
  const [addingFolder, setAddingFolder] = useState(false);

  const shared = roots.filter((r) => !r.primary);

  const pickFolder = () => {
    // A shared folder already exists → straight to the prompt; otherwise share one first.
    if (shared.length > 0) onPrefill(FOLDER_PROMPT);
    else setAddingFolder((v) => !v);
  };

  return (
    <div className="intro">
      <h1 className="greeting">
        <span className="mark">✦</span> What should we produce?
      </h1>
      <p className="intro-lede">
        Pick a task to start — I'll do the work and save the result. Or just type what you need
        below.
      </p>

      <div className="intro-tasks">
        <button className="task-card" data-testid="intro-task-folder" onClick={pickFolder}>
          <span className="task-card-body">
            <span className="task-card-title">Analyze the files in a directory</span>
            <span className="task-card-sub">I'll read them and summarize what matters</span>
          </span>
          <span className="task-card-act">Pick a folder →</span>
        </button>
        {addingFolder && (
          <div className="intro-addfolder">
            <AddFolderForm
              startOpen
              busy={busy}
              onAdd={async (path, writable) => {
                const ok = await addRoot(path, writable);
                if (ok !== false) onPrefill(FOLDER_PROMPT);
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
          onClick={() => onPrefill(WRITE_PROMPT)}
        >
          <span className="task-card-body">
            <span className="task-card-title">Write one document from a folder of files</span>
            <span className="task-card-sub">I'll read them and draft it for you to edit</span>
          </span>
          <span className="task-card-act">Start →</span>
        </button>

        <button
          className="task-card"
          data-testid="intro-task-tidy"
          onClick={() => onPrefill(TIDY_PROMPT)}
        >
          <span className="task-card-body">
            <span className="task-card-title">Sort out a folder that's become a mess</span>
            <span className="task-card-sub">I'll propose names and an order, and wait for your go-ahead</span>
          </span>
          <span className="task-card-act">Start →</span>
        </button>
      </div>
    </div>
  );
}
