import { registerApprovalHandler } from "../approvals/engine";
import { acceptExit, markExitWithdrawn, rejectExit } from "./exits";
import { registerLifecycleTaskHook } from "./task-hooks";

/** Resignations: manager review then HR acceptance (seeded policy "resignation"). */
registerApprovalHandler("resignation", {
  label: "Resignation",
  href: (id) => `/onboarding/exits/${id}`,
  onApproved: ({ tx, request, actor }) => acceptExit(tx, actor, request.subjectId),
  onRejected: ({ tx, request, actor }) => rejectExit(tx, actor, request.subjectId),
  onCancelled: ({ tx, request, actor }) => markExitWithdrawn(tx, actor, request.subjectId),
});

/** HR-initiated exits (termination, retirement, ...): never bypass approval. */
registerApprovalHandler("exit_case", {
  label: "Exit",
  href: (id) => `/onboarding/exits/${id}`,
  onApproved: ({ tx, request, actor }) => acceptExit(tx, actor, request.subjectId),
  onRejected: ({ tx, request, actor }) => rejectExit(tx, actor, request.subjectId),
  onCancelled: ({ tx, request, actor }) => markExitWithdrawn(tx, actor, request.subjectId),
});

// Progress and evidence checks for lifecycle tasks completed from the inbox.
registerLifecycleTaskHook();
