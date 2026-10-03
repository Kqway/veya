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
          Заблокировать
        </button>
        <button
          type="button"
          disabled={action.busy}
          className="social-text-button"
          onClick={() => setReport(!report)}
        >
          Пожаловаться
        </button>
      </div>
      {confirmBlock && (
        <div className="social-warning">
          <p>
            Блокировка прекращает общение с этим человеком. Полученная история сообщений и скопированные ссылки-приглашения в планы остаются доступными.
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
                    setStatus("Пользователь заблокирован. Общение прекращено.");
                    setConfirmBlock(false);
                    onBlocked?.();
                  }
                });
              }}
            >
              Подтвердить блокировку
            </button>
            <button
              type="button"
              className="social-text-button"
              onClick={() => setConfirmBlock(false)}
            >
              Отменить блокировку
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
                throw new Error("Используйте не более 1000 символов.");
              await socialApi("/reports", "POST", {
                ...target,
                reason,
                ...(text.trim() ? { text: text.trim() } : {}),
              });
              if (alive()) {
                setStatus("Жалоба получена.");
                setReport(false);
                setText("");
              }
            });
          }}
        >
          <label className="field">
            Причина жалобы
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="spam">Спам</option>
              <option value="harassment">Преследование или оскорбления</option>
              <option value="unsafe_meeting">Небезопасная встреча</option>
              <option value="impersonation">Выдаёт себя за другого человека</option>
              <option value="other">Другое</option>
            </select>
          </label>
          <label className="field">
            Подробности жалобы (необязательно)
            <textarea
              maxLength={1000}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button className="button button-secondary" disabled={action.busy}>
            Отправить жалобу
          </button>
        </form>
      )}
      <SocialError message={action.error} focusRef={action.errorRef} />
      {status && <p role="status">{status}</p>}
    </div>
  );
}
