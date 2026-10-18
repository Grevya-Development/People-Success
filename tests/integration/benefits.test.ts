import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { db } from "@/server/db/client";
import { benefitEnrollments, dependents, employees, legalEntities, payrollInputs, payrollPeriods } from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import {
  createBenefitPlan,
  enrollInBenefit,
  getBenefitPlan,
  listBenefitPlans,
  myBenefits,
  updateBenefitPlan,
  waiveBenefit,
} from "@/server/services/benefits/plans";
import { benefitComponentCode, postBenefitDeductions } from "@/server/services/benefits/deductions";
import { benefitPlanSchema, enrollSchema } from "@/lib/validation/expenses";
import { todayIn } from "@/lib/format";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

const day = (offset: number) => format(addDays(new Date(`${todayIn()}T00:00:00`), offset), "yyyy-MM-dd");

const plan = (over: Record<string, unknown> = {}) =>
  benefitPlanSchema.parse({
    name: "Group health insurance",
    kind: "health_insurance",
    provider: "Acme General",
    description: "Floater cover of ₹5 lakh",
    eligibleEmploymentTypes: ["full_time"],
    employerContribution: "1200",
    employeeContribution: "500",
    deductFromSalary: true,
    coverageOptions: ["self", "self_spouse"],
    enrollmentOpensOn: day(-1),
    enrollmentClosesOn: day(10),
    ...over,
  });

describe("benefits", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let hr: RequestContext;
  let emp: RequestContext;
  let other: RequestContext;
  let empId: string;
  let le: string;
  let spouseId: string;
  let strangerDependent: string;

  beforeAll(async () => {
    org = await createOwnedTenant();
    [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    const [e] = await db
      .insert(employees)
      .values({ tenantId: org.tenant.id, legalEntityId: le, employeeCode: "E1", firstName: "Asha", displayName: "Asha Rao", joiningDate: "2025-01-01", status: "active", employmentType: "full_time" })
      .returning();
    const [o] = await db
      .insert(employees)
      .values({ tenantId: org.tenant.id, legalEntityId: le, employeeCode: "E2", firstName: "Ira", displayName: "Ira Intern", joiningDate: "2025-01-01", status: "active", employmentType: "intern" })
      .returning();
    empId = e.id;
    [{ id: spouseId }] = await db.insert(dependents).values({ tenantId: org.tenant.id, employeeId: e.id, name: "Kiran Rao", relationship: "spouse" }).returning();
    [{ id: strangerDependent }] = await db.insert(dependents).values({ tenantId: org.tenant.id, employeeId: o.id, name: "Someone Else", relationship: "parent" }).returning();
    const h = await addMember(org.tenant.id, ["hr_admin"]);
    const u = await addMember(org.tenant.id, ["employee"], { employeeId: e.id });
    const ou = await addMember(org.tenant.id, ["employee"], { employeeId: o.id });
    hr = await contextFor(org.tenant.id, h.user.id);
    emp = await contextFor(org.tenant.id, u.user.id);
    other = await contextFor(org.tenant.id, ou.user.id);
  });

  it("enrols within the window, effective-dates changes and posts salary deductions once per period", async () => {
    await expect(createBenefitPlan(emp, plan())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const health = await createBenefitPlan(hr, plan());
    const closed = await createBenefitPlan(hr, plan({ name: "Last year's wellness", kind: "wellness", deductFromSalary: false, employeeContribution: "0", enrollmentOpensOn: day(-30), enrollmentClosesOn: day(-1) }));
    const internOnly = await createBenefitPlan(hr, plan({ name: "Intern meal card", kind: "meal", eligibleEmploymentTypes: ["intern"], deductFromSalary: false, employeeContribution: "0" }));

    const mine = await myBenefits(emp);
    expect(mine.plans.map((p) => p.name).sort()).toEqual(["Group health insurance", "Last year's wellness"]);
    expect(mine.plans.find((p) => p.id === closed.id)?.window).toBe("closed");
    expect(mine.dependents.map((d) => d.id)).toEqual([spouseId]);

    await expect(enrollInBenefit(emp, enrollSchema.parse({ planId: closed.id, coverage: "self" }))).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(enrollInBenefit(emp, enrollSchema.parse({ planId: internOnly.id, coverage: "self" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(enrollInBenefit(emp, enrollSchema.parse({ planId: health.id, coverage: "family" }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(enrollInBenefit(emp, enrollSchema.parse({ planId: health.id, coverage: "self", dependentIds: [spouseId] }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      enrollInBenefit(emp, enrollSchema.parse({ planId: health.id, coverage: "self_spouse", dependentIds: [strangerDependent] })),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const first = await enrollInBenefit(emp, enrollSchema.parse({ planId: health.id, coverage: "self" }));
    expect(first.changed).toBe(true);
    expect((await enrollInBenefit(emp, enrollSchema.parse({ planId: health.id, coverage: "self" }))).changed).toBe(false);

    // Same-day change corrects today's record rather than creating an empty range.
    const sameDay = await enrollInBenefit(emp, enrollSchema.parse({ planId: health.id, coverage: "self_spouse", dependentIds: [spouseId] }));
    expect(sameDay.id).toBe(first.id);

    // A later change ends the previous record and starts a new one.
    await db.update(benefitEnrollments).set({ effectiveFrom: day(-40) }).where(eq(benefitEnrollments.id, first.id));
    const changed = await enrollInBenefit(emp, enrollSchema.parse({ planId: health.id, coverage: "self" }));
    expect(changed.id).not.toBe(first.id);
    const history = await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.employeeId, empId));
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.id === first.id)).toMatchObject({ effectiveFrom: day(-40), effectiveTo: todayIn(), coverage: "self_spouse" });
    expect(history.find((h) => h.id === changed.id)).toMatchObject({ effectiveFrom: todayIn(), effectiveTo: null, status: "enrolled" });

    const summary = (await listBenefitPlans(hr)).find((p) => p.id === health.id)!;
    expect(summary).toMatchObject({ enrolled: 1, waived: 0, monthlyEmployerCost: 120_000, monthlyEmployeeDeductions: 50_000 });
    expect((await getBenefitPlan(hr, health.id)).enrollments).toHaveLength(1);
    await expect(listBenefitPlans(emp)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Payroll deduction for the open period (enrollment in force at period end), idempotent.
    const today = todayIn();
    const [period] = await db
      .insert(payrollPeriods)
      .values({
        tenantId: org.tenant.id,
        legalEntityId: le,
        year: Number(today.slice(0, 4)),
        month: Number(today.slice(5, 7)),
        startDate: `${today.slice(0, 7)}-01`,
        endDate: day(20),
        payDate: day(20),
        inputCutoffDate: day(15),
        status: "open",
      })
      .returning();
    const r1 = await postBenefitDeductions(org.tenant.id);
    const r2 = await postBenefitDeductions(org.tenant.id);
    expect(r1.posted).toBe(1);
    expect(r2.posted).toBe(0);
    const inputs = await db.select().from(payrollInputs).where(and(eq(payrollInputs.periodId, period.id), eq(payrollInputs.sourceType, "benefit_enrollment")));
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      employeeId: empId,
      kind: "deduction",
      componentCode: benefitComponentCode("Group health insurance"),
      amount: 50_000,
      sourceId: `${changed.id}:${today.slice(0, 7)}`,
    });
    expect(inputs[0].componentCode).toBe("BENEFIT_GROUP_HEALTH_INSURANCE");

    // Waiving ends the enrollment; nothing new is deducted for it.
    await db.update(benefitEnrollments).set({ effectiveFrom: day(-2) }).where(eq(benefitEnrollments.id, changed.id));
    await waiveBenefit(emp, health.id);
    const open = await db
      .select()
      .from(benefitEnrollments)
      .where(and(eq(benefitEnrollments.employeeId, empId), eq(benefitEnrollments.planId, health.id), isNull(benefitEnrollments.effectiveTo)));
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("waived");
    expect((await postBenefitDeductions(org.tenant.id)).posted).toBe(0);

    // Plan edits are audited and keep eligibility.
    await updateBenefitPlan(hr, { id: health.id, ...plan({ employeeContribution: "650" }) });
    expect((await listBenefitPlans(hr)).find((p) => p.id === health.id)?.employeeContribution).toBe(65_000);
    expect((await myBenefits(other)).plans.map((p) => p.name)).toEqual(["Intern meal card"]);
  });
});
