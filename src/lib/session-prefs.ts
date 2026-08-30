export const APPROVALS = ["always-approve", "auto", "plan", "default"] as const;
export type ApprovalMode = (typeof APPROVALS)[number];

export const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  "always-approve": "always-approve",
  auto: "auto",
  plan: "plan",
  default: "ask",
};

export function isApproval(v: string): v is ApprovalMode {
  return (APPROVALS as readonly string[]).includes(v);
}

export const MODELS = ["grok-4.6"] as const;
export type ModelId = (typeof MODELS)[number];

export const VARIANTS = ["low", "medium", "high"] as const;
export type EffortId = (typeof VARIANTS)[number];

export function isModel(v: string): v is ModelId {
  return (MODELS as readonly string[]).includes(v);
}

export function isVariant(v: string): v is EffortId {
  return (VARIANTS as readonly string[]).includes(v);
}

/** session/new `_meta`. Process-level `--always-approve` is separate and stays. */
export function sessionNewMeta(approval: string): Record<string, unknown> {
  if (approval === "always-approve") return { yoloMode: true };
  if (approval === "auto") return { autoMode: true };
  return {};
}
