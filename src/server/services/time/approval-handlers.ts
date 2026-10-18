import { registerApprovalHandler } from "../approvals/engine";
import { onLeaveApproved, onLeaveClosed } from "./leave-requests";
import { onRegularizationApproved, onRegularizationClosed } from "./regularizations";
import { onTimesheetDecided } from "./timesheets";

registerApprovalHandler("leave_request", {
  label: "Leave request",
  href: (id) => `/leave/requests/${id}`,
  onApproved: async ({ tx, request, actor }) => onLeaveApproved(tx, actor, request.subjectId),
  onRejected: async ({ tx, request, actor, comment }) => onLeaveClosed(tx, actor, request.subjectId, "rejected", comment),
  onCancelled: async ({ tx, request, actor }) => onLeaveClosed(tx, actor, request.subjectId, "cancelled", null),
});

registerApprovalHandler("attendance_regularization", {
  label: "Attendance correction",
  href: () => "/attendance?tab=regularizations",
  onApproved: async ({ tx, request, actor }) => onRegularizationApproved(tx, actor, request.subjectId),
  onRejected: async ({ tx, request, actor }) => onRegularizationClosed(tx, actor, request.subjectId, "rejected"),
  onCancelled: async ({ tx, request, actor }) => onRegularizationClosed(tx, actor, request.subjectId, "cancelled"),
});

registerApprovalHandler("timesheet", {
  label: "Timesheet",
  href: (id) => `/attendance/timesheets/${id}`,
  onApproved: async ({ tx, request, actor }) => onTimesheetDecided(tx, actor, request.subjectId, "approved"),
  onRejected: async ({ tx, request, actor }) => onTimesheetDecided(tx, actor, request.subjectId, "rejected"),
  onCancelled: async ({ tx, request, actor }) => onTimesheetDecided(tx, actor, request.subjectId, "draft"),
});
