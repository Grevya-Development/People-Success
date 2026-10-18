import { registerApprovalHandler } from "../approvals/engine";
import { applyChangeRequest, closeChangeRequest } from "./change-requests";

registerApprovalHandler("data_change_request", {
  label: "Profile correction",
  href: () => "/inbox?tab=approvals",
  onApproved: async ({ tx, request, actor, comment }) => applyChangeRequest(tx, request.subjectId, actor, comment),
  onRejected: async ({ tx, request, actor, comment }) => closeChangeRequest(tx, request.subjectId, "rejected", actor, comment),
  onCancelled: async ({ tx, request, actor }) => closeChangeRequest(tx, request.subjectId, "cancelled", actor, null),
});
