import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isDeepStrictEqual } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import {
  objectPath,
  scenarioRecord,
  IneligibleFaultTargetError,
  createRepository,
  captureSnapshot,
  createFaultLab,
  injectFault,
  labRepository,
  scanHealth,
  getSnapshot,
  listSnapshots,
  entryState,
  storageAccounting,
  restoreSnapshot,
  verifyRestored,
  randomBytes,
  propagateImpact,
  analyzeFrontier,
  fileRows,
  solveRepair,
  type Manifest,
} from "../core/index.js";
import { oracle } from "./oracle.js";
const seed = 2409,
  root = path.resolve(".rewind/evaluation", randomUUID());
await fs.mkdir(root, { recursive: true });
const started = new Date().toISOString();
const timings: Record<string, number> = {};
async function measured<T>(name: string, work: () => Promise<T>) {
  const t = performance.now();
  const value = await work();
  timings[name] = performance.now() - t;
  console.log(`${name}: ${timings[name].toFixed(1)} ms`);
  return value;
}
let comparisons = 0,
  agreements = 0,
  falsePositives = 0,
  rejectedFaultRequests = 0;
const failures: string[] = [],
  seeds: number[] = [];
function independentHash(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}
const small = path.join(root, "small");
await fs.mkdir(small);
await fs.mkdir(path.join(small, "source"));
const known = new Map<string, Buffer>([
  ["shared-a.bin", randomBytes(350000, seed)],
  ["shared-b.bin", randomBytes(350000, seed)],
  ["unique.bin", randomBytes(90000, 51)],
  ["empty.txt", Buffer.alloc(0)],
]);
for (const [name, bytes] of known)
  await fs.writeFile(path.join(small, "source", name), bytes);
const repo = await createRepository(
  path.join(small, "repository"),
  path.join(small, "source"),
  [path.join(small, "a"), path.join(small, "b")],
);
const s1 = await captureSnapshot(repo, "Oracle S1");
await fs.writeFile(
  path.join(small, "source", "new.txt"),
  "independent source evidence",
);
known.set("new.txt", Buffer.from("independent source evidence"));
const s2 = await captureSnapshot(repo, "Oracle S2");
const manifests = new Map<string, Manifest>([
  [s1, await getSnapshot(repo, s1)],
  [s2, await getSnapshot(repo, s2)],
]);
for (const manifest of manifests.values())
  for (const e of manifest.entries)
    if (e.type === "file" && independentHash(known.get(e.path)!) !== e.hash)
      throw new Error("Manifest disagrees with known-good source bytes");
await measured("oracleScenariosMs", async () => {
  for (let scenarioSeed = 1; scenarioSeed <= 32; scenarioSeed++) {
    seeds.push(scenarioSeed);
    const lab = await createFaultLab(
      repo,
      path.join(root, "labs"),
      scenarioSeed,
    );
    const hashes = [
      ...new Set(
        [...manifests.values()].flatMap((m) =>
          m.entries.flatMap((e) =>
            e.type === "file" ? e.chunks.map((c) => c.hash) : [],
          ),
        ),
      ),
    ].sort();
    let x = (scenarioSeed * 2654435761) >>> 0;
    const next = () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x >>> 0;
    };
    if (scenarioSeed > 1)
      for (let i = 0; i < 1 + (scenarioSeed % 5); i++) {
        const h = hashes[next() % hashes.length],
          backend = next() % 2,
          kind = next() % 2 ? "missing" : "corrupt";
        const target = objectPath(
          (await labRepository(lab)).config.roots[backend],
          h,
        );
        const bytes = async () => {
          try {
            return await fs.readFile(target);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT")
              return undefined;
            throw e;
          }
        };
        const before = await bytes(),
          actionsBefore = (await scenarioRecord(lab)).actions;
        try {
          await injectFault(lab, kind, backend, h);
        } catch (e) {
          if (!(e instanceof IneligibleFaultTargetError)) throw e;
          const after = await bytes();
          const unchanged =
            before === undefined
              ? after === undefined
              : after !== undefined && before.equals(after);
          if (
            (before && independentHash(before) === h) ||
            !unchanged ||
            !isDeepStrictEqual(
              (await scenarioRecord(lab)).actions,
              actionsBefore,
            )
          )
            throw new Error(
              "Rejected repeated fault changed bytes/actions or rejected intact data",
            );
          rejectedFaultRequests++;
        }
      }
    if (scenarioSeed % 4 === 0) await injectFault(lab, "unavailable", 1);
    if (scenarioSeed % 7 === 0) await injectFault(lab, "io-error", 0);
    const damaged = await labRepository(lab),
      scan = await scanHealth(damaged, true);
    for (const [id, manifest] of manifests) {
      const truth = await oracle(
        manifest,
        damaged.config.roots,
        damaged.disabled,
        damaged.ioErrors,
      );
      for (const file of manifest.entries)
        if (file.type === "file") {
          comparisons++;
          const expected = truth.get(file.path),
            actual = entryState(file, scan);
          if (expected === actual) agreements++;
          else {
            failures.push(
              `seed=${scenarioSeed} snapshot=${id} file=${file.path} expected=${expected} actual=${actual}`,
            );
            if (actual === "VERIFIED_RECOVERABLE") falsePositives++;
          }
        }
    }
    // Every scenario is physically copied; remove only this managed evaluation lab after measuring it.
    await fs.rm(path.join(root, "labs", lab.id), {
      recursive: true,
      force: true,
    });
  }
});
const bench = path.join(root, "benchmark"),
  source = path.join(bench, "source");
await fs.mkdir(source, { recursive: true });
await fs.mkdir(path.join(source, "records"));
await fs.mkdir(path.join(source, "empty"));
for (let i = 0; i < 10020; i++)
  await fs.writeFile(
    path.join(source, "records", `record-${String(i).padStart(5, "0")}.txt`),
    `seed ${seed}\ncategory ${i % 64}\n` +
      "repeated payload ".repeat((i % 5) + 1),
  );
const large = randomBytes(8 * 1024 * 1024, seed);
await fs.writeFile(path.join(source, "large.bin"), large);
await fs.writeFile(path.join(source, "large-copy.bin"), large);
await fs.writeFile(path.join(source, "empty.txt"), "");
const big = await createRepository(path.join(bench, "repository"), source, [
  path.join(bench, "a"),
  path.join(bench, "b"),
]);
const beforeUsage = process.resourceUsage();
const first = await measured("captureS1Ms", () =>
  captureSnapshot(big, "Benchmark S1"),
);
await fs.writeFile(
  path.join(source, "large.bin"),
  Buffer.concat([
    large.subarray(0, 100000),
    Buffer.from("insertion seed 2409"),
    large.subarray(100000),
  ]),
);
await fs.appendFile(
  path.join(source, "records/record-00000.txt"),
  "append edit",
);
await fs.rm(path.join(source, "records/record-00001.txt"));
await fs.writeFile(path.join(source, "new.txt"), "created then captured");
const latest = await measured("captureS2Ms", () =>
  captureSnapshot(big, "Benchmark S2"),
);
const scan = await measured("deepScanMs", () => scanHealth(big, true));
const stats = await storageAccounting(big);
const records = await listSnapshots(big);
const frontier = await measured("fullFrontierMs", async () =>
  analyzeFrontier(records, scan),
);
const page = await measured("page10000Ms", async () =>
  fileRows(records.at(-1), scan, 10000),
);
if (page.files.length > 50) throw new Error("Pagination failed");
const m = await getSnapshot(big, latest);
const shared = m.entries.find((e) => e.path === "large-copy.bin");
if (shared?.type !== "file") throw new Error("Fixture missing");
const hash = shared.chunks[Math.floor(shared.chunks.length / 2)].hash;
const impacts = await measured("incrementalImpactMs", () =>
  propagateImpact(big, scan, [hash]),
);
const receipt = await measured("restoreMs", () =>
  restoreSnapshot(big, latest, path.join(bench, "restored")),
);
const verification = await measured("independentVerifyMs", () =>
  verifyRestored(m, receipt.destination),
);
if (!verification.valid) failures.push("Benchmark restore verification failed");
const repairProblem = {
  costs: new Map([
    ["a", 5],
    ["b", 5],
    ["c", 5],
  ]),
  versions: [
    ...Array.from({ length: 4 }, () => ({
      missing: new Set(["a", "b"]),
      weight: 1,
    })),
    ...Array.from({ length: 3 }, () => ({
      missing: new Set(["c"]),
      weight: 1,
    })),
  ],
  budget: 5,
};
const repair = solveRepair(repairProblem);
const usage = process.resourceUsage();
const report = {
  version: 1,
  date: started,
  finishedAt: new Date().toISOString(),
  command: "npm run evaluate",
  seed,
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    os: os.release(),
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryBytes: os.totalmem(),
    filesystem:
      "Local workspace under iCloud Drive; warm OS cache; two directories on same volume; no independent disk fault domains",
  },
  scope: {
    snapshots: 2,
    filesPerSnapshot: m.entries.filter((e) => e.type === "file").length,
    largeFileBytes: large.length,
    oracleScenarios: 32,
    oracleFileComparisons: comparisons,
    regressionSeeds: seeds,
  },
  oracle: {
    agreements,
    comparisons,
    falsePositives,
    rejectedFaultRequests,
    failures,
  },
  storage: {
    ...stats,
    naiveBaseline: "sum of logical file bytes across both snapshots, one copy",
    singleCopySavings: stats.dedupSavings,
    replicatedObjectBytes: stats.objectBytes,
    replicatedVsTwoCopyNaiveSavings:
      1 - stats.objectBytes / (stats.logicalBytes * 2),
  },
  timings,
  throughput: {
    captureS1MiBPerSecond:
      frontier.find((s) => s.id === first)!.bytes /
      1048576 /
      (timings.captureS1Ms / 1000),
    restoreMiBPerSecond: receipt.bytes / 1048576 / (timings.restoreMs / 1000),
  },
  resources: {
    maxRssKiB: usage.maxRSS,
    userCpuMicros: usage.userCPUTime - beforeUsage.userCPUTime,
    systemCpuMicros: usage.systemCPUTime - beforeUsage.systemCPUTime,
  },
  impact: { digest: hash, affectedVersions: impacts.length },
  restore: {
    valid: verification.valid,
    files: verification.files,
    bytes: verification.bytes,
  },
  repair: {
    exactUtility: repair.utility,
    popularityUtility: repair.baselineUtility,
    budget: 5,
    unit: "synthetic cost units",
  },
  limitations: [
    "One macOS host, warm caches; measurements are not universal speed claims.",
    "Oracle cases are small generated instances and finite randomized seeds.",
    "Incremental timing is reverse-index reclassification after a completed scan, not incremental physical scanning.",
    "Storage metadata bytes include backend manifests/commits; SQLite and filesystem allocation overhead are excluded.",
    "maxRSS is process peak including fixture generation; not isolated operation peak.",
  ],
  success: failures.length === 0,
};
await fs.mkdir("results", { recursive: true });
await fs.writeFile("results/summary.json", JSON.stringify(report, null, 2));
await fs.writeFile(
  "results/report.md",
  `# REWIND measured evaluation\n\nRun: ${started}\nCommand: npm run evaluate\nSeed: ${seed}\nHost: ${report.environment.cpu}, ${process.platform}/${process.arch}, ${process.version}\n\n${agreements}/${comparisons} independent oracle agreements; ${falsePositives} false positives in ${seeds.length} physically mutated scenarios.\n\n${m.entries.filter((e) => e.type === "file").length} files in latest benchmark snapshot. Logical history ${stats.logicalBytes} bytes; unique referenced chunk bytes ${stats.uniqueBytes}; actual duplicated object bytes ${stats.objectBytes}; backend metadata ${stats.metadataBytes} bytes.\n\n| Operation | Measured ms |\n|---|---:|\n${Object.entries(
    timings,
  )
    .map(([k, v]) => `| ${k} | ${v.toFixed(2)} |`)
    .join(
      "\n",
    )}\n\nIndependent restore verifier: ${verification.valid}, ${verification.files} files, ${verification.bytes} bytes. Shared object references: ${impacts.length}. Repair adversary exact utility ${repair.utility}, popularity utility ${repair.baselineUtility}.\n\nConditions: ${report.environment.filesystem}.\n\n${report.limitations.map((s) => "- " + s).join("\n")}\n\nFailures: ${failures.length ? failures.join("; ") : "None in exercised cases."}\n`,
);
console.log(
  JSON.stringify(
    {
      success: report.success,
      oracle: report.oracle,
      files: report.scope.filesPerSnapshot,
      stats,
      timings,
    },
    null,
    2,
  ),
);
await fs.rm(root, { recursive: true, force: true });
if (failures.length) process.exitCode = 1;
