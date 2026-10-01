"use client";
import { useState } from "react";
import { socialApi, useSocialAction } from "../client";
import { SocialError } from "./common";
export function SafetyControls({
  target,
  onBlocked,
}: {
  target: { requestKey: string } | { matchKey: string };
  onBlocked?: () => void;
}) {
  const [confirmBlock, setConfirmBlock] = useState(false),
    [report, setReport] = useState(false),
    [reason, setReason] = useState("spam"),
    [text, setText] = useState(""),
    [status, setStatus] = useState("");
  const action = useSocialAction();
  return (
    <div className="social-safety-controls">
      <div className="social-actions">
        <button
          type="button"
          disabled={action.busy}
          className="social-text-button"
          onClick={() => setConfirmBlock(true)}
        >
          Block
        </button>
        <button
          type="button"
          disabled={action.busy}
          className="social-text-button"
          onClick={() => setReport(!report)}
        >
          Report
        </button>
      </div>
      {confirmBlock && (
        <div className="social-warning">
          <p>
            Blocking closes social contact with this person. Received history
            and any copied plan invitation links remain accessible.
          </p>
          <div className="social-actions">
            <button
              type="button"
              disabled={action.busy}
              className="button button-secondary"
              onClick={() => {
                void action.run(async (alive) => {
                  await socialApi("/block", "POST", target);
                  if (alive()) {
                    setStatus("Blocked. Social contact is closed.");
                    setConfirmBlock(false);
                    onBlocked?.();
                  }
                });
              }}
            >
              Confirm block
            </button>
            <button
              type="button"
              className="social-text-button"
              onClick={() => setConfirmBlock(false)}
            >
              Cancel block
            </button>
          </div>
        </div>
      )}
      {report && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async (alive) => {
              if (text.length > 1000)
                throw new Error("Use at most 1000 characters.");
              await socialApi("/reports", "POST", {
                ...target,
                reason,
                ...(text.trim() ? { text: text.trim() } : {}),
              });
              if (alive()) {
                setStatus("Report received.");
                setReport(false);
                setText("");
              }
            });
          }}
        >
          <label className="field">
            Report reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="spam">Spam</option>
              <option value="harassment">Harassment</option>
              <option value="unsafe_meeting">Unsafe meeting</option>
              <option value="impersonation">Impersonation</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field">
            Report details (optional)
            <textarea
              maxLength={1000}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button className="button button-secondary" disabled={action.busy}>
            Send report
          </button>
        </form>
      )}
      <SocialError message={action.error} focusRef={action.errorRef} />
      {status && <p role="status">{status}</p>}
    </div>
  );
}
