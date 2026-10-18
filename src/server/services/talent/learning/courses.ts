import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { authorize, can, type RequestContext } from "../../../auth/context";
import { courses, documentAccessLogs, documents, learningEnrollments, learningPaths } from "../../../db/schema";
import { audit, diff } from "../../../lib/audit";
import { forbidden, notFound, validation } from "../../../lib/errors";
import { inspectUpload } from "../../documents/files";
import { getMalwareScanner } from "../../documents/scanner";
import { putObject, removeObject, signedDownloadUrl } from "../../documents/storage";
import type { courseSchema, learningPathSchema } from "@/lib/validation/talent";

type CourseRow = typeof courses.$inferSelect;
const BUCKET = "documents";

export const canManageLearning = (ctx: RequestContext) => can(ctx, "learning.manage", "all");

function assertLearningAccess(ctx: RequestContext) {
  if (!ctx.grants["learning.view"] && !canManageLearning(ctx)) throw forbidden();
}

/** Quiz without the answer key, for learners. */
export function publicQuiz(quiz: CourseRow["quiz"]) {
  if (!quiz) return null;
  return { passMark: quiz.passMark, questions: quiz.questions.map(({ id, prompt, options }) => ({ id, prompt, options })) };
}

export type CatalogItem = Omit<CourseRow, "quiz" | "createdAt" | "updatedAt"> & {
  hasQuiz: boolean;
  questionCount: number;
  myStatus: string | null;
  enrolled: number;
  completed: number;
};

export async function listCatalog(ctx: RequestContext): Promise<CatalogItem[]> {
  assertLearningAccess(ctx);
  const manage = canManageLearning(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(courses)
      .where(manage ? undefined : eq(courses.isActive, true))
      .orderBy(desc(courses.isMandatory), asc(courses.title));
    const mine = ctx.employeeId
      ? await tx
          .select({ courseId: learningEnrollments.courseId, status: learningEnrollments.status })
          .from(learningEnrollments)
          .where(eq(learningEnrollments.employeeId, ctx.employeeId))
          .orderBy(desc(learningEnrollments.createdAt))
      : [];
    const myMap = new Map<string, string>();
    for (const m of mine) if (!myMap.has(m.courseId)) myMap.set(m.courseId, m.status);
    const stats = manage && rows.length
      ? await tx
          .select({
            courseId: learningEnrollments.courseId,
            enrolled: sql<number>`count(*)`.mapWith(Number),
            completed: sql<number>`count(*) filter (where ${learningEnrollments.status} = 'completed')`.mapWith(Number),
          })
          .from(learningEnrollments)
          .where(inArray(learningEnrollments.courseId, rows.map((r) => r.id)))
          .groupBy(learningEnrollments.courseId)
      : [];
    const statMap = new Map(stats.map((s) => [s.courseId, s]));
    return rows.map(({ quiz, createdAt, updatedAt, ...c }) => {
      void createdAt;
      void updatedAt;
      return {
        ...c,
        hasQuiz: !!quiz?.questions.length,
        questionCount: quiz?.questions.length ?? 0,
        myStatus: myMap.get(c.id) ?? null,
        enrolled: statMap.get(c.id)?.enrolled ?? 0,
        completed: statMap.get(c.id)?.completed ?? 0,
      };
    });
  });
}

export async function getCourse(ctx: RequestContext, id: string) {
  assertLearningAccess(ctx);
  const manage = canManageLearning(ctx);
  return ctx.db(async (tx) => {
    const [c] = await tx.select().from(courses).where(eq(courses.id, id));
    if (!c || (!c.isActive && !manage)) throw notFound("Course");
    const [enrollment] = ctx.employeeId
      ? await tx
          .select()
          .from(learningEnrollments)
          .where(and(eq(learningEnrollments.courseId, id), eq(learningEnrollments.employeeId, ctx.employeeId)))
          .orderBy(desc(learningEnrollments.createdAt))
          .limit(1)
      : [];
    const [material] = c.documentId
      ? await tx.select({ id: documents.id, fileName: documents.fileName, sizeBytes: documents.sizeBytes, mimeType: documents.mimeType }).from(documents).where(eq(documents.id, c.documentId))
      : [];
    const { quiz, ...rest } = c;
    return {
      course: { ...rest, quiz: manage ? quiz : publicQuiz(quiz) },
      enrollment: enrollment ?? null,
      material: material ?? null,
      canManage: manage,
    };
  });
}

export async function saveCourse(ctx: RequestContext, input: z.output<typeof courseSchema>) {
  authorize(ctx, "learning.manage", "all");
  if ((input.format === "link" || input.format === "video" || input.format === "external") && !input.url) {
    throw validation("Add the course link.", { url: ["Enter a URL"] });
  }
  const values = {
    title: input.title,
    description: input.description,
    format: input.format,
    provider: input.provider,
    url: input.url,
    durationMinutes: input.durationMinutes,
    skills: [...new Set(input.skills.map((s) => s.trim()).filter(Boolean))],
    isMandatory: input.isMandatory,
    certificateValidityMonths: input.certificateValidityMonths,
    quiz: input.quiz,
    isActive: input.isActive,
  };
  return ctx.db(async (tx) => {
    if (input.id) {
      const [before] = await tx.select().from(courses).where(eq(courses.id, input.id));
      if (!before) throw notFound("Course");
      await tx.update(courses).set(values).where(eq(courses.id, input.id));
      await audit(tx, ctx, { action: "course.updated", entityType: "course", entityId: input.id, changes: diff(before, { ...values, quiz: values.quiz ? `${values.quiz.questions.length} questions` : null }) });
      return { id: input.id };
    }
    const [row] = await tx.insert(courses).values({ tenantId: ctx.tenantId, ...values, createdBy: ctx.userId }).returning({ id: courses.id });
    await audit(tx, ctx, { action: "course.created", entityType: "course", entityId: row.id, metadata: { title: input.title, format: input.format } });
    return row;
  });
}

/**
 * Upload course material (format "document" or any course). Stored as a
 * document owned by the course; learners download it through
 * courseMaterialLink, which checks learning access and logs the download.
 */
export async function attachCourseMaterial(ctx: RequestContext, courseId: string, rawFile: File) {
  authorize(ctx, "learning.manage", "all");
  await ctx.db(async (tx) => {
    const [c] = await tx.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId));
    if (!c) throw notFound("Course");
  });
  const file = await inspectUpload(rawFile);
  const scanStatus = await getMalwareScanner().scan(file.bytes, file.mimeType).catch(() => "error" as const);
  if (scanStatus === "infected") throw validation("This file failed the malware scan and was not stored.", { file: ["Malware detected"] });
  const storagePath = `${ctx.tenantId}/course/${courseId}/${randomUUID()}.${file.ext}`;
  await putObject(BUCKET, storagePath, file.bytes, file.mimeType);
  try {
    return await ctx.db(async (tx) => {
      const [course] = await tx.select().from(courses).where(eq(courses.id, courseId)).for("update");
      if (!course) throw notFound("Course");
      if (course.documentId) await tx.update(documents).set({ isCurrent: false }).where(eq(documents.id, course.documentId));
      const [doc] = await tx
        .insert(documents)
        .values({
          tenantId: ctx.tenantId,
          ownerType: "course",
          ownerId: courseId,
          category: "other",
          title: `${course.title} material`,
          bucket: BUCKET,
          storagePath,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          supersedesId: course.documentId,
          employeeVisible: true,
          scanStatus,
          uploadedBy: ctx.userId,
        })
        .returning({ id: documents.id });
      await tx.update(courses).set({ documentId: doc.id }).where(eq(courses.id, courseId));
      await audit(tx, ctx, { action: "course.material_uploaded", entityType: "course", entityId: courseId, metadata: { documentId: doc.id, sizeBytes: file.sizeBytes, mimeType: file.mimeType, scanStatus } });
      return { documentId: doc.id };
    });
  } catch (err) {
    await removeObject(BUCKET, storagePath);
    throw err;
  }
}

export async function courseMaterialLink(ctx: RequestContext, courseId: string) {
  assertLearningAccess(ctx);
  const doc = await ctx.db(async (tx) => {
    const [c] = await tx.select().from(courses).where(eq(courses.id, courseId));
    if (!c || (!c.isActive && !canManageLearning(ctx)) || !c.documentId) throw notFound("Course material");
    const [d] = await tx.select().from(documents).where(and(eq(documents.id, c.documentId), eq(documents.ownerType, "course"), eq(documents.ownerId, courseId)));
    if (!d || d.deletedAt) throw notFound("Course material");
    if (d.scanStatus === "infected") throw forbidden("This file is blocked.");
    return d;
  });
  const url = await signedDownloadUrl(doc.bucket, doc.storagePath, doc.fileName, 60);
  await ctx.db((tx) => tx.insert(documentAccessLogs).values({ tenantId: ctx.tenantId, documentId: doc.id, userId: ctx.userId, action: "download" }));
  return { url, fileName: doc.fileName };
}

/* ------------------------------------------------------------------ */
/* Learning paths                                                      */
/* ------------------------------------------------------------------ */

export async function listPaths(ctx: RequestContext) {
  assertLearningAccess(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(learningPaths)
      .where(canManageLearning(ctx) ? undefined : eq(learningPaths.isActive, true))
      .orderBy(asc(learningPaths.title));
    const ids = [...new Set(rows.flatMap((r) => r.courseIds))];
    const titles = ids.length ? await tx.select({ id: courses.id, title: courses.title }).from(courses).where(inArray(courses.id, ids)) : [];
    const titleMap = new Map(titles.map((t) => [t.id, t.title]));
    return rows.map((r) => ({ ...r, courses: r.courseIds.map((id) => ({ id, title: titleMap.get(id) ?? "Removed course" })) }));
  });
}

export async function savePath(ctx: RequestContext, input: z.output<typeof learningPathSchema>) {
  authorize(ctx, "learning.manage", "all");
  const courseIds = [...new Set(input.courseIds)];
  return ctx.db(async (tx) => {
    const found = await tx.select({ id: courses.id }).from(courses).where(inArray(courses.id, courseIds));
    if (found.length !== courseIds.length) throw validation("Some courses no longer exist.", { courseIds: ["Not found"] });
    const values = { title: input.title, description: input.description, courseIds, isActive: input.isActive };
    if (input.id) {
      const [before] = await tx.select().from(learningPaths).where(eq(learningPaths.id, input.id));
      if (!before) throw notFound("Learning path");
      await tx.update(learningPaths).set(values).where(eq(learningPaths.id, input.id));
      await audit(tx, ctx, { action: "learning_path.updated", entityType: "learning_path", entityId: input.id, changes: diff(before, values) });
      return { id: input.id };
    }
    const [row] = await tx.insert(learningPaths).values({ tenantId: ctx.tenantId, ...values }).returning({ id: learningPaths.id });
    await audit(tx, ctx, { action: "learning_path.created", entityType: "learning_path", entityId: row.id, metadata: { title: input.title, courses: courseIds.length } });
    return row;
  });
}
