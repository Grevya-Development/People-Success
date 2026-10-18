import type { OfferComponent } from "../../db/schema/recruitment";

export const DEFAULT_SPLIT_CODES = ["BASIC", "HRA", "SPECIAL"];

/** Basic 50% / HRA 20% of CTC / Special allowance balancing (used when no structure exists). */
export function defaultSplit(annualCtcPaise: number): OfferComponent[] {
  const basic = Math.round(annualCtcPaise * 0.5);
  const hra = Math.round(annualCtcPaise * 0.2);
  return [
    { code: "BASIC", name: "Basic salary", annualAmount: basic },
    { code: "HRA", name: "House rent allowance", annualAmount: hra },
    { code: "SPECIAL", name: "Special allowance", annualAmount: annualCtcPaise - basic - hra },
  ];
}

export const isDefaultSplit = (components: OfferComponent[]) =>
  components.length === 3 && components.every((c, i) => c.code === DEFAULT_SPLIT_CODES[i]);
