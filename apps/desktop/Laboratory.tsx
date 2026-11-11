import {
  History,
  ArrowRight,
  Database,
  Download,
  File,
  FlaskConical,
  GitBranch,
  HardDrive,
  RotateCcw,
  Unplug,
  Zap,
} from "lucide-react";
import type {
  AppState,
  FaultKind,
  Request,
  Scope,
  SnapshotSummary,
} from "./api";
import { Empty, Status, bytes, saveJSON, short, stateKeys } from "./ui";
export type RepairPlan = {
  target: number;
  budget: number;
  method: string;
  bytes: number;
  utility: number;
  chunks: unknown[];
  baselineUtility: number;
  optimal?: boolean;
};
interface Props {
  seed: number;
  setSeed: (n: number) => void;
  isBusy: boolean;
  snapshots: SnapshotSummary[];
  data: AppState;
  scope: Scope;
  run: (
    label: string,
    request: Request,
    options?: { scope?: Scope; reset?: boolean; success?: string },
  ) => Promise<void>;
  query: <T>(
    label: string,
    request: Request,
    apply: (v: T) => void,
  ) => Promise<void>;
  faultKind: FaultKind;
  setFaultKind: (v: FaultKind) => void;
  faultBackend: number;
  setFaultBackend: (v: number) => void;
  faultHash: string;
  setFaultHash: (v: string) => void;
  changeScope: (s: Scope) => void;
  navigate: (s: "frontier") => void;
  totalVersions: number;
  budget: string;
  setBudget: (s: string) => void;
  plan?: RepairPlan;
  setPlan: (p: RepairPlan) => void;
}
export function Laboratory({
  seed,
  setSeed,
  run,
  isBusy,
  snapshots,
  data,
  scope,
  query,
  faultKind,
  setFaultKind,
  faultBackend,
  setFaultBackend,
  faultHash,
  setFaultHash,
  changeScope,
  navigate,
  totalVersions,
  budget,
  setBudget,
  plan,
  setPlan,
}: Props) {
  return (
    <>
      <section className="lab-intro panel">
        <div className="lab-intro-icon">
          <FlaskConical size={36} strokeWidth={1.2} />
        </div>
        <div>
          <span className="eyebrow">
            FAILURE IS MORE USEFUL WHEN IT IS EXPLAINABLE.
          </span>
          <h2>A disaster you can safely inspect.</h2>
          <p>
            REWIND copies your stored data into a dedicated laboratory. Faults
            change that copy, then real byte scans recompute the recovery
            frontier.
          </p>
        </div>
        <div className="lab-create">
          <label className="field">
            Scenario seed
            <input
              aria-label="Scenario seed"
              type="number"
              min="1"
              step="1"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
          <button
            className="button primary"
            disabled={
              isBusy ||
              !snapshots.length ||
              !Number.isSafeInteger(seed) ||
              seed < 1
            }
            onClick={() =>
              void run(
                "Creating isolated laboratory",
                { action: "create-lab", seed },
                {
                  scope: "lab",
                  reset: true,
                  success:
                    "Physical laboratory copy created. Original repositories untouched.",
                },
              )
            }
          >
            <FlaskConical size={15} />
            {data.lab ? "Recreate lab" : "Create lab copy"}
          </button>
        </div>
      </section>
      {data.lab ? (
        <>
          <div className="lab-details">
            <div>
              <span className="eyebrow">ACTIVE LAB</span>
              <code>{short(data.lab.id)}</code>
            </div>
            <div>
              <span className="eyebrow">REPLAY SEED</span>
              <code>{data.lab.seed}</code>
            </div>
            <div>
              <span className="eyebrow">RECORDED ACTIONS</span>
              <code>{data.lab.actions.length}</code>
            </div>
            <div className="lab-detail-actions">
              <button
                className="button small-button"
                disabled={isBusy}
                onClick={() =>
                  void run(
                    "Resetting and replaying lab",
                    { action: "replay-lab" },
                    { scope: "lab", reset: true },
                  )
                }
              >
                <RotateCcw size={14} />
                Reset & replay
              </button>
              <button
                className="button small-button"
                disabled={isBusy}
                onClick={() =>
                  void query<unknown>(
                    "Exporting scenario",
                    { action: "scenario" },
                    (v) =>
                      saveJSON(v, `rewind-scenario-${data.lab?.seed}.json`),
                  )
                }
              >
                <Download size={14} />
                Scenario JSON
              </button>
            </div>
          </div>
          <div className="lab-grid">
            <section className="panel fault-panel">
              <div className="section-title">
                <div>
                  <span className="eyebrow">DETERMINISTIC FAULT INJECTION</span>
                  <h2>Choose the failure.</h2>
                </div>
                <Unplug size={20} className="warn" />
              </div>
              <div className="fault-form">
                <label className="field">
                  Fault type
                  <select
                    value={faultKind}
                    onChange={(e) => setFaultKind(e.target.value as FaultKind)}
                  >
                    <option value="corrupt">Bit-flip a chunk</option>
                    <option value="missing">Remove one chunk copy</option>
                    <option value="unavailable">
                      Make a backend unavailable
                    </option>
                    <option value="io-error">
                      Simulate a backend I/O failure
                    </option>
                    <option value="manifest">Corrupt a manifest copy</option>
                  </select>
                </label>
                <div className="backend-choice">
                  <span>Target backend</span>
                  <div>
                    <button
                      className={faultBackend === 0 ? "active" : ""}
                      onClick={() => setFaultBackend(0)}
                    >
                      <HardDrive size={16} />A
                    </button>
                    <button
                      className={faultBackend === 1 ? "active" : ""}
                      onClick={() => setFaultBackend(1)}
                    >
                      <HardDrive size={16} />B
                    </button>
                  </div>
                </div>
                {(faultKind === "corrupt" || faultKind === "missing") && (
                  <label className="field">
                    Chunk SHA-256 <span className="muted">(optional)</span>
                    <input
                      className="mono"
                      placeholder="Leave empty for seeded selection"
                      value={faultHash}
                      onChange={(e) => setFaultHash(e.target.value.trim())}
                    />
                  </label>
                )}
                <p className="small muted">
                  {faultKind === "unavailable"
                    ? "The lab backend is treated as inaccessible; unknown data is not declared lost."
                    : faultKind === "manifest"
                      ? "Damages one lab manifest copy. The other copy is evaluated independently."
                      : faultKind === "io-error"
                        ? "Simulates read errors through the isolated lab provider. No source files are changed."
                        : "The seeded selector picks a real stored chunk. Deep verification and dependency analysis run after mutation."}
                </p>
                <button
                  className="button danger"
                  disabled={
                    isBusy ||
                    scope !== "lab" ||
                    (!!faultHash && !/^[a-f0-9]{64}$/.test(faultHash))
                  }
                  title={
                    scope !== "lab"
                      ? "Switch to Lab scope to run a fault"
                      : undefined
                  }
                  onClick={() =>
                    void run(
                      "Injecting laboratory fault",
                      {
                        action: "fault",
                        kind: faultKind,
                        backend: faultBackend,
                        hash: faultHash || undefined,
                      },
                      {
                        scope: "lab",
                        success:
                          "Fault applied to isolated lab data; recovery evidence refreshed. Original repositories untouched.",
                      },
                    )
                  }
                >
                  <Zap size={15} />
                  Inject fault & analyze
                </button>
                {scope !== "lab" && (
                  <button
                    className="text-button"
                    onClick={() => changeScope("lab")}
                  >
                    Switch to laboratory scope
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </section>
            <section className="panel impact-panel">
              <div className="section-title">
                <div>
                  <span className="eyebrow">OBSERVED IMPACT</span>
                  <h2>Follow the dependency.</h2>
                </div>
              </div>
              <div className="dependency-diagram">
                <div>
                  <History size={19} />
                  <strong>{snapshots.length}</strong>
                  <span>snapshots</span>
                </div>
                <span className="connector" />
                <div>
                  <File size={19} />
                  <strong>{totalVersions}</strong>
                  <span>file versions</span>
                </div>
                <span className="connector" />
                <div>
                  <Database size={19} />
                  <strong>{data.stats.chunks}</strong>
                  <span>unique chunks</span>
                </div>
              </div>
              <div className="impact-summary">
                {stateKeys.map((key) => (
                  <div key={key}>
                    <Status state={key} />
                    <strong className="mono">
                      {snapshots.reduce(
                        (n, s) => n + (s.counts?.[key] ?? 0),
                        0,
                      )}
                    </strong>
                  </div>
                ))}
              </div>
              <button
                className="button full-width"
                onClick={() => navigate("frontier")}
              >
                Inspect exact affected versions
                <ArrowRight size={15} />
              </button>
              <p className="footnote">
                Counts reflect the currently selected scope. Select a file in
                Recovery frontier to see shared-chunk fan-out and exact copy
                evidence.
              </p>
            </section>
          </div>
          <section className="panel action-log">
            <div className="section-title">
              <div>
                <span className="eyebrow">REPLAYABLE RECORD</span>
                <h2>Scenario actions</h2>
              </div>
            </div>
            {data.lab.actions.length ? (
              <pre>{JSON.stringify(data.lab.actions, null, 2)}</pre>
            ) : (
              <p className="muted">
                No faults recorded. Start with one corrupt copy on A, then
                inspect how B preserves recovery.
              </p>
            )}
          </section>
        </>
      ) : (
        <Empty icon={FlaskConical} title="No laboratory copy yet">
          Create a lab from the current backup history. Originals are never
          accepted by the fault mutation API.
        </Empty>
      )}
      <section className="panel repair-panel">
        <div className="section-title">
          <div>
            <span className="eyebrow">BUDGET-AWARE REPLICA REPAIR</span>
            <h2>Make a plan for backend {faultBackend === 0 ? "A" : "B"}.</h2>
          </div>
          <span className="tiny-tag">PLAN ONLY</span>
        </div>
        <p className="small muted">
          Choose chunks within a byte budget to recover complete file versions
          on the target backend. This does not execute repairs.
        </p>
        <div className="repair-controls">
          <label className="field">
            Transfer budget (bytes)
            <input
              type="number"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <button
            className="button"
            disabled={
              isBusy ||
              !data.scan?.deep ||
              !Number.isFinite(Number(budget)) ||
              Number(budget) < 0
            }
            title={!data.scan?.deep ? "Run deep verification first" : undefined}
            onClick={() =>
              void query<RepairPlan>(
                "Planning replica repairs",
                {
                  action: "repair-plan",
                  scope,
                  target: faultBackend,
                  budget: Number(budget),
                },
                setPlan,
              )
            }
          >
            <GitBranch size={15} />
            Calculate plan
          </button>
        </div>
        {plan && (
          <div className="plan-result">
            <dl>
              <div>
                <dt>Method</dt>
                <dd>{plan.method}</dd>
              </div>
              <div>
                <dt>Transfer</dt>
                <dd>{bytes(plan.bytes)}</dd>
              </div>
              <div>
                <dt>Recovered version utility</dt>
                <dd>{plan.utility}</dd>
              </div>
              <div>
                <dt>Naive baseline utility</dt>
                <dd>{plan.baselineUtility}</dd>
              </div>
              <div>
                <dt>Selected chunks</dt>
                <dd>{plan.chunks.length}</dd>
              </div>
            </dl>
            <p className="footnote">
              {plan.optimal
                ? "Exact optimum within the bounded candidate set."
                : "Heuristic plan; global optimality is not claimed."}{" "}
              No storage bytes were changed.
            </p>
            <button
              className="text-button"
              onClick={() => saveJSON(plan, "rewind-repair-plan.json")}
            >
              <Download size={13} />
              Export plan
            </button>
          </div>
        )}
      </section>
    </>
  );
}
