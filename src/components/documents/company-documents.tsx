import { unstable_rethrow } from "next/navigation";
import { Building2 } from "lucide-react";
import { EmptyState, ErrorState, Reveal, Section } from "@/components/page";
import { can, type RequestContext } from "@/server/auth/context";
import { canManageDocuments, listDocuments } from "@/server/services/documents/documents";
import { logger } from "@/server/lib/logger";
import { todayIn } from "@/lib/format";
import { DOCUMENT_CATEGORIES } from "@/lib/validation/documents";
import { DocumentLegend, DocumentTable } from "./document-table";
import { UploadDocumentDialog } from "./upload-document-dialog";

/** Company-wide documents: handbooks, holiday lists, forms, registrations. */
export async function CompanyDocuments({ ctx }: { ctx: RequestContext }) {
  let docs;
  try {
    docs = await listDocuments(ctx, { ownerType: "company" });
  } catch (err) {
    unstable_rethrow(err);
    logger.error("documents.company_list_failed", { err });
    return <ErrorState title="Could not load company documents" />;
  }
  const manage = can(ctx, "documents.manage", "all") || can(ctx, "policies.manage", "all");
  const target = { ownerType: "company" as const };

  return (
    <Reveal>
      <Section
        title="Company documents"
        description={manage ? "Shared with every employee unless marked HR only." : "Handbooks, forms and other documents shared by HR."}
        actions={manage ? <UploadDocumentDialog target={target} categories={DOCUMENT_CATEGORIES} manage /> : null}
      >
        {docs.length ? (
          <>
            <DocumentTable
              docs={docs}
              today={todayIn()}
              manage={canManageDocuments(ctx)}
              selfService={false}
              target={target}
              categories={DOCUMENT_CATEGORIES}
              showVisibility={manage}
            />
            <DocumentLegend showVisibility={manage} />
          </>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={Building2}
              title="No company documents"
              description={manage ? "Upload the employee handbook, holiday list or common forms to share them with everyone." : "HR has not shared any documents yet."}
              className="border-0"
            />
          </div>
        )}
      </Section>
    </Reveal>
  );
}
