import { registerApprovalHandler } from "../approvals/engine";
import { notify } from "../notifications";
import { userIdForEmployee } from "../directory";
import { CLAIM_SUBJECT, settleClaim } from "./claims";
import { postReimbursement } from "./reimbursement";

registerApprovalHandler(CLAIM_SUBJECT, {
  label: "Expense claim",
  href: (id) => `/expenses/${id}`,
  onApproved: async ({ tx, request, actor }) => {
    const claim = await settleClaim(tx, actor, request.subjectId, "approved");
    if (!claim || claim.status !== "approved" || claim.reimbursementMethod !== "payroll") return;
    // Idempotent (unique source key); if no period is open the daily job posts it later.
    const posted = await postReimbursement(tx, actor.tenantId, claim.id, actor.userId);
    if (posted.status === "awaiting_period") {
      const userId = await userIdForEmployee(tx, claim.employeeId);
      if (userId) {
        await notify(tx, {
          tenantId: actor.tenantId,
          userIds: [userId],
          category: "expenses",
          title: `${claim.number} is approved and awaiting a payroll period`,
          body: "It will be added to the next open payroll period automatically.",
          href: `/expenses/${claim.id}`,
          dedupeKey: `expense:${claim.id}:awaiting`,
        });
      }
    }
  },
  onRejected: async ({ tx, request, actor }) => {
    await settleClaim(tx, actor, request.subjectId, "rejected");
  },
  onCancelled: async ({ tx, request, actor }) => {
    await settleClaim(tx, actor, request.subjectId, "withdrawn");
  },
});
