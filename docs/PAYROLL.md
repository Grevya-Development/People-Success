# Payroll (India)

Payroll is a high-integrity subsystem. The design goals, in order: correctness, determinism, auditability, idempotency, then features.

> **The statutory values shipped with PeopleSuccess are defaults for convenience only.** Every default rule set is stored **unverified**, with the statute or notification it is based on, and must be checked by a qualified payroll professional before production use. They are not guaranteed to be current. See the [verification checklist](#verification-checklist-before-go-live).

## Code map

| Layer | Path | Notes |
| --- | --- | --- |
| Pure engine | `src/lib/payroll/` | No DB, clock or I/O. `engine.ts` (`calculateEmployeePay`), `structure.ts`, `attendance.ts`, `statutory.ts` (PF, ESI, PT, LWF, gratuity, bonus, per-day amounts), `tax.ts` (TDS), `money.ts` (rounding), `params.ts` (Zod schemas per rule kind), `defaults.ts` (seed data), `variance.ts`, `words.ts` |
| Services | `src/server/services/payroll/` | `rules`, `config` (components, structures, assignment), `periods`, `inputs`, `readiness`, `loader`, `calculate`, `runs` (create / submit / approve / lock), `disbursement`, `payslips`, `reports`, `explain` (AI), `declarations`, `loans`, `files`, `approval-handlers`, `jobs` |
| UI | `src/app/(app)/payroll/` | Overview, period, run detail, configuration tabs, My payslips |
| Downloads | `src/app/api/payroll/` | Register CSV, bank file (signed URL), input template |
| Tests | `tests/unit/payroll-engine.test.ts`, `tests/integration/payroll.test.ts` | |

Engine version: `ps-payroll-engine@1.0.0` (recorded in every run's `calculationBasis` and employee snapshot).

## Engine design

`calculateEmployeePay(input)` takes everything it needs as data: annual CTC, the structure lines, pay components, the period, a days summary (from the attendance contract), one-off inputs, loan installments, resolved statutory parameters, the employee's statutory profile and YTD figures. It returns line items (each with a human-readable `explanation`), gross, deductions, employer contributions, net, payable/LOP days, messages and a statutory breakdown. Same input, same output.

Order of calculation:

1. **Validate** input. Negative/zero CTC, payable days outside the employment window, missing PF/ESI/income-tax parameters, one-off amounts ≤ 0, or a deduction posted to an earning component throw `PayrollValidationError` with explicit messages. The service records these as an `error` result for the employee; the run cannot be submitted until they are fixed. The engine never silently produces zero.
2. **Structure** (`resolveStructure`): fixed and %-of-CTC lines, then %-of-basic, then employer PF that is part of CTC (estimated at full attendance on full-month PF wages), then %-of-gross (gross = CTC − employer costs inside CTC), then the single balancing line, which receives monthly gross minus the other monthly earnings so a full month adds up exactly. Over-allocation is rejected with the amount it exceeds by. Employer ESI is always a cost over and above CTC (avoids a circular dependency between coverage and gross).
3. **Proration**: prorating components × payable days ÷ calendar days. Non-prorating components are paid in full if the employee was employed at all in the period.
4. **One-off earnings** (bonus, arrears, overtime, reimbursements, referral rewards, leave encashment…).
5. **PF**, **ESI**, **PT**, **LWF** on the wages flagged on each component (`pfWage`, `esiWage`, `ptWage`; LWF uses gross).
6. **TDS** (section 192 projection, below).
7. **Loans** (installment capped at outstanding) and one-off **deductions/recoveries**.
8. **Totals**: net = gross − deductions. A negative net is an `error` message (never auto-reduced).

### Rounding rules

All money is integer paise. Every calculation is an exact BigInt rational rounded **once** with an explicit mode (`money.ts`). "Half-up" rounds ties away from zero.

| Item | Rule |
| --- | --- |
| Monthly amount of a structure line | annual ÷ 12, half-up to the paise |
| Proration | monthly × payable ÷ calendar days, half-up to the paise (days are carried to 0.01) |
| One-off inputs, per-day amounts (leave encashment, notice pay) | half-up to the paise |
| PF (employee, employer, EPS) | rule-set `rounding`, default half-up to the rupee; EPF (employer) = employer share − EPS |
| ESI | rule-set `rounding`, default **up** to the next rupee |
| PT, LWF | whole-rupee slab amounts from the rule set |
| Taxable income and annual tax | rule-set `annualRounding`, default nearest ₹10 (ss. 288A / 288B) |
| Monthly TDS | rule-set `monthlyRounding`, default half-up to the rupee |
| Gratuity | rule-set `rounding`, default half-up to the rupee |
| Net pay | not rounded further (sum of rounded lines) |

### TDS (income tax on salary)

Projected annual income = YTD taxable earnings (posted runs of the same legal entity in the FY) + this month's taxable regular pay + remaining months × this month's full-month taxable regular pay + previous-employer salary. Old regime subtracts standard deduction, HRA exemption (s.10(13A) with projected HRA and basic, rent from the declaration), professional tax, and declared deductions capped by `deductionLimits` (employee PF counts toward 80C). New regime subtracts only the standard deduction. Tax = slabs (senior/super-senior slabs by age at FY end, old regime), rebate u/s 87A (with marginal relief where the rule set says so), surcharge with marginal relief at each threshold, then cess. Remaining tax (annual − TDS already deducted − previous-employer TDS) is spread evenly over the remaining months including this one; tax attributable to this month's one-off taxable pay is deducted in full this month. In the exit month nothing is projected forward.

Documented simplifications: special-rate income and surcharge caps on it are not modelled; 80D senior limits and employer NPS (80CCD(2)) are not modelled; missing PAN raises a warning (s.206AA) but the higher rate is **not** applied automatically; if the income tax rule set's `fyStartYear` differs from the period's FY, every employee gets a warning (the FY 2025-26 default keeps applying until a newer version is added).

### Other simplifications (documented, not hidden)

- A compensation change inside a period: the rate effective at the end of the employment window applies to the whole period, with a warning to post the difference as an arrear.
- ESI coverage uses the structure's full-month rate of ESI wages; overtime/one-offs are contribution wages but do not affect coverage. Continuation: if the employee had an ESI deduction in an earlier posted run of the same contribution period, coverage continues.
- PF wage ceiling is applied to wages earned in the month (not prorated). Reduced rates, EDLI and admin charges are not computed.
- Half-yearly/annual PT (e.g. Tamil Nadu) is deducted in the configured months on this month's PT wages × 6 (or × 12).
- Per-employee statutory flags (PF opt-out, PF on actual wages, EPS eligibility, ESI override) need schema changes; until then: PF applies, PF on the capped wage, EPS-eligible, ESI by threshold, PT/LWF by work location state else legal entity state. See [Schema changes needed](#schema-changes-needed).

## Attendance contract

```
payable days = calendar days in the employment window − Σ (1 − payableFraction) over attendance_days in the window
employment window = [max(period start, joining date), min(period end, last working day or exit date)]
```

- If an employee has **no** `attendance_days` rows in the window, approved leave requests of a leave type with `isPaid = false` are used as LOP instead (leave crossing the window edge is apportioned by calendar days to the nearest half day), and the result carries a `no_attendance` warning.
- If attendance covers only part of the window, the missing days are payable and a warning is raised.
- Locking a run sets `attendance_days.locked_by_run_id` for every employee and day in the period (only rows that were not already locked). The attendance module should refuse changes to locked days.

## Inputs contract (other modules)

One-off amounts live in `payroll_inputs`, unique per tenant on `(sourceType, sourceId)`.

```ts
import { postPayrollInput } from "@/server/services/payroll/inputs";

await withSystem((tx) => postPayrollInput(tx, tenantId, {
  employeeId,
  kind: "reimbursement",            // input_kind enum
  componentCode: "REIMB",           // must be an active component that accepts this kind
  amount: 125050,                   // positive paise
  isTaxable: false,
  note: "Expense claim EXP-0042",
  sourceType: "expense_claim",      // module-specific, never "manual"/"csv_import"
  sourceId: claimId,                // stable id of the source record
  effectiveOn: "2026-10-20",        // first open period whose input cutoff ≥ this date
}), tenantId);
```

| sourceType | kind | component | taxable |
| --- | --- | --- | --- |
| `expense_claim` | `reimbursement` | `REIMB` | usually no |
| `referral_reward` | `referral_reward` | `REFERRAL` | yes |
| `leave_encashment` | `leave_encashment` | `LEAVE_ENC` | yes |

Return values: `created`, `duplicate` (already posted, no change) or `no_open_period` (no open period of the employee's legal entity can take it yet, or the period's run is awaiting approval). On `no_open_period`, let your job fail and retry later. Call it from a system job (`withSystem`) or a context holding `payroll.run`; RLS rejects other users. Payroll can delete only manual/CSV inputs; reverse module inputs in their module.

CSV import (period page): columns `employee_code, kind, component_code, amount, taxable, note, reference`. The idempotency key is `csv:<period>:<employee>:<component>:<reference or row hash>`, so re-importing the same file never double-posts.

## Run lifecycle

`draft → calculated → pending_approval → approved → locked → disbursed → published` (`cancelled` from draft/calculated).

| Step | Who | What happens |
| --- | --- | --- |
| Open period | payroll.run | One per legal entity and month; emits `payroll.period_opened` |
| Calculate | payroll.run (+ compensation and statutory view) | Idempotency key per request: the same key on a calculated run returns the stored result. Otherwise previous results are deleted and re-inserted in one transaction. Stores per-employee snapshot (inputs, compensation record, structure version, rule-set ids/versions/verification, YTD, statutory breakdown, variance), line items, messages, totals, `calculationBasis`, `usesUnverifiedRules`. Variance vs the previous posted regular run (default ±10%, chosen per calculation). |
| Submit | payroll.run | Blocks on employee errors. Computes `snapshotHash` = SHA-256 of canonical JSON of all results and line items; starts approval `payroll_run` (seeded policy: HR review, then finance). |
| Approve / reject | approvers | Approval re-verifies the hash and sets `approved`; rejection or withdrawal returns the run to `calculated`. From `approved`, a DB trigger freezes results. |
| Lock | payroll.approve | Verifies the hash; refuses unverified rule sets unless an override with the typed confirmation `LOCK WITH UNVERIFIED RULES` is given (`unverifiedOverrideBy` recorded and audited). Locks attendance, posts loan repayments (unique per loan and run, outstanding reduced once), locks the period; emits `payroll.locked`. |
| Disburse | payroll.run (+ statutory view) | Generic CSV or NEFT bulk file; one `disbursements` row per employee per run. Employees already in a non-failed disbursement are never included again; failed ones are re-issued. Account numbers are decrypted only in memory; the file is stored as a sensitive, HR-only document. Bank responses (`payment_reference, status, utr, failure_reason`) are applied idempotently. |
| Publish | payroll.approve or payroll.run | One PDF per employee (stored as `employeeVisible`, `isSensitive`), `payslips` row with `publishedAt`, notification without amounts; re-publishing skips existing payslips. Emits `payroll.payslips_published`. |
| Corrections | payroll.run | After lock, only through an **adjustment** run (`parentRunId`): selected employees are recalculated for the period with current data, using the parent's YTD, and only the per-component differences are posted. **Full and final** runs pay salary to the last working day (unless already paid by the posted regular run) plus leave encashment, notice pay / recovery and gratuity; both go through the same approval. |

Registers and summaries (run → Summaries) are labelled "for reconciliation; not a statutory return". The payroll register CSV requires `payroll.view` and `reports.export` and each export is audited.

## Statutory parameters (seeded defaults, all UNVERIFIED)

Amounts in paise in the JSON; rupees below. Effective dates are the `effectiveFrom` stored on the seed.

| Kind | Jurisdiction | Effective | Parameters | Source reference |
| --- | --- | --- | --- | --- |
| pf | IN | 2014-09-01 | employee 12%, employer 12% (EPS 8.33% of wages up to ₹15,000), wage ceiling ₹15,000, EPS ceiling ₹15,000, EPS stops at 58, employer always on capped wage, round half-up to ₹1 | EPF & MP Act 1952 s.6; EPF Scheme para 29; EPS 1995 para 3; G.S.R. 609(E) 22-08-2014 |
| esi | IN | 2019-07-01 | employee 0.75%, employer 3.25%, coverage ≤ ₹21,000/month, contribution periods Apr–Sep and Oct–Mar, round up to ₹1 | ESI Act s.39; ESI (Central) Rules r.51; G.S.R. 423(E) 13-06-2019 |
| pt | IN-KA | 2025-04-01 | < ₹25,000 nil; ≥ ₹25,000 ₹200, February ₹300 | Karnataka PT Act 1976, Schedule entry 1 (2025 amendment) |
| pt | IN-MH | 2023-04-01 | men: ≤ ₹7,500 nil, ≤ ₹10,000 ₹175, above ₹200 (Feb ₹300); women: ≤ ₹25,000 nil, above ₹200 (Feb ₹300) | Maharashtra PT Act 1975, Schedule I entry 1 |
| pt | IN-TN | 2024-10-01 | half-yearly (Sep, Mar) on half-year wages: ≤ ₹21,000 nil; ≤ ₹30,000 ₹180; ≤ ₹45,000 ₹425; ≤ ₹60,000 ₹930; ≤ ₹75,000 ₹1,025; above ₹1,250 | TN Urban Local Bodies Act 1998 / Greater Chennai Corporation schedule (varies by local body) |
| pt | IN-TG | 2015-04-01 | ≤ ₹15,000 nil; ≤ ₹20,000 ₹150; above ₹200 | Telangana PT Act 1987 |
| pt | IN-WB | 2015-04-01 | ≤ ₹10,000 nil; ≤ ₹15,000 ₹110; ≤ ₹25,000 ₹130; ≤ ₹40,000 ₹150; above ₹200 | West Bengal PT Act 1979 |
| pt | IN-GJ | 2023-04-01 | < ₹12,000 nil; ≥ ₹12,000 ₹200 | Gujarat PT Act 1976 (2023 amendment) |
| pt | other states | — | none seeded: PT not deducted, info message shown | — |
| lwf | IN-KA | 2024-01-01 | December: employee ₹50, employer ₹100 | Karnataka LWF Act 1965 s.7A (2024 amendment) |
| lwf | IN-MH | 2019-01-01 | June and December: wages ≤ ₹3,000 ₹6/₹18; above ₹12/₹36 (reported revised in 2024; verify) | Maharashtra LWF Act 1953 s.6BB |
| income_tax | IN | 2025-04-01 | FY 2025-26. New: SD ₹75,000; slabs 0–4L nil, 4–8L 5%, 8–12L 10%, 12–16L 15%, 16–20L 20%, 20–24L 25%, above 30%; 87A rebate up to ₹60,000 for income ≤ ₹12L with marginal relief; surcharge 10/15/25% above ₹50L/₹1Cr/₹2Cr; cess 4%. Old: SD ₹50,000; 0–2.5L nil (3L senior, 5L super senior), 2.5–5L 5%, 5–10L 20%, above 30%; 87A ₹12,500 for income ≤ ₹5L; surcharge up to 37% above ₹5Cr; cess 4%; limits 80C ₹1.5L, 80CCD(1B) ₹50,000, 80D ₹25,000, 24(b) ₹2L, 80TTA ₹10,000 | Income-tax Act s.115BAC, First Schedule, s.87A, s.16(ia), s.192; Finance Act 2025 |
| gratuity | IN | 2018-03-29 | basic+DA × 15/26 × years; part-year over 6 months counts; minimum 5 completed years; cap ₹20 lakh; round half-up to ₹1 | Payment of Gratuity Act s.4; S.O. 1420(E) 29-03-2018 |
| bonus | IN | 2015-04-01 | eligibility ≤ ₹21,000/month, calculation ceiling ₹7,000 (or minimum wage if higher), 8.33%–20%, min 30 days worked (calculator only) | Payment of Bonus Act ss.2(13), 8, 10, 11, 12 (2015 amendment) |

Rule sets are configuration (Configuration → Statutory rules). Editing never changes a version: it saves a new, unverified version. Resolution picks, per kind and jurisdiction, the rule set effective on the period end date (`effectiveFrom ≤ date < effectiveTo`), latest effective date first, then highest version. "Mark verified" records `verifiedBy`/`verifiedAt` after an explicit attestation.

## Verification checklist before go-live

A qualified payroll professional should sign off each item, then mark the rule set verified in the app.

1. **PF**: rates, ₹15,000 wage ceiling, EPS 8.33% / EPS ceiling, EPS age limit, rounding; whether your establishment uses the employer-on-capped-wage policy; employees who should be opted out or contribute on actual wages (needs the profile schema change).
2. **ESI**: rates, ₹21,000 threshold, contribution periods, rounding; whether your locations are ESI-implemented areas.
3. **Professional tax**: slabs and month-specific amounts for every state you employ in; local-body variations (e.g. Tamil Nadu); add rule sets for states not seeded.
4. **LWF**: amounts, periodicity and applicability (managerial exclusions) for each state; add missing states.
5. **Income tax**: add the rule set for the current financial year (FY 2025-26 is seeded; FY 2026-27 and later must be added); check slabs, standard deduction, 87A rebate and marginal relief, surcharge, cess, deduction limits, and the TDS spreading policy; confirm treatment of missing PAN (s.206AA).
6. **Gratuity**: formula, eligibility years, part-year rounding, cap, and tax treatment of gratuity and leave encashment in F&F.
7. **Bonus**: eligibility and calculation ceilings, minimum wage per state, percentage.
8. **Components**: taxability, PF/ESI/PT wage flags, proration and whether employer PF is inside CTC, for every component you use.
9. **Structures**: preview each structure for a range of CTCs (Configuration → Structures → Preview).
10. **Parallel run**: run at least one month in parallel with your current payroll and reconcile the register and statutory summaries line by line.
11. **Bank file**: confirm the NEFT bulk template with your bank and do a test upload.

## Permissions

`payroll.view` (read runs), `payroll.run` (prepare, calculate, inputs, disburse), `payroll.approve` (lock, publish), `payroll.config` (components, structures, rule sets), `payslips.view` (self/team/all), plus `compensation.view`/`employees.sensitive.view` for calculation and disbursement, and `compensation.edit` to assign structures. Database RLS restricts payroll tables to payroll staff; employees read only their own published results; approved/locked/published results are frozen by a trigger.

## RLS gaps (interim elevation)

Two business rules are wider than the current policies. The service authorizes them itself and then temporarily adds payroll grants to `app.perms` for the transaction (`withPayrollGrants` in `shared.ts`):

1. **Approval outcomes**: the HR reviewer (step 1, `hr_admin`, no payroll permissions) may reject; the run must return to `calculated` in the same transaction. The approval engine has already verified the decider is an assigned approver.
2. **Loan repayments at lock**: locking needs `payroll.approve`, but `employee_loans` updates require `payroll.run`.

Policy changes that remove the elevation:

```sql
drop policy loans_update on public.employee_loans;
create policy loans_update on public.employee_loans as restrictive for update to authenticated
  using (app.has_perm('payroll.run') or app.has_perm('payroll.approve'));
-- and, for approval transitions, a security-definer function
create or replace function app.payroll_run_transition(run uuid, from_status run_status, to_status run_status)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.approval_requests r
                 where r.subject_type = 'payroll_run' and r.subject_id = run
                   and r.tenant_id = app.current_tenant_id()) then
    raise exception 'No approval for this run' using errcode = 'P0001';
  end if;
  update public.payroll_runs set status = to_status,
    snapshot_hash = case when to_status = 'calculated' then null else snapshot_hash end
  where id = run and status = from_status and tenant_id = app.current_tenant_id();
end $$;
```

## Schema changes needed

```sql
-- Per-employee statutory profile (defaults reproduce today's behaviour).
create table public.payroll_employee_profiles (
  employee_id uuid primary key references public.employees(id),
  tenant_id uuid not null references public.tenants(id),
  pf_applicable boolean not null default true,
  pf_wage_basis text not null default 'capped' check (pf_wage_basis in ('capped','actual')),
  eps_eligible boolean not null default true,
  esi_override text not null default 'auto' check (esi_override in ('auto','exempt','covered')),
  pt_state_code text,
  lwf_applicable boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- + tenant RLS and a payroll-only policy like the other payroll tables.

-- Tenant payroll settings (variance threshold, debit account for bank files, net-pay rounding).
create table public.payroll_settings (
  tenant_id uuid primary key references public.tenants(id),
  variance_threshold_pct numeric(5,2) not null default 10,
  debit_account_last4 text,
  net_pay_rounding text not null default 'none',
  updated_at timestamptz not null default now()
);

-- Optional: let payroll put individual employees on hold across recalculations.
alter table public.payroll_run_employees add column hold_reason text;
```
