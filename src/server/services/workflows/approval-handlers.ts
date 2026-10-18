import { registerApprovalHandler } from "../approvals/engine";
import { resolveApprovalStep } from "./engine";

registerApprovalHandler("workflow_approval", {
  label: "Workflow approval",
  href: (runId) => `/workflows/runs/${runId}`,
  onApproved: ({ tx, request, comment }) => resolveApprovalStep(tx, request.subjectId, true, comment),
  onRejected: ({ tx, request, comment }) => resolveApprovalStep(tx, request.subjectId, false, comment),
  onCancelled: ({ tx, request }) => resolveApprovalStep(tx, request.subjectId, false, "Cancelled"),
});
