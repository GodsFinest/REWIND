import { useMemo, useState } from "react";
import type { RecoveryRecommendation, SnapshotSummary } from "./api";

export function RecoverySuggestion({
  recommendation,
  snapshots,
  busy,
  onAnalyze,
  onSelect,
}: {
  recommendation?: RecoveryRecommendation;
  snapshots: SnapshotSummary[];
  busy: boolean;
  onAnalyze: () => void;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const rows = useMemo(
    () =>
      recommendation?.eligibleVersions.filter((v) =>
        v.path.toLowerCase().includes(search.toLowerCase()),
      ) ?? [],
    [recommendation, search],
  );
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  const label = (id: string) =>
    snapshots.find((s) => s.id === id)?.label || id.slice(0, 10);
  return (
    <section
      className="panel recovery-suggestion"
      aria-label="Suggested recovery"
    >
      <div className="section-title">
        <div>
          <span className="eyebrow">BYTE-VERIFIED DECISION SUPPORT</span>
          <h2>Suggested recovery</h2>
        </div>
        <button className="button" disabled={busy} onClick={onAnalyze}>
          Analyze recovery options
        </button>
      </div>
      {!recommendation ? (
        <p className="small muted">
          Run a new deep scan to find a complete snapshot and individually
          verified historical file versions.
        </p>
      ) : (
        <>
          <p className="small">
            {recommendation.newestComplete ? (
              <>
                Latest complete verified snapshot:{" "}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => onSelect(recommendation.newestComplete!)}
                >
                  {label(recommendation.newestComplete)} · Inspect snapshot
                </button>
              </>
            ) : (
              "No complete snapshot is verified recoverable in this scan."
            )}
          </p>
          <div className="notice caution">
            <p>
              {recommendation.warning} Evidence is from{" "}
              {new Date(recommendation.scan.at).toLocaleString()} in{" "}
              {recommendation.scope} scope. Restore rechecks bytes; later
              failures remain possible.
            </p>
          </div>
          <h3>
            {recommendation.eligibleVersions.length.toLocaleString()}{" "}
            individually verified file versions
          </h3>
          <p className="footnote">
            Selective salvage may combine different historical moments. Inspect
            a snapshot, then use the explicit single-snapshot restore controls.
            This recommendation does not execute recovery or replica repair.
          </p>
          <label className="field">
            Search suggested paths
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {!rows.length ? (
            <p className="muted">
              {recommendation.eligibleVersions.length
                ? "No matching paths."
                : "No individually verified file versions are available."}
            </p>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Originating snapshot</th>
                      <th>Selection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(current * 25, current * 25 + 25).map((v) => (
                      <tr key={v.path}>
                        <td className="mono break">{v.path}</td>
                        <td>
                          {label(v.snapshotId)}{" "}
                          <code>{v.snapshotId.slice(0, 10)}</code>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => onSelect(v.snapshotId)}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="toolbar-right">
                <button
                  className="button small-button"
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                >
                  Previous
                </button>
                <span className="small">
                  {current * 25 + 1}–{Math.min(rows.length, current * 25 + 25)}{" "}
                  of {rows.length}
                </span>
                <button
                  className="button small-button"
                  disabled={(current + 1) * 25 >= rows.length}
                  onClick={() => setPage(current + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
