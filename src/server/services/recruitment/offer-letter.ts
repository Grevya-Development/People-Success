import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import {
  candidates,
  departments,
  designations,
  documentTemplates,
  documentTemplateVersions,
  employees,
  jobOpenings,
  legalEntities,
  locations,
  offers,
  tenants,
} from "../../db/schema";
import { PdfBuilder, formatInr } from "../../pdf/builder";
import { storeGeneratedPdf } from "../../pdf/store";
import { resolvePlaceholders } from "../documents/render";
import { formatDate } from "@/lib/format";
import { isDefaultSplit } from "./compensation";
import { fullName } from "./shared";

type Offer = typeof offers.$inferSelect;

export type OfferLetterData = {
  companyName: string;
  legalName: string;
  address: string;
  candidateName: string;
  candidateFirstName: string;
  designation: string;
  department: string;
  location: string;
  manager: string;
  openingTitle: string;
};

export async function offerLetterData(tx: Tx, o: Offer): Promise<OfferLetterData> {
  const [[c], [t], [le], [des], [dep], [loc], [mgr], [op]] = await Promise.all([
    tx.select().from(candidates).where(and(eq(candidates.id, o.candidateId), eq(candidates.tenantId, o.tenantId))),
    tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, o.tenantId)),
    tx.select().from(legalEntities).where(and(eq(legalEntities.id, o.legalEntityId), eq(legalEntities.tenantId, o.tenantId))),
    o.designationId ? tx.select({ v: designations.title }).from(designations).where(and(eq(designations.id, o.designationId), eq(designations.tenantId, o.tenantId))) : Promise.resolve([]),
    o.departmentId ? tx.select({ v: departments.name }).from(departments).where(and(eq(departments.id, o.departmentId), eq(departments.tenantId, o.tenantId))) : Promise.resolve([]),
    o.locationId ? tx.select({ v: locations.name }).from(locations).where(and(eq(locations.id, o.locationId), eq(locations.tenantId, o.tenantId))) : Promise.resolve([]),
    o.reportingManagerId ? tx.select({ v: employees.displayName }).from(employees).where(and(eq(employees.id, o.reportingManagerId), eq(employees.tenantId, o.tenantId))) : Promise.resolve([]),
    tx.select({ v: jobOpenings.title }).from(jobOpenings).where(and(eq(jobOpenings.id, o.openingId), eq(jobOpenings.tenantId, o.tenantId))),
  ]);
  const a = le?.address ?? {};
  return {
    companyName: le?.name ?? t?.name ?? "Company",
    legalName: le?.legalName ?? le?.name ?? t?.name ?? "Company",
    address: [a.line1, a.line2, a.city, a.postalCode].filter(Boolean).join(", "),
    candidateName: c ? fullName(c) : "Candidate",
    candidateFirstName: c?.firstName ?? "Candidate",
    designation: (des as { v: string } | undefined)?.v ?? op?.v ?? "the role",
    department: (dep as { v: string } | undefined)?.v ?? "",
    location: (loc as { v: string } | undefined)?.v ?? "",
    manager: (mgr as { v: string } | undefined)?.v ?? "",
    openingTitle: op?.v ?? "",
  };
}

/** Render "markdown-ish" template text (headings, bullets, bold) into the PDF. */
function renderBody(pdf: PdfBuilder, body: string) {
  for (const block of body.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const text = block.trim();
    if (!text) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(text);
    if (heading) {
      pdf.spacer(4).text(heading[1].replace(/\*\*/g, ""), { size: 11, bold: true, gap: 4 });
      continue;
    }
    const lines = text.split("\n").map((l) => l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*[-*]\s+/, "- "));
    pdf.text(lines.join("\n"), { size: 10, gap: 8 });
  }
}

/**
 * Generate the offer letter PDF: the tenant's active "offer_letter" template
 * when one exists (placeholders resolved server-side), otherwise a built-in
 * letter. A compensation annexure is always attached. Stored privately
 * (ownerType "offer"), never visible in employee self-service.
 */
export async function generateOfferLetter(tx: Tx, o: Offer, actorUserId: string | null) {
  const d = await offerLetterData(tx, o);
  const [tpl] = await tx
    .select({ t: documentTemplates, v: documentTemplateVersions })
    .from(documentTemplates)
    .innerJoin(documentTemplateVersions, and(eq(documentTemplateVersions.templateId, documentTemplates.id), eq(documentTemplateVersions.version, documentTemplates.currentVersion)))
    .where(and(eq(documentTemplates.tenantId, o.tenantId), eq(documentTemplates.kind, "offer_letter"), eq(documentTemplates.isActive, true)))
    .orderBy(desc(documentTemplates.updatedAt))
    .limit(1);

  const pdf = await PdfBuilder.create({ title: `Offer letter – ${d.candidateName}`, author: d.legalName, footer: `${d.legalName} · Offer v${o.version} · Confidential` });
  pdf.letterhead({ name: d.companyName, legalName: d.legalName, addressLine: d.address || null }, "Offer of employment", `Reference ${o.id.slice(0, 8).toUpperCase()} · version ${o.version}`);

  const ctc = formatInr(o.annualCtc);
  if (tpl) {
    const data = {
      today: formatDate(new Date()),
      company: { name: d.companyName, legalName: d.legalName, address: d.address },
      employee: {
        fullName: d.candidateName,
        firstName: d.candidateFirstName,
        designation: d.designation,
        department: d.department,
        location: d.location,
        joiningDate: formatDate(o.joiningDate),
        manager: d.manager,
      },
      candidate: { fullName: d.candidateName, firstName: d.candidateFirstName },
      offer: {
        annualCtc: ctc,
        validUntil: formatDate(o.expiresOn),
        probationMonths: String(o.probationMonths),
        noticePeriodDays: String(o.noticePeriodDays),
        version: String(o.version),
      },
      signatory: { name: "", designation: "" },
    };
    renderBody(pdf, resolvePlaceholders(tpl.v.body, data, { escape: false }).output);
  } else {
    pdf.text(formatDate(new Date()), { gap: 8 });
    pdf.text(`Dear ${d.candidateName},`, { gap: 8 });
    pdf.text(
      `We are pleased to offer you the position of ${d.designation}${d.department ? ` in the ${d.department} team` : ""} at ${d.legalName}${d.location ? `, based at ${d.location}` : ""}.`,
      { gap: 8 },
    );
    pdf.grid(
      [
        ["Designation", d.designation],
        ["Department", d.department || "-"],
        ["Location", d.location || "-"],
        ["Reporting to", d.manager || "-"],
        ["Date of joining", formatDate(o.joiningDate)],
        ["Annual CTC", ctc],
        ["Probation", o.probationMonths ? `${o.probationMonths} months` : "None"],
        ["Notice period", `${o.noticePeriodDays} days`],
      ],
      2,
    );
    pdf.text(
      "This offer is subject to satisfactory verification of your documents and background. Detailed terms of employment will be set out in your appointment letter.",
      { gap: 8 },
    );
    pdf.text(`Please respond to this offer by ${formatDate(o.expiresOn)} using the secure link in your email.`, { gap: 8 });
    pdf.text(`We look forward to welcoming you.\n\nFor ${d.legalName}`, { gap: 8 });
  }

  pdf.spacer(10).text("Annexure: annual compensation", { size: 11, bold: true, gap: 4 });
  const total = o.components.reduce((s, c) => s + c.annualAmount, 0);
  pdf.table(
    [
      { header: "Component", width: 0.55 },
      { header: "Monthly", width: 0.2, align: "right" },
      { header: "Annual", width: 0.25, align: "right" },
    ],
    o.components.map((c) => [c.name, formatInr(Math.round(c.annualAmount / 12)), formatInr(c.annualAmount)]),
    { totals: ["Total (cost to company)", formatInr(Math.round(total / 12)), formatInr(total)] },
  );
  if (isDefaultSplit(o.components)) pdf.text("Indicative split: Basic 50% and HRA 20% of CTC, with a special allowance making up the balance.", { size: 8.5 });
  pdf.text("Statutory deductions and employer contributions are computed by payroll as per applicable law.", { size: 8.5, gap: 8 });
  pdf.text("This letter is accepted electronically by click-through on the secure offer page. No electronic signature is applied.", { size: 8.5 });

  const bytes = await pdf.toBytes();
  const doc = await storeGeneratedPdf(tx, {
    tenantId: o.tenantId,
    bytes,
    ownerType: "offer",
    ownerId: o.id,
    category: "offer_letter",
    title: `Offer letter – ${d.candidateName} (v${o.version})`,
    fileName: `Offer-${d.candidateName.replace(/[^A-Za-z0-9]+/g, "-")}-v${o.version}.pdf`,
    employeeVisible: false,
    isSensitive: true,
    createdBy: actorUserId,
    supersedesId: o.documentId,
  });
  await tx.update(offers).set({ documentId: doc.id, templateVersionId: tpl?.v.id ?? null }).where(eq(offers.id, o.id));
  return { documentId: doc.id, templateVersionId: tpl?.v.id ?? null };
}
