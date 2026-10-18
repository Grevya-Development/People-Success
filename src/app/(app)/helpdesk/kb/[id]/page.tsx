import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ErrorState, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Markdown } from "@/components/documents/markdown";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getKbArticle } from "@/server/services/helpdesk/kb";
import { formatDate, titleCase } from "@/lib/format";
import { KbManageActions } from "./kb-actions";

export const metadata: Metadata = { title: "Article" };

export default function KbArticlePage({ params }: PageProps<"/helpdesk/kb/[id]">) {
  return (
    <Page width="narrow">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/helpdesk?tab=kb">
          <ArrowLeft data-icon="inline-start" /> Knowledge base
        </Link>
      </Button>
      <Suspense
        fallback={
          <>
            <PageHeader title={<Skeleton className="h-7 w-72" />} />
            <TableSkeleton rows={6} columns={1} />
          </>
        }
      >
        <Content params={params} />
      </Suspense>
    </Page>
  );
}

async function Content({ params }: { params: PageProps<"/helpdesk/kb/[id]">["params"] }) {
  const { id } = await params;
  const ctx = await requireContext();
  let a: Awaited<ReturnType<typeof getKbArticle>>;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    a = await getKbArticle(ctx, id);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    logger.error("helpdesk.kb_load_failed", { err });
    return <ErrorState title="Could not load this article" />;
  }
  return (
    <Reveal className="space-y-5">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {titleCase(a.category)}
            {a.canManage ? <StatusBadge status={a.status} /> : null}
          </span>
        }
        title={a.title}
        className="mb-0"
        actions={a.canManage ? <KbManageActions id={a.id} status={a.status} /> : null}
      />
      <p className="text-xs text-muted-foreground">
        {a.publishedAt ? `Published ${formatDate(a.publishedAt)}` : "Not published"} · Updated {formatDate(a.updatedAt)}
        {a.authorName && a.canManage ? ` · by ${a.authorName}` : ""}
      </p>
      <Section>
        <article className="px-5 py-5 sm:px-7 sm:py-6">
          <Markdown source={a.body} />
        </article>
      </Section>
      <p className="text-sm text-muted-foreground">
        Didn&apos;t answer your question?{" "}
        <Link href="/helpdesk/new" className="underline underline-offset-2">
          Raise a ticket
        </Link>
        .
      </p>
    </Reveal>
  );
}
