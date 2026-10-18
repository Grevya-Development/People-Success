import {
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  Clock,
  FileText,
  Gift,
  HeartHandshake,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  ReceiptIndianRupee,
  Settings,
  Target,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon as NavIconName } from "@/lib/navigation";

export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  overview: LayoutDashboard,
  inbox: Inbox,
  recruitment: Briefcase,
  onboarding: UserPlus,
  employees: Users,
  organization: Building2,
  attendance: Clock,
  leave: CalendarDays,
  payroll: Wallet,
  expenses: ReceiptIndianRupee,
  performance: Target,
  learning: BookOpen,
  engagement: HeartHandshake,
  referrals: Gift,
  helpdesk: LifeBuoy,
  documents: FileText,
  workflows: Workflow,
  reports: BarChart3,
  agents: Bot,
  integrations: Blocks,
  settings: Settings,
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = NAV_ICONS[name];
  return <Icon className={className} aria-hidden />;
}
