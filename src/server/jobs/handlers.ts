/**
 * Registers every job handler, event subscriber and schedule. Modules add
 * their own registration file and import it here (append-only).
 */
import "./core-handlers";
import "../services/workflows/jobs";
import "../services/time/jobs";
import "../services/reports/jobs";
import "../services/lifecycle/jobs";
import "../services/payroll/jobs";
import "../services/recruitment/jobs";
import "../services/expenses/jobs";
import "../services/benefits/jobs";
import "../services/helpdesk/jobs";
import "../services/talent/jobs";
