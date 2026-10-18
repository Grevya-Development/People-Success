import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink, EditorSkeleton, PolicyEditorData } from "../editor-data";

export const metadata: Metadata = { title: "New approval policy" };

export default function NewPolicyPage({ searchParams }: PageProps<"/settings/approvals/new">) {
  return (
    <>
      <BackLink />
      <Suspense fallback={<EditorSkeleton />}>
        <NewData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewData({ searchParams }: { searchParams: PageProps<"/settings/approvals/new">["searchParams"] }) {
  const sp = await searchParams;
  return <PolicyEditorData id={null} subject={typeof sp.subject === "string" ? sp.subject : null} />;
}
