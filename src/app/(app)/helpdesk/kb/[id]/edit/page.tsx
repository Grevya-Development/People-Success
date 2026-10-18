import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { ErrorState, NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getKbArticle } from "@/server/services/helpdesk/kb";
import { canManageHelpdesk } from "@/server/services/helpdesk/rules";
import { KbArticleForm } from "../../kb-form";

export const metadata: Metadata = { title: "Edit article" };

export default function EditKbArticlePage({ params }: PageProps<"/helpdesk/kb/[id]/edit">) {
  return (
    <Page width="narrow">
      <PageHeader title="Edit article" description="Edits to a published article are reindexed for the HR assistant immediately." />
      <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-xl" />}>
        <Loader params={params} />
      </Suspense>
    </Page>
  );
}

async function Loader({ params }: { params: PageProps<"/helpdesk/kb/[id]/edit">["params"] }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!canManageHelpdesk(ctx)) return <NoAccess />;
  let a: Awaited<ReturnType<typeof getKbArticle>>;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    a = await getKbArticle(ctx, id);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    logger.error("helpdesk.kb_edit_failed", { err });
    return <ErrorState title="Could not load this article" />;
  }
  return <KbArticleForm article={{ id: a.id, title: a.title, category: a.category, body: a.body, status: a.status }} />;
}
