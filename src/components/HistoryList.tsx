import { useState } from "react";
import type { Handedness, SavedResult, ViewAngle } from "../lib/types";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface HistoryListProps {
  items: SavedResult[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<SavedResult>) => void;
}

export function HistoryList({ items, onDelete, onUpdate }: HistoryListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftHand, setDraftHand] = useState<Handedness>("right");
  const [draftAngle, setDraftAngle] = useState<ViewAngle>("side");
  const [draftNote, setDraftNote] = useState("");

  if (items.length === 0) return null;

  function startEdit(r: SavedResult) {
    setEditingId(r.id);
    setDraftHand(r.hand);
    setDraftAngle(r.viewAngle);
    setDraftNote(r.note ?? "");
  }

  function saveEdit(id: string) {
    onUpdate(id, { hand: draftHand, viewAngle: draftAngle, note: draftNote });
    setEditingId(null);
  }

  return (
    <div className="history-list">
      <h2>保存した結果</h2>
      <ul>
        {items.map((r) => {
          const isEditing = editingId === r.id;
          return (
            <li key={r.id} className="history-item">
              <div className="history-item-row">
                <span className="history-score">{r.overallScore}</span>
                <div className="history-meta">
                  <span>{formatDate(r.savedAt)}</span>
                  <span>
                    {r.hand === "right" ? "右" : "左"}・{r.viewAngle === "side" ? "真横" : "正面"}
                  </span>
                  {r.note && !isEditing && <span className="history-note-preview">{r.note}</span>}
                </div>
                <button
                  type="button"
                  className="history-edit"
                  onClick={() => (isEditing ? setEditingId(null) : startEdit(r))}
                  aria-label="この記録を編集"
                >
                  {isEditing ? "閉じる" : "✏️"}
                </button>
                <button type="button" className="history-delete" onClick={() => onDelete(r.id)} aria-label="この記録を削除">
                  🗑
                </button>
              </div>

              {isEditing && (
                <div className="history-edit-panel">
                  <div className="history-metric-list">
                    {r.metrics.map((m) => (
                      <div key={m.label} className="history-metric-row">
                        <span>{m.label}</span>
                        <span>{m.score}</span>
                      </div>
                    ))}
                  </div>
                  <div className="history-edit-fields">
                    <label className="hand-select">
                      利き手:
                      <select value={draftHand} onChange={(e) => setDraftHand(e.target.value as Handedness)}>
                        <option value="right">右</option>
                        <option value="left">左</option>
                      </select>
                    </label>
                    <label className="hand-select">
                      アングル:
                      <select value={draftAngle} onChange={(e) => setDraftAngle(e.target.value as ViewAngle)}>
                        <option value="side">真横から</option>
                        <option value="front">正面から</option>
                      </select>
                    </label>
                  </div>
                  <textarea
                    className="history-note-input"
                    placeholder="メモを追加..."
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                  />
                  <button type="button" className="primary-btn" onClick={() => saveEdit(r.id)}>
                    保存
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
