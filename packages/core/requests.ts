import { z } from "zod";
import { digest, relativePath } from "./schema.js";
const scope = z.enum(["original", "lab"]);
const backend = z.number().int().min(0).max(1);
const text = z.string().min(1).max(4096);
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan-recovery"), scope }).strict(),
  z
    .object({
      action: z.literal("state"),
      scope: scope.optional(),
      offset: z.number().int().min(0).max(1000000).optional(),
      search: z.string().max(1024).optional(),
      snapshotId: digest.optional(),
      filter: z
        .enum([
          "VERIFIED_RECOVERABLE",
          "PRESENT_BUT_UNVERIFIED",
          "UNKNOWN",
          "KNOWN_UNRECOVERABLE",
          "INVALID_METADATA",
        ])
        .optional(),
    })
    .strict(),
  z.object({ action: z.literal("demo") }).strict(),
  z
    .object({
      action: z.literal("setup"),
      source: text,
      roots: z.tuple([text, text]),
    })
    .strict(),
  z
    .object({
      action: z.literal("capture"),
      label: z.string().max(120).optional(),
    })
    .strict(),
  z.object({ action: z.literal("demo-edit") }).strict(),
  z.object({ action: z.literal("scan"), scope, deep: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("create-lab"),
      seed: z.number().int().min(1).max(4294967295),
    })
    .strict(),
  z
    .object({
      action: z.literal("fault"),
      kind: z.enum([
        "missing",
        "corrupt",
        "unavailable",
        "io-error",
        "manifest",
      ]),
      backend,
      hash: digest.optional(),
    })
    .strict(),
  z.object({ action: z.literal("replay-lab") }).strict(),
  z
    .object({
      action: z.literal("explain"),
      scope,
      snapshotId: digest,
      path: relativePath,
    })
    .strict(),
  z
    .object({ action: z.literal("diff"), scope, before: digest, after: digest })
    .strict(),
  z
    .object({
      action: z.literal("restore"),
      scope,
      snapshotId: digest,
      parent: text,
      name: relativePath.refine(
        (s) => !s.includes("/"),
        "Single new directory name required",
      ),
      paths: z.array(relativePath).min(1).max(100000).optional(),
    })
    .strict(),
  z.object({ action: z.literal("verify"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("rebuild"), scope }).strict(),
  z
    .object({
      action: z.literal("repair-plan"),
      scope,
      target: backend,
      budget: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z.object({ action: z.literal("scenario") }).strict(),
]);
