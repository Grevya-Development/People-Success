import { registerApprovalHandler } from "../approvals/engine";
import { onOfferApprovalCancelled, onOfferApproved, onOfferRejected } from "./offers";
import { onRequisitionApproved, onRequisitionCancelled, onRequisitionRejected } from "./requisitions";

registerApprovalHandler("job_requisition", {
  label: "Job requisition",
  href: (id) => `/recruitment/requisitions/${id}`,
  onApproved: async ({ tx, request, actor }) => onRequisitionApproved(tx, request.subjectId, actor),
  onRejected: async ({ tx, request, actor, comment }) => onRequisitionRejected(tx, request.subjectId, actor, comment),
  onCancelled: async ({ tx, request, actor }) => onRequisitionCancelled(tx, request.subjectId, actor),
});

registerApprovalHandler("offer", {
  label: "Offer",
  href: (id) => `/recruitment/offers/${id}`,
  onApproved: async ({ tx, request, actor }) => onOfferApproved(tx, request.subjectId, actor),
  onRejected: async ({ tx, request, actor, comment }) => onOfferRejected(tx, request.subjectId, actor, comment),
  onCancelled: async ({ tx, request, actor }) => onOfferApprovalCancelled(tx, request.subjectId, actor),
});
