import { registerApprovalHandler } from "../approvals/engine";
import { onRunApproved, onRunReturned, RUN_SUBJECT } from "./runs";

/**
 * Payroll runs (regular, adjustment, full and final) are approved through the
 * "payroll_run" policy (seeded: HR review, then finance). Approval moves the
 * run to "approved" after re-verifying its snapshot hash; rejection or
 * withdrawal returns it to "calculated" for correction and recalculation.
 */
registerApprovalHandler(RUN_SUBJECT, {
  label: "Payroll run",
  href: (runId) => `/payroll/runs/${runId}`,
  onApproved: async ({ tx, request, actor }) => onRunApproved(tx, actor, request.subjectId),
  onRejected: async ({ tx, request, actor }) => onRunReturned(tx, actor, request.subjectId, "rejected"),
  onCancelled: async ({ tx, request, actor }) => onRunReturned(tx, actor, request.subjectId, "cancelled"),
});
