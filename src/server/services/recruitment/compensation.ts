import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { withSystem } from "../../db/tx";
import { payComponents, salaryStructures } from "../../db/schema";
import type { OfferComponent } from "../../db/schema/recruitment";
import { resolveStructure } from "@/lib/payroll/structure";
import type { ComponentDef } from "@/lib/payroll/types";
import { defaultSplit } from "./compensation-split";

export type Breakdown = {
  components: OfferComponent[];
  basis: "structure" | "default";
  structureName: string | null;
  note: string;
};

export { DEFAULT_SPLIT_CODES, defaultSplit, isDefaultSplit } from "./compensation-split";

/**
 * Component breakdown for an offer. Uses the tenant's default active salary
 * structure (Payroll) when one exists; otherwise the labelled default split.
 *
 * Salary structures and pay components are payroll-restricted under RLS, and
 * recruiters do not hold payroll permissions, so the configuration (percent
 * rules only, no employee data) is read in system context filtered by tenant.
 * Employer PF inside CTC is not estimated for offers; the payroll engine
 * computes statutory amounts after joining.
 */
export async function offerBreakdown(tenantId: string, annualCtcPaise: number): Promise<Breakdown> {
  const fallback = (note: string): Breakdown => ({ components: defaultSplit(annualCtcPaise), basis: "default", structureName: null, note });
  try {
    const { structure, components } = await withSystem(async (tx) => {
      const [s] = await tx
        .select()
        .from(salaryStructures)
        .where(and(eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.isActive, true)))
        .orderBy(desc(salaryStructures.isDefault), desc(salaryStructures.updatedAt))
        .limit(1);
      const comps = s ? await tx.select().from(payComponents).where(and(eq(payComponents.tenantId, tenantId), eq(payComponents.isActive, true))) : [];
      return { structure: s ?? null, components: comps };
    }, tenantId);
    if (!structure) return fallback("Default split: Basic 50% and HRA 20% of CTC, Special allowance balances to CTC. Configure a salary structure in Payroll to use your own components.");
    const defs: ComponentDef[] = components.map((c) => ({
      code: c.code,
      name: c.name,
      kind: c.kind,
      calculation: c.calculation,
      isTaxable: c.isTaxable,
      isPartOfCtc: c.isPartOfCtc,
      pfWage: c.pfWage,
      esiWage: c.esiWage,
      ptWage: c.ptWage,
      prorate: c.prorate,
      payslipLabel: c.payslipLabel,
      sortOrder: c.sortOrder,
    }));
    const resolved = resolveStructure(annualCtcPaise, structure.lines, defs, { pf: null, pfApplicable: false, pfWageBasis: "capped", epsEligible: false, ageYears: null });
    return {
      components: resolved.lines.map((l) => ({ code: l.code, name: l.name, annualAmount: l.annual })),
      basis: "structure",
      structureName: structure.name,
      note: `Breakdown from the “${structure.name}” salary structure. Statutory employer contributions are calculated by payroll after joining.`,
    };
  } catch {
    return fallback("Default split (the configured salary structure could not be applied to this CTC): Basic 50%, HRA 20%, Special allowance balance.");
  }
}
