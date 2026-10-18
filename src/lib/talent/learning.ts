/** Learning helpers: quiz scoring, certificate expiry and enrollment buckets. */

export type QuizLite = { passMark: number; questions: { id: string; prompt: string; options: string[]; answer: number }[] };

export type QuizResult = { score: number; correct: number; total: number; passed: boolean };

/** Score a quiz attempt. `answers` maps question id → chosen option index. */
export function scoreQuiz(quiz: QuizLite, answers: Record<string, number>): QuizResult {
  const total = quiz.questions.length;
  if (!total) return { score: 100, correct: 0, total: 0, passed: true };
  const correct = quiz.questions.filter((q) => answers[q.id] === q.answer).length;
  const score = Math.round((correct / total) * 100);
  return { score, correct, total, passed: score >= quiz.passMark };
}

/** yyyy-MM-dd + whole months, clamped to the last day of the target month. */
export function addMonthsIso(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export type LearningBucket = "assigned" | "in_progress" | "overdue" | "completed" | "expired" | "waived";

/** Display bucket for an enrollment: open enrollments past their due date are overdue. */
export function learningBucket(status: string, dueOn: string | null, today: string): LearningBucket {
  if ((status === "assigned" || status === "in_progress") && dueOn && dueOn < today) return "overdue";
  return status as LearningBucket;
}

export type AssignmentTarget = { departmentIds?: string[]; designationIds?: string[]; all?: boolean; newJoiners?: boolean };
export type EmployeeLite = { id: string; departmentId: string | null; designationId: string | null; joiningDate: string };

/**
 * Whether an employee matches an assignment rule. Department and designation
 * filters combine with AND; "new joiners" limits the rule to people who joined
 * on or after the rule was created.
 */
export function matchesAssignment(target: AssignmentTarget, e: EmployeeLite, ruleCreatedOn: string) {
  if (target.newJoiners && e.joiningDate < ruleCreatedOn) return false;
  const deps = target.departmentIds ?? [];
  const desigs = target.designationIds ?? [];
  if (!target.all && !target.newJoiners && !deps.length && !desigs.length) return false;
  if (deps.length && (!e.departmentId || !deps.includes(e.departmentId))) return false;
  if (desigs.length && (!e.designationId || !desigs.includes(e.designationId))) return false;
  return true;
}
