import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getSurveyForResponse } from "@/server/services/talent/engagement/surveys";
import { formatDate, todayIn } from "@/lib/format";
import { RespondForm } from "../../../_components/survey-client";

export const metadata: Metadata = { title: "Survey" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function RespondPage({ params }: PageProps<"/engagement/surveys/[id]/respond">) {
  return (
    <Page width="narrow">
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        }
      >
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

async function Body({ params }: { params: PageProps<"/engagement/surveys/[id]/respond">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  let s;
  try {
    s = await getSurveyForResponse(ctx, id);
  } catch (err) {
    if (err instanceof AppError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) notFound();
    throw err;
  }
  const back = (
    <Button size="sm" variant="outline" asChild>
      <Link href="/engagement?tab=surveys">Back to surveys</Link>
    </Button>
  );
  return (
    <>
      <PageHeader title={s.title} description={s.description ?? undefined} />
      {s.respondedOn ? (
        <EmptyState icon={CheckCircle2} title="Thanks, you've responded" description={`Your response was recorded on ${formatDate(s.respondedOn)}. Each person can respond once.`} action={back} />
      ) : !s.open ? (
        <EmptyState
          icon={Clock}
          title="This survey is not open"
          description={s.opensOn && s.opensOn > todayIn() ? `It opens on ${formatDate(s.opensOn)}.` : "It has closed."}
          action={back}
        />
      ) : (
        <>
          {s.isAnonymous ? (
            <div className="mb-5 flex gap-3 rounded-xl border bg-info-soft px-4 py-3 text-sm text-info">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <p>
                This survey is anonymous. Your answers are stored without your name or id, with only your department, location and tenure band, and results are shown only for groups of {s.minGroupSize} or more.
              </p>
            </div>
          ) : (
            <p className="mb-5 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">This survey is not anonymous: your answers are linked to your employee record. Results are still reported in groups.</p>
          )}
          <RespondForm surveyId={s.id} questions={s.questions} anonymous={s.isAnonymous} />
        </>
      )}
    </>
  );
}
