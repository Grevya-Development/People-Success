import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { departments, designations, documentTemplates, documentTemplateVersions, employees, legalEntities } from "../../db/schema";
import { PdfBuilder } from "../../pdf/builder";
import { resolvePlaceholders } from "../documents/render";
import { STANDARD_TEMPLATES } from "../documents/templates";
import { formatDate, todayIn } from "@/lib/format";

export type LetterKind = "experience" | "relieving";

const TEMPLATE_KIND = { experience: "experience_letter", relieving: "relieving_letter" } as const;
export const LETTER_TITLES: Record<LetterKind, string> = { experience: "Experience letter", relieving: "Relieving letter" };

/** The tenant's active template of this kind (latest), else the bundled standard body. */
async function letterBody(tx: Tx, kind: LetterKind) {
  const [t] = await tx
    .select({ id: documentTemplates.id, version: documentTemplates.currentVersion, name: documentTemplates.name })
    .from(documentTemplates)
    .where(and(eq(documentTemplates.kind, TEMPLATE_KIND[kind]), eq(documentTemplates.isActive, true)))
    .orderBy(desc(documentTemplates.updatedAt))
    .limit(1);
  if (t) {
    const [v] = await tx
      .select({ body: documentTemplateVersions.body, subject: documentTemplateVersions.subject })
      .from(documentTemplateVersions)
      .where(and(eq(documentTemplateVersions.templateId, t.id), eq(documentTemplateVersions.version, t.version)));
    if (v) return { body: v.body, subject: v.subject, source: { templateId: t.id, version: t.version } };
  }
  const std = STANDARD_TEMPLATES.find((s) => s.kind === TEMPLATE_KIND[kind])!;
  return { body: std.body, subject: std.subject ?? null, source: null };
}

/** Render a letter for an employee as PDF bytes. Placeholders resolve server-side from the employee master. */
export async function renderExitLetter(
  tx: Tx,
  kind: LetterKind,
  input: { employeeId: string; lastWorkingDate: string; signatory: { name: string; designation: string } },
) {
  const [e] = await tx
    .select({
      id: employees.id,
      displayName: employees.displayName,
      firstName: employees.firstName,
      code: employees.employeeCode,
      joiningDate: employees.joiningDate,
      legalEntityId: employees.legalEntityId,
      designation: designations.title,
      department: departments.name,
    })
    .from(employees)
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, input.employeeId));
  const [le] = await tx
    .select({ name: legalEntities.name, legalName: legalEntities.legalName, address: legalEntities.address })
    .from(legalEntities)
    .where(eq(legalEntities.id, e.legalEntityId));
  const addressLine = le?.address
    ? [le.address.line1, le.address.line2, le.address.city, le.address.postalCode].filter(Boolean).join(", ")
    : null;
  const data = {
    today: formatDate(todayIn()),
    company: { name: le?.name ?? "", legalName: le?.legalName ?? le?.name ?? "", address: addressLine ?? "" },
    employee: {
      fullName: e.displayName,
      firstName: e.firstName,
      employeeCode: e.code,
      designation: e.designation ?? "",
      department: e.department ?? "",
      joiningDate: formatDate(e.joiningDate),
      lastWorkingDate: formatDate(input.lastWorkingDate),
    },
    signatory: input.signatory,
  };
  const tpl = await letterBody(tx, kind);
  // Plain text output: PDF text is drawn literally, so no HTML escaping.
  const body = resolvePlaceholders(tpl.body, data, { escape: false });
  const subject = tpl.subject ? resolvePlaceholders(tpl.subject, data, { escape: false }).output : LETTER_TITLES[kind];

  const pdf = await PdfBuilder.create({ title: subject, author: le?.legalName ?? undefined, footer: `${le?.legalName ?? ""} · ${e.code}` });
  pdf.letterhead({ name: le?.name ?? "", legalName: le?.legalName, addressLine }, subject);
  for (const block of body.output.split(/\n{2,}/)) {
    const text = block.trim();
    if (!text) continue;
    if (text.startsWith("## ")) {
      pdf.text(text.slice(3).replace(/\*\*/g, ""), { size: 11.5, bold: true, gap: 6 });
      continue;
    }
    pdf.text(text.replace(/\*\*/g, "").replace(/^- /gm, "• "), { size: 10.5, gap: 8 });
  }
  const bytes = await pdf.toBytes();
  return { bytes, subject, missing: body.missing, source: tpl.source, employeeCode: e.code };
}
