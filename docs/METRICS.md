# Metric definitions

Every number on a dashboard is computed at request time from source tables (`src/server/services/analytics/metrics.ts`). Dates are inclusive. Filters (department, location, legal entity) apply to the employee's *current* assignment. When the viewer lacks access to a metric's source data, the tile shows **Restricted** instead of a number.

| Metric | Definition | Source | Required access |
|---|---|---|---|
| Headcount | Employees in status active or on notice who joined on/before the period end and had not exited by then. | `employees` | `employees.view:all` or `analytics.executive` |
| New hires | Employees whose joining date falls within the period (pre-joining records excluded). | `employees` | same |
| Exits | Employees whose exit date falls within the period. | `employees` | same |
| Turnover | Exits ÷ average of headcount at period start and end. | `employees` | same |
| Headcount growth | (End headcount − start headcount) ÷ start headcount. | `employees` | same |
| Open positions | Positions in status `open`. | `positions` | same |
| Open openings | Job openings in status `published`. | `job_openings` | `recruitment.view` or `analytics.executive` |
| Time to hire | Median days from application to offer acceptance, for offers accepted in the period. | `offers`, `applications` | same |
| Offer acceptance | Accepted ÷ (accepted + declined + expired) offers decided in the period. | `offers` | `offers.manage`, `offers.approve` or `recruitment.manage` |
| Recruitment funnel | Applications received in the period, grouped by their current stage. | `applications`, `recruitment_stages` | `recruitment.view` |
| Payroll cost | Gross earnings + employer contributions of locked, disbursed or published regular and adjustment runs whose period ends in the range. | `payroll_runs`, `payroll_run_employees` | `payroll.view` or `payroll.approve` |
| Absenteeism | Absent days ÷ scheduled days (present, half day, absent, missing punch, on leave) in processed attendance. | `attendance_days` | `attendance.view:all` or `analytics.executive` |
| Leave per employee | Approved leave days starting in the period ÷ average headcount. | `leave_requests` | same |
| Overtime hours | Sum of overtime minutes ÷ 60. | `attendance_days` | same |
| Review completion | Submitted, shared or acknowledged reviews ÷ all reviews in cycles overlapping the period. | `reviews`, `review_cycles` | `performance.manage` or `analytics.executive` |
| Learning completion | Enrollments completed in the period ÷ enrollments due in the period (capped at 100%). | `learning_enrollments` | `learning.manage` or `analytics.executive` |
| eNPS | % promoters (9–10) − % detractors (0–6) on the latest closed survey with an eNPS question, shown only when responses ≥ the survey's minimum group size. | `surveys`, `survey_responses` | `engagement.results` |
| Ticket volume | HR tickets created in the period. | `tickets` | `helpdesk.agent`, `helpdesk.manage` or `analytics.executive` |
| Ticket resolution time | Median hours from creation to resolution for tickets resolved in the period. | `tickets` | same |

## Operational panels (Overview)

| Panel item | Definition |
|---|---|
| Pending approvals | Approval requests in status pending (tenant-wide for HR). |
| Joining in 30 days | Pre-joining employees with a joining date in the next 30 days. |
| Probation ending in 14 days | Active, unconfirmed employees whose probation ends in the next 14 days. |
| Missing identity documents | Current employees without any non-deleted document in category `identity`. |
| Missing punches yesterday | Attendance days for yesterday with status `missing_punch`. |
| Overdue tasks | Open/in-progress/blocked tasks with a due date before today. |
| Failed workflow runs | Workflow runs in status `failed`. |
| Team members (manager) | Active and on-notice employees in the manager's reporting subtree. |
| Profile completion (employee) | Share of: mobile, personal email, date of birth, address, emergency contact, bank details, PAN. |

Headcount trend charts use month-end headcount under the same definition for each of the last 12 months.
