import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Page, PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getCourse } from "@/server/services/talent/learning/courses";
import { formatDate } from "@/lib/format";
import { COURSE_FORMAT_LABELS } from "@/lib/validation/talent";
import { CourseDialog, UploadMaterial, type CourseFormValues } from "../../_components/learning-dialogs";
import { CoursePlayer, MaterialButton } from "../../_components/course-player";

export const metadata: Metadata = { title: "Course" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CoursePage({ params }: PageProps<"/learning/courses/[id]">) {
  return (
    <Page width="narrow">
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        }
      >
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

async function Body({ params }: { params: PageProps<"/learning/courses/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  let data;
  try {
    data = await getCourse(ctx, id);
  } catch (err) {
    if (err instanceof AppError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) notFound();
    throw err;
  }
  const { course, enrollment, material, canManage } = data;
  const quiz = course.quiz ? { passMark: course.quiz.passMark, questions: course.quiz.questions.map(({ id: qid, prompt, options }) => ({ id: qid, prompt, options })) } : null;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/learning?tab=catalog" className="hover:underline">
            Learning · Catalog
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {course.title}
            {course.isMandatory ? <StatusBadge status="mandatory" tone="brand" /> : null}
            {!course.isActive ? <StatusBadge status="inactive" /> : null}
          </span>
        }
        description={[
          COURSE_FORMAT_LABELS[course.format as keyof typeof COURSE_FORMAT_LABELS] ?? course.format,
          course.durationMinutes ? `${course.durationMinutes} minutes` : null,
          course.provider,
          course.certificateValidityMonths ? `Certificate valid ${course.certificateValidityMonths} months` : "Certificate does not expire",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canManage ? (
            <>
              <UploadMaterial courseId={course.id} current={material?.fileName ?? null} />
              <CourseDialog
                values={{
                  id: course.id,
                  title: course.title,
                  description: course.description,
                  format: course.format as CourseFormValues["format"],
                  provider: course.provider,
                  url: course.url,
                  durationMinutes: course.durationMinutes,
                  skills: course.skills,
                  isMandatory: course.isMandatory,
                  certificateValidityMonths: course.certificateValidityMonths,
                  quiz: course.quiz as CourseFormValues["quiz"],
                  isActive: course.isActive,
                }}
              />
            </>
          ) : null
        }
      />
      <div className="space-y-6">
        {course.description ? (
          <Section title="About this course">
            <p className="px-5 py-4 text-sm whitespace-pre-wrap">{course.description}</p>
          </Section>
        ) : null}
        {course.skills.length ? (
          <div className="flex flex-wrap gap-1.5">
            {course.skills.map((s) => (
              <span key={s} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                {s}
              </span>
            ))}
          </div>
        ) : null}
        {material ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Course material:</span>
            <MaterialButton courseId={course.id} fileName={material.fileName} />
          </div>
        ) : null}
        <Section title="Your progress" description={enrollment?.dueOn && enrollment.status !== "completed" ? `Due ${formatDate(enrollment.dueOn)}` : undefined}>
          <div className="px-5 py-4">
            {ctx.employeeId ? (
              course.isActive ? (
                <CoursePlayer courseId={course.id} url={course.url} enrollment={enrollment} quiz={quiz} />
              ) : (
                <p className="text-sm text-muted-foreground">This course is inactive.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Your account is not linked to an employee record, so you cannot enroll.</p>
            )}
          </div>
        </Section>
      </div>
    </>
  );
}
