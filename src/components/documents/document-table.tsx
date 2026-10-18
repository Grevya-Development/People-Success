import { BadgeCheck, EyeOff, Lock, ShieldAlert } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/lib/validation/documents";
import type { DocumentSummary } from "@/server/services/documents/documents";
import { DocumentRowActions } from "./document-row-actions";
import type { UploadTarget } from "./upload-document-dialog";
import { expiryState, fileKind, formatBytes } from "./format";

type Props = {
  docs: DocumentSummary[];
  today: string;
  manage: boolean;
  /** Self-service uploaders may replace documents they uploaded themselves. */
  selfService: boolean;
  target: UploadTarget;
  categories: readonly DocumentCategory[];
  /** Show the "HR only" marker (only meaningful to HR). */
  showVisibility: boolean;
};

export function DocumentTable({ docs, today, manage, selfService, target, categories, showVisibility }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">Document</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Expiry</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead className="pr-5 text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.map((d) => {
          const expiry = expiryState(d.expiresOn, today);
          return (
            <TableRow key={d.id}>
              <TableCell className="max-w-[18rem] pl-5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium" title={d.title}>
                    {d.title}
                  </span>
                  {d.isSensitive ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Sensitive" /> : null}
                  {showVisibility && !d.employeeVisible ? (
                    <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="HR only" />
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground" title={d.fileName}>
                  {fileKind(d.mimeType)} · v{d.version}
                  {d.version > 1 ? " (latest)" : ""}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">{DOCUMENT_CATEGORY_LABELS[d.category]}</TableCell>
              <TableCell className="tabular text-right whitespace-nowrap text-muted-foreground">{formatBytes(d.sizeBytes)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {d.expiresOn ? (
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="tabular">{formatDate(d.expiresOn)}</span>
                    {expiry && expiry.tone !== "neutral" ? <StatusBadge status="expiry" tone={expiry.tone} label={expiry.label} className="normal-case" /> : null}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {d.verifiedAt ? (
                    <StatusBadge status="verified" tone="success" label="Verified" />
                  ) : (
                    <StatusBadge status="unverified" tone="neutral" label="Not verified" className="normal-case" />
                  )}
                  {d.legalHold ? <StatusBadge status="hold" tone="warning" label="Legal hold" /> : null}
                  {d.scanStatus === "error" && manage ? <StatusBadge status="scan" tone="warning" label="Scan failed" /> : null}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <div className="tabular">{formatDate(d.uploadedAt)}</div>
                {d.uploadedByName ? <div className="max-w-40 truncate text-xs text-muted-foreground">{d.uploadedByName}</div> : null}
              </TableCell>
              <TableCell className="pr-5">
                <DocumentRowActions
                  doc={{ id: d.id, title: d.title, category: d.category, verifiedAt: d.verifiedAt, legalHold: d.legalHold, retainUntil: d.retainUntil }}
                  manage={manage}
                  canReplace={manage || (selfService && d.uploadedBySelf)}
                  target={target}
                  categories={categories}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function DocumentLegend({ showVisibility }: { showVisibility: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-2.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Lock className="size-3" aria-hidden /> Sensitive
      </span>
      {showVisibility ? (
        <span className="inline-flex items-center gap-1">
          <EyeOff className="size-3" aria-hidden /> HR only
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        <BadgeCheck className="size-3" aria-hidden /> Verified by HR
      </span>
      <span className="inline-flex items-center gap-1">
        <ShieldAlert className="size-3" aria-hidden /> Downloads are logged
      </span>
    </p>
  );
}
