import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink, EditorSkeleton, PolicyEditorData } from "../editor-data";

export const metadata: Metadata = { title: "Edit approval policy" };

export default function EditPolicyPage({ params }: PageProps<"/settings/approvals/[id]">) {
  return (
    <>
      <BackLink />
      <Suspense fallback={<EditorSkeleton />}>
        <EditData params={params} />
      </Suspense>
    </>
  );
}

async function EditData({ params }: { params: PageProps<"/settings/approvals/[id]">["params"] }) {
  const { id } = await params;
  return <PolicyEditorData id={id} />;
}
