/**
 * E2E fixture: an organization with a manager and an employee (both with
 * logins) and 5 days of casual leave, created through the real services.
 * Run with tsx (tsconfig.worker.json stubs `server-only`); prints JSON.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { employees, leaveTypes, legalEntities } from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { addStandardLeaveTypes } from "@/server/services/time/leave-types";
import { adjustLeaveBalance } from "@/server/services/time/leave-ledger";
import { todayIn } from "@/lib/format";
import { TEST_PASSWORD, addMember, contextFor, createOwnedTenant } from "../../helpers/fixtures";

const person = (legalEntityId: string, firstName: string, lastName: string) =>
  createEmployeeSchema.parse({
    firstName, lastName, workEmail: "", personalEmail: "", phone: "", dateOfBirth: "", employeeCode: "",
    legalEntityId, employmentType: "full_time", workerType: "employee", workMode: "onsite",
    joiningDate: "2024-01-01", probationMonths: 0, noticePeriodDays: 30, annualCtc: "",
  });

async function main() {
  const org = await createOwnedTenant(`Leave E2E ${Date.now().toString(36)}`);
  const owner = await contextFor(org.tenant.id, org.user.id);
  const [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
  const manager = await createEmployee(owner, person(le, "Meera", "Manager"));
  const worker = await createEmployee(owner, person(le, "Arjun", "Worker"));
  await db.update(employees).set({ managerId: manager.id }).where(eq(employees.id, worker.id));
  const m = await addMember(org.tenant.id, ["people_manager"], { employeeId: manager.id });
  const w = await addMember(org.tenant.id, ["employee"], { employeeId: worker.id });
  await addStandardLeaveTypes(owner);
  const [cl] = await db.select().from(leaveTypes).where(eq(leaveTypes.tenantId, org.tenant.id)).then((r) => r.filter((t) => t.code === "CL"));
  await adjustLeaveBalance(owner, { employeeId: worker.id, leaveTypeId: cl.id, kind: "grant", days: 5, effectiveOn: todayIn(), expiresOn: null, reason: "Opening balance" });
  process.stdout.write(JSON.stringify({ password: TEST_PASSWORD, managerEmail: m.user.email, employeeEmail: w.user.email, leaveType: cl.name }));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
