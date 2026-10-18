import { Suspense } from "react";
import { unstable_rethrow } from "next/navigation";
import { FileText } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Reveal, Section, TableSkeleton } from "@/components/page";
import { requireContext } from "@/server/auth/context";
import { canManageDocuments, employeeDocumentAccess, listDocuments } from "@/server/services/documents/documents";
import { logger } from "@/server/lib/logger";
import { todayIn } from "@/lib/format";
import { DOCUMENT_CATEGORIES, SELF_UPLOAD_CATEGORIES } from "@/lib/validation/documents";
import { DocumentLegend, DocumentTable } from "./document-table";
import { UploadDocumentDialog } from "./upload-document-dialog";

/**
 * Documents of one employee, for the employee profile and self-service.
 * HR (documents.manage) sees everything and can upload, verify, version,
 * set retention and delete. The employee sees employee-visible documents
 * and can upload allowed categories. Managers see their reports'
 * non-sensitive, employee-visible documents (read-only).
 *
 * Streams on its own; callers do not need to wrap it in Suspense.
 */
export function EmployeeDocuments({ employeeId, title = "Documents" }: { employeeId: string; title?: string }) {
  return (
    <Suspense fallback={<TableSkeleton rows={4} columns={6} />}>
      <EmployeeDocumentsData employeeId={employeeId} title={title} />
    </Suspense>
  );
}

async function EmployeeDocumentsData({ employeeId, title }: { employeeId: string; title: string }) {
  const ctx = await requireContext();
  let data;
  try {
    const access = await employeeDocumentAccess(ctx, employeeId);
    data = access ? { access, docs: await listDocuments(ctx, { employeeId }) } : null;
  } catch (err) {
    unstable_rethrow(err);
    logger.error("documents.employee_list_failed", { err });
    return <ErrorState title="Could not load documents" />;
  }
  if (!data) return <NoAccess message="You do not have permission to view these documents." />;

  const manage = canManageDocuments(ctx);
  const self = ctx.employeeId === employeeId;
  const canUpload = manage || self;
  const categories = manage ? DOCUMENT_CATEGORIES : SELF_UPLOAD_CATEGORIES;
  const target = { ownerType: "employee" as const, employeeId };
  const description = manage
    ? "Contracts, identity proofs, certificates and letters. Employees see only documents marked visible to them."
    : self
      ? "Your documents on file. Uploads are reviewed by HR."
      : "Documents shared with this employee. Sensitive documents are visible to HR only.";

  return (
    <Reveal>
      <Section
        title={title}
        description={description}
        actions={canUpload ? <UploadDocumentDialog target={target} categories={categories} manage={manage} /> : null}
      >
        {data.docs.length ? (
          <>
            <DocumentTable
              docs={data.docs}
              today={todayIn()}
              manage={manage}
              selfService={self && !manage}
              target={target}
              categories={categories}
              showVisibility={manage || data.access === "full"}
            />
            <DocumentLegend showVisibility={manage || data.access === "full"} />
          </>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description={
                canUpload
                  ? self && !manage
                    ? "Upload your identity proofs, education and certificates so HR can verify them."
                    : "Upload the employee's contract, identity proofs and certificates."
                  : "Nothing has been shared here yet."
              }
              className="border-0"
            />
          </div>
        )}
      </Section>
    </Reveal>
  );
}
