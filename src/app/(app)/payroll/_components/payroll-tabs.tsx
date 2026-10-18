import { LinkTabs, type LinkTab } from "@/components/documents/link-tabs";
import { can, type RequestContext } from "@/server/auth/context";
import { isPayrollStaff } from "@/server/services/payroll/shared";

export type PayrollSection = "overview" | "configuration" | "payslips";

/** Section tabs shared by the payroll pages. */
export function PayrollTabs({ ctx, active }: { ctx: RequestContext; active: PayrollSection }) {
  const staff = isPayrollStaff(ctx);
  const tabs: (LinkTab & { show: boolean })[] = [
    { key: "overview", label: "Payroll runs", href: "/payroll", show: staff },
    { key: "configuration", label: "Configuration", href: "/payroll/configuration", show: staff },
    { key: "payslips", label: "My payslips", href: "/payroll/payslips", show: can(ctx, "payslips.view") && !!ctx.employeeId },
  ];
  const visible = tabs.filter((t) => t.show);
  if (visible.length < 2) return null;
  return <LinkTabs tabs={visible.map((t) => ({ key: t.key, label: t.label, href: t.href }))} active={active} label="Payroll sections" />;
}
