import { z } from "zod";
import {
  branchToSlug,
  parseGitRefToBranch,
  type PreviewEntry,
} from "@flotilla/shared";

const GitLabProjectSchema = z.object({
  path_with_namespace: z.string(),
});

const PushEventSchema = z.object({
  object_kind: z.literal("push"),
  ref: z.string(),
  checkout_sha: z.string().optional(),
  commits: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
  project: GitLabProjectSchema,
});

const MergeRequestEventSchema = z.object({
  object_kind: z.literal("merge_request"),
  object_attributes: z.object({
    state: z.string(),
    source_branch: z.string(),
    action: z.string().optional(),
  }),
  project: GitLabProjectSchema,
});

export type PushDispatch = {
  kind: "push";
  projectPath: string;
  branch: string;
  commitSha?: string;
  commitTitle?: string;
};

export type MergeDispatch = {
  kind: "merge";
  projectPath: string;
  sourceBranch: string;
};

export type WebhookDispatch = PushDispatch | MergeDispatch | { kind: "ignore" };

export function parseGitLabWebhook(body: unknown): WebhookDispatch {
  const push = PushEventSchema.safeParse(body);
  if (push.success) {
    const branch = parseGitRefToBranch(push.data.ref);
    if (!branch) return { kind: "ignore" };
    const last = push.data.commits?.[push.data.commits.length - 1];
    return {
      kind: "push",
      projectPath: push.data.project.path_with_namespace,
      branch,
      commitSha: push.data.checkout_sha ?? last?.id,
      commitTitle: last?.title ?? last?.message?.split("\n")[0],
    };
  }

  const mr = MergeRequestEventSchema.safeParse(body);
  if (mr.success) {
    if (mr.data.object_attributes.state !== "merged") {
      return { kind: "ignore" };
    }
    return {
      kind: "merge",
      projectPath: mr.data.project.path_with_namespace,
      sourceBranch: mr.data.object_attributes.source_branch,
    };
  }

  return { kind: "ignore" };
}

export function previewEntryFromPush(d: PushDispatch): PreviewEntry | null {
  const slug = branchToSlug(d.branch);
  if (!slug) return null;
  const now = new Date().toISOString();
  return {
    slug,
    projectPath: d.projectPath,
    branch: d.branch,
    commitSha: d.commitSha,
    commitTitle: d.commitTitle,
    targetUrl: "https://placeholder.invalid",
    status: "pending",
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function slugFromMerge(d: MergeDispatch): string | null {
  return branchToSlug(d.sourceBranch);
}
