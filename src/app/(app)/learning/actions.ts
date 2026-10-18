"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import { courseSchema, enrollSelfSchema, learningAssignmentSchema, learningPathSchema, progressSchema, quizAttemptSchema } from "@/lib/validation/talent";
import { attachCourseMaterial, courseMaterialLink, saveCourse, savePath } from "@/server/services/talent/learning/courses";
import { createAssignment, setAssignmentActive } from "@/server/services/talent/learning/assignments";
import { enrollSelf, submitQuiz, updateProgress } from "@/server/services/talent/learning/enrollments";

const done = <T>(v: T) => {
  refresh();
  return v;
};

export const saveCourseAction = defineAction({ input: courseSchema, permission: "learning.manage", scope: "all" }, async (ctx, i) => done(await saveCourse(ctx, i)));

export const uploadCourseMaterialAction = defineAction(
  { input: z.instanceof(FormData, { message: "Invalid upload" }), permission: "learning.manage", scope: "all" },
  async (ctx, form) => {
    const courseId = form.get("courseId");
    const file = form.get("file");
    if (typeof courseId !== "string" || !z.uuid().safeParse(courseId).success) throw new AppError("VALIDATION", "Choose a course.");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Choose a file to upload.", { fieldErrors: { file: ["Choose a file"] } });
    return done(await attachCourseMaterial(ctx, courseId, file));
  },
);

export const courseMaterialLinkAction = defineAction({ input: z.object({ courseId: z.uuid() }) }, async (ctx, i) => courseMaterialLink(ctx, i.courseId));
export const savePathAction = defineAction({ input: learningPathSchema, permission: "learning.manage", scope: "all" }, async (ctx, i) => done(await savePath(ctx, i)));
export const createAssignmentAction = defineAction({ input: learningAssignmentSchema, permission: "learning.manage", scope: "all" }, async (ctx, i) => done(await createAssignment(ctx, i)));
export const setAssignmentActiveAction = defineAction({ input: z.object({ id: z.uuid(), isActive: z.boolean() }), permission: "learning.manage", scope: "all" }, async (ctx, i) =>
  done(await setAssignmentActive(ctx, i.id, i.isActive)),
);
export const enrollSelfAction = defineAction({ input: enrollSelfSchema }, async (ctx, i) => done(await enrollSelf(ctx, i.courseId)));
export const updateProgressAction = defineAction({ input: progressSchema }, async (ctx, i) => done(await updateProgress(ctx, i)));
export const submitQuizAction = defineAction({ input: quizAttemptSchema }, async (ctx, i) => done(await submitQuiz(ctx, i)));
