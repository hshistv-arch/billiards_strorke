import type { SavedResult } from "../lib/types";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryList({ items, onDelete }: { items: SavedResult[]; onDelete: (id: string) => void }) {
  if (items.length === 0) return null;

  return (
    <div className="history-list">
      <h2>保存した結果</h2>
      <ul>
        {items.map((r) => (
          <li key={r.id} className="history-item">
            <span className="history-score">{r.overallScore}</span>
            <div className="history-meta">
              <span>{formatDate(r.savedAt)}</span>
              <span>
                {r.hand === "right" ? "右" : "左"}・{r.viewAngle === "side" ? "真横" : "正面"}
                {r.cueBallMetrics ? "・詳細解析あり" : ""}
              </span>
            </div>
            <button type="button" className="history-delete" onClick={() => onDelete(r.id)} aria-label="この記録を削除">
              🗑
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
