/**
 * Payroll engine unit tests. Every expected value is worked out by hand in the
 * comment next to it (amounts in rupees unless noted; the code uses paise).
 * These tests use the default (unverified) parameter sets only as fixtures.
 */
import { describe, expect, it } from "vitest";
import { divRound, inr, percentOf, prorate, roundTo, rupees } from "@/lib/payroll/money";
import { amountInWords } from "@/lib/payroll/words";
import { computePayableDays } from "@/lib/payroll/attendance";
import { PayrollValidationError, resolveStructure } from "@/lib/payroll/structure";
import { calculateEsi, calculateGratuity, calculateLwf, calculatePf, calculatePt, calculateStatutoryBonus, esiContributionPeriod } from "@/lib/payroll/statutory";
import { computeAnnualTax, computeMonthlyTds } from "@/lib/payroll/tax";
import { calculateEmployeePay } from "@/lib/payroll/engine";
import { canonicalJson, compareEmployee } from "@/lib/payroll/variance";
import { DEFAULT_COMPONENTS, DEFAULT_RULE_SETS, DEFAULT_STRUCTURE } from "@/lib/payroll/defaults";
import { parseRuleParameters, validateRuleParameters } from "@/lib/payroll/params";
import type { ComponentDef, EngineInput, StructureLine } from "@/lib/payroll/types";
import { EMPTY_YTD } from "@/lib/payroll/types";

const R = rupees;
const rule = (kind: string, jurisdiction = "IN") => DEFAULT_RULE_SETS.find((r) => r.kind === kind && r.jurisdiction === jurisdiction)!.parameters;
const PF = parseRuleParameters("pf", rule("pf"));
const ESI = parseRuleParameters("esi", rule("esi"));
const PT_KA = parseRuleParameters("pt", rule("pt", "IN-KA"));
const PT_MH = parseRuleParameters("pt", rule("pt", "IN-MH"));
const PT_TN = parseRuleParameters("pt", rule("pt", "IN-TN"));
const LWF_KA = parseRuleParameters("lwf", rule("lwf", "IN-KA"));
const TAX = parseRuleParameters("income_tax", rule("income_tax"));
const GRATUITY = parseRuleParameters("gratuity", rule("gratuity"));
const BONUS = parseRuleParameters("bonus", rule("bonus"));
const COMPONENTS: ComponentDef[] = DEFAULT_COMPONENTS.map((c) => ({ ...c }));
const pfOpts = { pf: PF, pfApplicable: true, pfWageBasis: "capped" as const, epsEligible: true, ageYears: 30 };

function baseInput(over: Partial<EngineInput> = {}): EngineInput {
  return {
    employee: { id: "e1", name: "Asha Rao", dateOfBirth: "1990-05-10", gender: "female" },
    period: { year: 2025, month: 10, startDate: "2025-10-01", endDate: "2025-10-31" },
    days: { calendarDays: 31, employedDays: 31, payableDays: 31, lopDays: 0, windowStart: "2025-10-01", windowEnd: "2025-10-31", joinedInPeriod: null, exitedInPeriod: null, source: "attendance" },
    annualCtc: R(1_200_000),
    components: COMPONENTS,
    structure: DEFAULT_STRUCTURE,
    oneOffs: [],
    loans: [],
    statutory: { pf: PF, esi: ESI, pt: PT_KA, lwf: LWF_KA, incomeTax: TAX },
    profile: {
      pfApplicable: true,
      pfWageBasis: "capped",
      epsEligible: true,
      esiContinuing: false,
      ptState: "KA",
      lwfState: "KA",
      taxRegime: "new",
      declarations: {},
      previousEmployerIncome: 0,
      previousEmployerTds: 0,
      hasPan: true,
    },
    ytd: EMPTY_YTD,
    ...over,
  };
}
const line = (r: ReturnType<typeof calculateEmployeePay>, code: string) => r.lines.find((l) => l.componentCode === code)?.amount ?? 0;

describe("rounding helpers", () => {
  it("rounds half-up to paise, rupee, ten rupees and up to the next rupee", () => {
    // 5 / 2 = 2.5 paise -> 3 paise (half-up); -5/2 -> -3 (away from zero)
    expect(divRound(BigInt(5), BigInt(2))).toBe(3);
    expect(divRound(-BigInt(5), BigInt(2))).toBe(-3);
    // ₹123.50 -> ₹124.00 half-up to the rupee; ₹123.49 -> ₹123.00
    expect(roundTo(12350, "half_up_rupee")).toBe(12400);
    expect(roundTo(12349, "half_up_rupee")).toBe(12300);
    // ₹123.01 -> ₹124.00 when rounding up (ESI)
    expect(roundTo(12301, "ceil_rupee")).toBe(12400);
    // ₹1,234.56 -> ₹1,230 to the nearest ten rupees; ₹1,235.00 -> ₹1,240
    expect(roundTo(123456, "nearest_10_rupees")).toBe(123000);
    expect(roundTo(123500, "nearest_10_rupees")).toBe(124000);
    // 12.5% of ₹1.00 = 12.5 paise -> 13 paise
    expect(percentOf(100, 12.5)).toBe(13);
  });

  it("formats rupees with Indian grouping and amounts in words", () => {
    expect(inr(1234567890)).toBe("₹1,23,45,678.90");
    // ₹45,678.50
    expect(amountInWords(4567850)).toBe("Rupees Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise Only");
    // ₹12,34,567
    expect(amountInWords(123456700)).toBe("Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
});

describe("salary structure resolution", () => {
  it("resolves basic, HRA and the balancing special allowance with employer PF inside CTC", () => {
    // CTC 12,00,000: Basic 50% = 6,00,000 (50,000/mo); HRA 40% of basic = 2,40,000 (20,000/mo).
    // Employer PF on capped wage: 12% × 15,000 = 1,800/mo = 21,600/yr inside CTC.
    // Gross = 12,00,000 − 21,600 = 11,78,400 (98,200/mo); Special = 98,200 − 50,000 − 20,000 = 28,200.
    const s = resolveStructure(R(1_200_000), DEFAULT_STRUCTURE.lines, COMPONENTS, pfOpts);
    const m = Object.fromEntries(s.lines.map((l) => [l.code, l.monthly]));
    expect(m).toEqual({ BASIC: R(50_000), HRA: R(20_000), SPECIAL: R(28_200) });
    expect(s.employerPfInCtcMonthly).toBe(R(1_800));
    expect(s.grossMonthly).toBe(R(98_200));
  });

  it("rejects a structure whose fixed parts exceed CTC", () => {
    // CTC 6,00,000; Basic fixed 5,00,000 + HRA fixed 2,00,000 = 7,00,000 > gross.
    const lines: StructureLine[] = [
      { componentCode: "BASIC", calculation: "fixed", value: R(500_000) },
      { componentCode: "HRA", calculation: "fixed", value: R(200_000) },
      { componentCode: "SPECIAL", calculation: "balancing", value: null },
    ];
    expect(() => resolveStructure(R(600_000), lines, COMPONENTS, pfOpts)).toThrow(/exceeds the gross available/);
  });

  it("rejects negative CTC, duplicate balancing lines and unknown components", () => {
    expect(() => resolveStructure(-100, DEFAULT_STRUCTURE.lines, COMPONENTS, pfOpts)).toThrow(PayrollValidationError);
    const twoBalancing: StructureLine[] = [
      { componentCode: "BASIC", calculation: "percent_of_ctc", value: 50 },
      { componentCode: "SPECIAL", calculation: "balancing", value: null },
      { componentCode: "CONV", calculation: "balancing", value: null },
    ];
    expect(() => resolveStructure(R(600_000), twoBalancing, COMPONENTS, pfOpts)).toThrow(/Only one balancing line/);
    expect(() => resolveStructure(R(600_000), [{ componentCode: "NOPE", calculation: "fixed", value: 1 }], COMPONENTS, pfOpts)).toThrow(/does not exist/);
  });
});

describe("attendance contract and proration", () => {
  it("prorates a mid-month joiner from the joining date", () => {
    // Joined 16 Oct: window 16–31 Oct = 16 of 31 days. Basic 50,000 × 16/31 = 25,806.4516 -> 25,806.45.
    const { days } = computePayableDays({ periodStart: "2025-10-01", periodEnd: "2025-10-31", joiningDate: "2025-10-16", lastWorkingDate: null, attendance: [], unpaidLeave: [] });
    expect(days).toMatchObject({ employedDays: 16, payableDays: 16, lopDays: 0, joinedInPeriod: "2025-10-16" });
    const r = calculateEmployeePay(baseInput({ days }));
    expect(line(r, "BASIC")).toBe(2580645);
    // HRA 20,000 × 16/31 = 10,322.5806 -> 10,322.58; Special 28,200 × 16/31 = 14,554.8387 -> 14,554.84
    expect(line(r, "HRA")).toBe(1032258);
    expect(line(r, "SPECIAL")).toBe(1455484);
    expect(r.gross).toBe(2580645 + 1032258 + 1455484);
  });

  it("prorates a mid-month exit to the last working day", () => {
    // LWD 10 Oct: 10 of 31 days. Basic 50,000 × 10/31 = 16,129.0322 -> 16,129.03.
    const { days } = computePayableDays({ periodStart: "2025-10-01", periodEnd: "2025-10-31", joiningDate: "2020-01-01", lastWorkingDate: "2025-10-10", attendance: [], unpaidLeave: [] });
    expect(days).toMatchObject({ employedDays: 10, payableDays: 10, exitedInPeriod: "2025-10-10" });
    expect(line(calculateEmployeePay(baseInput({ days })), "BASIC")).toBe(1612903);
  });

  it("derives LOP from attendance payable fractions", () => {
    // 31 attendance rows: two absent (0) and one half day (0.5): LOP = 2.5, payable = 28.5.
    const attendance = Array.from({ length: 31 }, (_, i) => ({ date: `2025-10-${String(i + 1).padStart(2, "0")}`, payableFraction: i === 4 || i === 5 ? 0 : i === 6 ? 0.5 : 1 }));
    const { days } = computePayableDays({ periodStart: "2025-10-01", periodEnd: "2025-10-31", joiningDate: "2020-01-01", lastWorkingDate: null, attendance, unpaidLeave: [] });
    expect(days).toMatchObject({ lopDays: 2.5, payableDays: 28.5, source: "attendance" });
    // Basic 50,000 × 28.5/31 = 45,967.7419 -> 45,967.74
    const r = calculateEmployeePay(baseInput({ days }));
    expect(line(r, "BASIC")).toBe(4596774);
    expect(r.lines.find((l) => l.componentCode === "LOP")?.explanation).toMatch(/2.5 days/);
  });

  it("falls back to approved unpaid leave when there is no attendance, apportioning leave across the window edge", () => {
    // Leave 5–7 Oct (3 days) fully inside; leave 29 Sep–2 Oct (4 days) overlaps 2 of 4 days -> 2. LOP = 5.
    const { days, messages } = computePayableDays({
      periodStart: "2025-10-01",
      periodEnd: "2025-10-31",
      joiningDate: "2020-01-01",
      lastWorkingDate: null,
      attendance: [],
      unpaidLeave: [
        { startDate: "2025-10-05", endDate: "2025-10-07", days: 3 },
        { startDate: "2025-09-29", endDate: "2025-10-02", days: 4 },
      ],
    });
    expect(days).toMatchObject({ lopDays: 5, payableDays: 26, source: "unpaid_leave" });
    expect(messages.some((m) => m.code === "no_attendance")).toBe(true);
  });
});

describe("provident fund", () => {
  it("caps PF wages at the ceiling and splits employer EPS/EPF", () => {
    // Wage 50,000 capped at 15,000: EE 12% = 1,800; ER 1,800; EPS 8.33% × 15,000 = 1,249.50 -> 1,250; EPF 550.
    const r = calculatePf(PF, { pfWage: R(50_000), wageBasis: "capped", epsEligible: true, ageYears: 30 });
    expect([r.employee, r.employer, r.eps, r.epf]).toEqual([R(1_800), R(1_800), R(1_250), R(550)]);
  });

  it("contributes on actual wages when chosen, employer stays capped", () => {
    // EE 12% × 50,000 = 6,000; employer capped 1,800.
    const r = calculatePf(PF, { pfWage: R(50_000), wageBasis: "actual", epsEligible: true, ageYears: 30 });
    expect([r.employee, r.employer]).toEqual([R(6_000), R(1_800)]);
  });

  it("below the ceiling rounds each share to the rupee", () => {
    // Wage 12,345.67: EE 12% = 1,481.4804 -> 1,481; EPS 8.33% = 1,028.3943 -> 1,028; EPF = 1,481 − 1,028 = 453.
    const r = calculatePf(PF, { pfWage: 1234567, wageBasis: "capped", epsEligible: true, ageYears: 30 });
    expect([r.employee, r.eps, r.epf]).toEqual([R(1_481), R(1_028), R(453)]);
  });

  it("stops EPS at the maximum age", () => {
    // Age 58: EPS 0, EPF takes the full 1,800.
    const r = calculatePf(PF, { pfWage: R(50_000), wageBasis: "capped", epsEligible: true, ageYears: 58 });
    expect([r.eps, r.epf]).toEqual([0, R(1_800)]);
  });
});

describe("ESI", () => {
  it("covers wages exactly at the threshold and rounds up to the next rupee", () => {
    // 21,000: EE 0.75% = 157.50 -> 158; ER 3.25% = 682.50 -> 683.
    const r = calculateEsi(ESI, { rateOfWages: R(21_000), earnedWages: R(21_000), continuing: false });
    expect([r.covered, r.employee, r.employer]).toEqual([true, R(158), R(683)]);
  });

  it("does not cover wages one rupee above the threshold", () => {
    const r = calculateEsi(ESI, { rateOfWages: R(21_001), earnedWages: R(21_001), continuing: false });
    expect([r.covered, r.employee, r.employer]).toEqual([false, 0, 0]);
  });

  it("continues coverage to the end of the contribution period", () => {
    // 25,000 while continuing: EE 0.75% = 187.50 -> 188; ER 3.25% = 812.50 -> 813.
    const r = calculateEsi(ESI, { rateOfWages: R(25_000), earnedWages: R(25_000), continuing: true });
    expect([r.covered, r.employee, r.employer]).toEqual([true, R(188), R(813)]);
    // January 2026 belongs to the Oct 2025 – Mar 2026 contribution period.
    expect(esiContributionPeriod(ESI, 2026, 1).key).toBe("2025-10");
  });
});

describe("professional tax", () => {
  it("applies Karnataka slab boundaries and the February amount", () => {
    expect(calculatePt(PT_KA, { ptWage: 2499999, month: 10, gender: null, state: "KA" }).amount).toBe(0);
    expect(calculatePt(PT_KA, { ptWage: R(25_000), month: 10, gender: null, state: "KA" }).amount).toBe(R(200));
    expect(calculatePt(PT_KA, { ptWage: R(25_000), month: 2, gender: null, state: "KA" }).amount).toBe(R(300));
  });

  it("applies Maharashtra slabs for men and women", () => {
    const pt = (wage: number, month = 10, gender: string | null = "male") => calculatePt(PT_MH, { ptWage: wage, month, gender, state: "MH" }).amount;
    expect(pt(R(7_500))).toBe(0); // up to 7,500: nil
    expect(pt(750001)).toBe(R(175)); // 7,500.01: 175
    expect(pt(R(10_000))).toBe(R(175)); // up to 10,000: 175
    expect(pt(1000001)).toBe(R(200)); // above 10,000: 200
    expect(pt(R(30_000), 2)).toBe(R(300)); // February: 300
    expect(pt(R(25_000), 10, "female")).toBe(0); // women up to 25,000: nil
    expect(pt(2500001, 10, "female")).toBe(R(200));
  });

  it("deducts half-yearly PT only in deduction months on projected wages", () => {
    // Tamil Nadu: September, 6,000 × 6 = 36,000 falls in 30,001–45,000 -> 425. October: nothing.
    expect(calculatePt(PT_TN, { ptWage: R(6_000), month: 9, gender: null, state: "TN" }).amount).toBe(R(425));
    expect(calculatePt(PT_TN, { ptWage: R(6_000), month: 10, gender: null, state: "TN" }).amount).toBe(0);
  });

  it("deducts Karnataka LWF only in December", () => {
    expect(calculateLwf(LWF_KA, { wage: R(50_000), month: 12, state: "KA" })).toMatchObject({ employee: R(50), employer: R(100) });
    expect(calculateLwf(LWF_KA, { wage: R(50_000), month: 11, state: "KA" })).toMatchObject({ employee: 0, employer: 0 });
  });
});

const tax = (regime: "new" | "old", gross: number, extra: Partial<Parameters<typeof computeAnnualTax>[1]> = {}) =>
  computeAnnualTax(TAX, { regime, grossIncome: R(gross), ageYears: 35, professionalTax: 0, employeePf: 0, declarations: {}, ...extra });

describe("income tax", () => {
  it("new regime: full rebate at ₹12 lakh taxable income", () => {
    // 12,75,000 − SD 75,000 = 12,00,000. Slabs: 5% × 4L = 20,000 + 10% × 4L = 40,000 = 60,000; rebate 60,000 -> 0.
    const t = tax("new", 1_275_000);
    expect([t.taxableIncome, t.slabTax, t.rebate, t.total]).toEqual([R(1_200_000), R(60_000), R(60_000), 0]);
  });

  it("new regime: marginal relief just above the rebate limit, plus cess", () => {
    // Taxable 12,10,000: slab tax 60,000 + 15% × 10,000 = 61,500; capped at income above 12L = 10,000.
    // Cess 4% × 10,000 = 400 -> total 10,400.
    const t = tax("new", 1_285_000);
    expect([t.slabTax, t.rebate, t.cess, t.total]).toEqual([R(61_500), R(51_500), R(400), R(10_400)]);
  });

  it("new regime at ₹20 lakh taxable", () => {
    // 20,000 + 40,000 + 60,000 + 80,000 = 2,00,000; cess 8,000 -> 2,08,000.
    expect(tax("new", 2_075_000).total).toBe(R(208_000));
  });

  it("old regime with standard deduction, 80C (including employee PF) and cess rounded to ₹10", () => {
    // 10,50,000 − SD 50,000 − 80C (1,00,000 + PF 21,600 = 1,21,600) = 8,78,400.
    // Tax 5% × 2.5L = 12,500 + 20% × 3,78,400 = 75,680 -> 88,180; cess 3,527.20 -> 91,707.20 -> ₹91,710.
    const t = tax("old", 1_050_000, { employeePf: R(21_600), declarations: { "80C": R(100_000) } });
    expect([t.taxableIncome, t.slabTax, t.total]).toEqual([R(878_400), R(88_180), R(91_710)]);
  });

  it("old regime rebate boundary at ₹5 lakh", () => {
    // Taxable 5,00,000: tax 12,500, rebate 12,500 -> 0.
    expect(tax("old", 550_000).total).toBe(0);
    // Taxable 5,00,010: tax 12,502, no rebate; cess 500.08 -> 13,002.08 -> ₹13,000.
    expect(tax("old", 550_010).total).toBe(R(13_000));
  });

  it("old regime senior citizen slabs", () => {
    // Taxable 6,00,000. Normal: 12,500 + 20,000 = 32,500 + 4% = 33,800. Senior: 10,000 + 20,000 = 30,000 + 4% = 31,200.
    expect(tax("old", 650_000).total).toBe(R(33_800));
    expect(tax("old", 650_000, { ageYears: 65 }).total).toBe(R(31_200));
  });

  it("applies surcharge with marginal relief above ₹50 lakh", () => {
    // Taxable 50,10,000: tax at 50L = 10,80,000; at 50.1L = 10,83,000; surcharge 10% = 1,08,300
    // limited to 10,80,000 + 10,000 − 10,83,000 = 7,000; cess 4% × 10,90,000 = 43,600 -> 11,33,600.
    const t = tax("new", 5_085_000);
    expect([t.slabTax, t.surcharge, t.total]).toEqual([R(1_083_000), R(7_000), R(1_133_600)]);
  });

  it("spreads remaining tax over the remaining months and taxes one-offs in the month", () => {
    // October: 6 months remain. YTD 9,00,000 taxable, 30,000 TDS. Projected = 9L + 1.5L + 5 × 1.5L = 18L.
    // Taxable 17,25,000: 1,20,000 + 20% × 1,25,000 = 1,45,000 + cess 5,800 = 1,50,800.
    // (1,50,800 − 30,000) ÷ 6 = 20,133.33 -> 20,133.
    const input = {
      regime: "new" as const,
      ageYears: 35,
      month: 10,
      lastMonth: false,
      ytd: { taxableEarnings: R(900_000), tds: R(30_000), pfEmployee: 0, professionalTax: 0, hra: 0, basic: 0 },
      current: { regularTaxable: R(150_000), oneOffTaxable: 0, pfEmployee: 0, professionalTax: 0, hra: 0, basic: 0, fullMonthRegularTaxable: R(150_000), fullMonthPfEmployee: 0, fullMonthHra: 0, fullMonthBasic: 0 },
      previousEmployer: { income: 0, tds: 0 },
      declarations: {},
    };
    const t = computeMonthlyTds(TAX, input);
    expect([t.remainingMonths, t.annualRegular.total, t.amount]).toEqual([6, R(150_800), R(20_133)]);
    // With a 1,00,000 bonus: taxable 18,25,000 -> 1,65,000 + 6,600 = 1,71,600; one-off share
    // = (1,71,600 − 30,000) − 1,20,800 = 20,800; TDS = 20,133 + 20,800 = 40,933.
    const b = computeMonthlyTds(TAX, { ...input, current: { ...input.current, oneOffTaxable: R(100_000) } });
    expect(b.amount).toBe(R(40_933));
  });
});

describe("gratuity and bonus", () => {
  it("rounds service above six months up to a full year", () => {
    // 01-01-2015 to 15-08-2025: 10y 7m 15d -> 11 years. 50,000 × 15/26 × 11 = 3,17,307.69 -> 3,17,308.
    const g = calculateGratuity(GRATUITY, { lastDrawnMonthlyWage: R(50_000), joiningDate: "2015-01-01", exitDate: "2025-08-15" });
    expect([g.eligible, g.countedYears, g.amount]).toEqual([true, 11, R(317_308)]);
  });

  it("requires five completed years and applies the cap", () => {
    // 4y 11m: not eligible.
    expect(calculateGratuity(GRATUITY, { lastDrawnMonthlyWage: R(50_000), joiningDate: "2020-09-01", exitDate: "2025-07-31" }).eligible).toBe(false);
    // 5,00,000 × 15/26 × 30 = 86,53,846 > 20,00,000 cap.
    expect(calculateGratuity(GRATUITY, { lastDrawnMonthlyWage: R(500_000), joiningDate: "1995-04-01", exitDate: "2025-03-31" }).amount).toBe(R(2_000_000));
  });

  it("computes statutory bonus on capped wages", () => {
    // 12 × 10,000 capped at 7,000 = 84,000 × 8.33% = 6,997.20 -> 6,997.
    const b = calculateStatutoryBonus(BONUS, { monthlyWages: Array(12).fill(R(10_000)), percent: 8.33, daysWorked: 240 });
    expect([b.eligible, b.amount]).toEqual([true, R(6_997)]);
    expect(calculateStatutoryBonus(BONUS, { monthlyWages: [R(22_000)], percent: 8.33, daysWorked: 240 }).eligible).toBe(false);
    expect(() => calculateStatutoryBonus(BONUS, { monthlyWages: [R(1)], percent: 25, daysWorked: 240 })).toThrow(/between/);
  });
});

describe("calculateEmployeePay", () => {
  it("computes a full month end to end with explanations", () => {
    // Basic 50,000 + HRA 20,000 + Special 28,200 = gross 98,200. PF EE 1,800; ESI n/a (98,200 > 21,000);
    // PT KA 200. TDS: projected 6 × 98,200 = 5,89,200 − 75,000 = 5,14,200 -> tax 5,710, rebated to 0.
    // Net = 98,200 − 2,000 = 96,200. Employer PF 1,800.
    const r = calculateEmployeePay(baseInput());
    expect([r.gross, r.deductions, r.net, r.employerContributions]).toEqual([R(98_200), R(2_000), R(96_200), R(1_800)]);
    expect(line(r, "TDS")).toBe(0);
    expect(r.lines.find((l) => l.componentCode === "BASIC")?.explanation).toBe("Basic salary = 50% of CTC ₹12,00,000.00 ÷ 12 = ₹50,000.00 (full month)");
    expect(r.lines.every((l) => l.explanation.length > 0)).toBe(true);
    expect(r.messages.some((m) => m.code === "esi_not_covered")).toBe(true);
  });

  it("is deterministic", () => {
    expect(canonicalJson(calculateEmployeePay(baseInput()))).toBe(canonicalJson(calculateEmployeePay(baseInput())));
  });

  it("adds one-off inputs, loans and flags negative net pay", () => {
    // Bonus 10,000 (taxable) and loan installment 5,000 (outstanding 3,000 -> only 3,000 recovered).
    const r = calculateEmployeePay(baseInput({ oneOffs: [{ kind: "bonus", componentCode: "BONUS", amount: R(10_000), isTaxable: true }], loans: [{ loanId: "l1", kind: "advance", installment: R(5_000), outstanding: R(3_000) }] }));
    expect(line(r, "BONUS")).toBe(R(10_000));
    expect(line(r, "LOAN")).toBe(R(3_000));
    const neg = calculateEmployeePay(baseInput({ oneOffs: [{ kind: "recovery", componentCode: "OTHER_DED", amount: R(200_000), isTaxable: false }] }));
    expect(neg.messages.some((m) => m.severity === "error" && m.code === "negative_net")).toBe(true);
  });

  it("rejects invalid inputs explicitly instead of returning zero", () => {
    expect(() => calculateEmployeePay(baseInput({ statutory: { pf: PF, esi: null, pt: PT_KA, lwf: null, incomeTax: TAX } }))).toThrow(/No ESI rule set/);
    expect(() => calculateEmployeePay(baseInput({ oneOffs: [{ kind: "bonus", componentCode: "BONUS", amount: -5, isTaxable: true }] }))).toThrow(/positive amount/);
    expect(() => calculateEmployeePay(baseInput({ oneOffs: [{ kind: "deduction", componentCode: "BONUS", amount: 500, isTaxable: false }] }))).toThrow(/cannot be posted/);
    expect(() => calculateEmployeePay(baseInput({ annualCtc: 0 }))).toThrow(/CTC must be positive/);
    expect(() => calculateEmployeePay(baseInput({ structure: null }))).toThrow(/No salary structure/);
  });

  it("warns when the income tax rule set is for another financial year", () => {
    const r = calculateEmployeePay(baseInput({ period: { year: 2026, month: 10, startDate: "2026-10-01", endDate: "2026-10-31" } }));
    expect(r.messages.some((m) => m.code === "tax_rules_other_fy")).toBe(true);
  });
});

describe("rule parameters, variance and hashing", () => {
  it("validates every default rule set and rejects bad parameters", () => {
    for (const r of DEFAULT_RULE_SETS) expect(validateRuleParameters(r.kind, r.parameters)).toEqual({ ok: true });
    const bad = validateRuleParameters("pt", { periodicity: "monthly", slabs: [{ upTo: 100, amount: 0 }] });
    expect(bad.ok).toBe(false);
    expect(validateRuleParameters("pf", { ...rule("pf"), employeeRate: -1 }).ok).toBe(false);
  });

  it("flags variance beyond the threshold with component drivers", () => {
    const prev = { employeeId: "e1", gross: R(100_000), net: R(90_000), lines: [{ componentCode: "BASIC", componentName: "Basic", kind: "earning", amount: R(100_000) }] };
    const cur = { employeeId: "e1", gross: R(120_000), net: R(108_000), lines: [{ componentCode: "BASIC", componentName: "Basic", kind: "earning", amount: R(120_000) }] };
    const v = compareEmployee(cur, prev, "run0", 10);
    // Net +20% > 10% -> flagged; driver BASIC +20,000.
    expect([v.flagged, v.netPct, v.drivers[0].delta]).toEqual([true, 20, R(20_000)]);
    expect(compareEmployee(cur, cur, "run0", 10).flagged).toBe(false);
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 1 }] })).toBe('{"a":[{"c":1,"d":2}],"b":1}');
    expect(prorate(R(31_000), 15.5, 31)).toBe(R(15_500));
  });
});
