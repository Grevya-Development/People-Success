import { withSystem } from "../../db/tx";
import { onDomainEvent } from "../../jobs/registry";
import { userIdsWithPermission } from "../directory";
import { notify } from "../notifications";

/**
 * When an employee exits, remind payroll to run the full and final
 * settlement. Idempotent through the notification dedupe key.
 */
onDomainEvent("employee.exited", async (tenantId, event) => {
  const employeeId = typeof event.employeeId === "string" ? event.employeeId : null;
  if (!employeeId) return;
  await withSystem(async (tx) => {
    const userIds = await userIdsWithPermission(tx, tenantId, "payroll.run");
    await notify(tx, {
      tenantId,
      userIds,
      category: "payroll",
      title: "Full and final settlement due",
      body: "An employee has exited. Start their full and final settlement from the payroll period that contains the last working day.",
      href: "/payroll",
      dedupeKey: `payroll:fnf-due:${employeeId}`,
    });
  }, tenantId);
});
