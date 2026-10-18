import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { RequestContext } from "@/server/auth/context";
import {
  getActivity,
  getAssets,
  getChangeRequests,
  getCompensationHistory,
  getJobHistory,
  getPersonalSections,
  getSensitive,
  getSkillsAndQualifications,
  type EmployeeHeader,
} from "@/server/services/employees/queries";
import { EmptyState, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { stateName } from "@/lib/india";
import type { TabKey } from "./profile-tabs";
import { EmployeeDocuments } from "@/components/documents/employee-documents";
import {
  AddCompensationButton,
  AddressEditor,
  AssetActions,
  AssignAssetButton,
  ContactEditor,
  DeleteRowButton,
  DependentEditor,
  QualificationEditor,
  SensitiveEditor,
  SkillEditor,
} from "./section-editors";
import { deleteDependentAction, deleteEmergencyContactAction, deleteQualificationAction, removeSkillAction } from "../actions";

function Dl({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 truncate text-sm">{value || value === 0 ? value : <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export async function TabContent({ ctx, header, tab }: { ctx: RequestContext; header: EmployeeHeader; tab: TabKey }) {
  const { employee: e, access } = header;
  switch (tab) {
    case "overview":
      return <OverviewTab ctx={ctx} header={header} />;
    case "job":
      return <JobTab ctx={ctx} employeeId={e.id} />;
    case "personal":
      return <PersonalTab ctx={ctx} employeeId={e.id} canEdit={access.canEdit} />;
    case "compensation":
      return <CompensationTab ctx={ctx} employeeId={e.id} canEdit={access.canEditCompensation} joiningDate={e.joiningDate} exited={e.status === "exited"} />;
    case "statutory":
      return <StatutoryTab ctx={ctx} employeeId={e.id} canEdit={access.canEditSensitive} isSelf={access.isSelf} />;
    case "documents":
      return <EmployeeDocuments employeeId={e.id} />;
    case "skills":
      return <SkillsTab ctx={ctx} employeeId={e.id} canEdit={access.canEdit} />;
    case "assets":
      return <AssetsTab ctx={ctx} employeeId={e.id} canManage={access.canManageAssets} />;
    case "activity":
      return <ActivityTab ctx={ctx} employeeId={e.id} />;
    default:
      return null;
  }
}

async function OverviewTab({ ctx, header }: { ctx: RequestContext; header: EmployeeHeader }) {
  const { employee: e, access } = header;
  const requests = access.isSelf || access.canEditAll ? await getChangeRequests(ctx, e.id) : [];
  const probation = e.confirmationDate
    ? `Confirmed ${formatDate(e.confirmationDate)}`
    : e.probationEndDate
      ? `Until ${formatDate(e.probationEndDate)}`
      : "None";
  return (
    <div className="space-y-5">
      <Section title="Employment">
        <Dl
          items={[
            ["Designation", e.designation],
            ["Department", e.department],
            ["Reporting manager", e.managerId ? <Link className="hover:underline" href={`/employees/${e.managerId}`}>{e.managerName}</Link> : null],
            ["Direct reports", e.directReports],
            ["Location", e.location],
            ["Work mode", titleCase(e.workMode)],
            ["Employment type", titleCase(e.employmentType)],
            ["Worker type", titleCase(e.workerType)],
            ["Legal entity", e.legalEntity],
            ...(access.full
              ? ([
                  ["Grade", e.grade],
                  ["Cost center", e.costCenter],
                  ["Joining date", formatDate(e.joiningDate)],
                  ["Probation", probation],
                  ["Notice period", `${e.noticePeriodDays} days`],
                  ["Portal access", e.hasLogin ? "Signed up" : "Not invited"],
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />
      </Section>
      {access.full ? (
        <Section title="Personal and contact">
          <Dl
            items={[
              ["Work email", e.workEmail],
              ["Personal email", e.personalEmail],
              ["Mobile", e.phone],
              ["Date of birth", e.dateOfBirth ? formatDate(e.dateOfBirth) : null],
              ["Gender", e.gender ? titleCase(e.gender) : null],
              ["Marital status", e.maritalStatus ? titleCase(e.maritalStatus) : null],
              ["Nationality", e.nationality],
              ["Blood group", e.bloodGroup],
            ]}
          />
        </Section>
      ) : null}
      {requests.length ? (
        <Section title="Correction requests">
          <ul className="divide-y">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <StatusBadge status={r.status} />
                <span className="font-medium">{Object.keys(r.changes).map(titleCase).join(", ")}</span>
                <span className="text-muted-foreground">{r.reason}</span>
                <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                {r.reviewComment ? <p className="w-full text-xs text-muted-foreground">HR: {r.reviewComment}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

async function JobTab({ ctx, employeeId }: { ctx: RequestContext; employeeId: string }) {
  const rows = await getJobHistory(ctx, employeeId);
  return (
    <Section title="Employment history" description="Effective-dated. The top row is the latest assignment.">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Effective</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap tabular">
                  {formatDate(r.effectiveFrom)}
                  <span className="text-muted-foreground"> → {r.effectiveTo ? formatDate(r.effectiveTo) : "present"}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.changeType} tone={r.changeType === "promotion" ? "success" : "neutral"} />
                </TableCell>
                <TableCell>{r.designation ?? "—"}</TableCell>
                <TableCell>{r.department ?? "—"}</TableCell>
                <TableCell>{r.managerName ?? "—"}</TableCell>
                <TableCell>{r.location ?? "—"}</TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">{r.reason ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}

async function PersonalTab({ ctx, employeeId, canEdit }: { ctx: RequestContext; employeeId: string; canEdit: boolean }) {
  const { addresses, contacts, dependents } = await getPersonalSections(ctx, employeeId);
  const byType = (t: "current" | "permanent") => addresses.find((a) => a.type === t) ?? null;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {(["current", "permanent"] as const).map((type) => {
          const a = byType(type);
          return (
            <Section
              key={type}
              title={`${titleCase(type)} address`}
              actions={canEdit ? <AddressEditor employeeId={employeeId} type={type} value={a} /> : null}
            >
              <div className="p-5 text-sm">
                {a ? (
                  <address className="not-italic leading-relaxed">
                    {a.line1}
                    {a.line2 ? <>, {a.line2}</> : null}
                    <br />
                    {a.city}
                    {a.stateCode ? `, ${stateName(a.stateCode)}` : ""} {a.postalCode}
                  </address>
                ) : (
                  <span className="text-muted-foreground">Not provided</span>
                )}
              </div>
            </Section>
          );
        })}
      </div>
      <Section title="Emergency contacts" actions={canEdit ? <ContactEditor employeeId={employeeId} /> : null}>
        {contacts.length ? (
          <ul className="divide-y">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {c.name} {c.isPrimary ? <StatusBadge status="primary" tone="brand" className="ml-1" /> : null}
                  </p>
                  <p className="text-muted-foreground">
                    {titleCase(c.relationship)} · {c.phone}
                    {c.email ? ` · ${c.email}` : ""}
                  </p>
                </div>
                {canEdit ? (
                  <>
                    <ContactEditor employeeId={employeeId} value={c} />
                    <DeleteRowButton label={`Remove ${c.name}`} action={deleteEmergencyContactAction.bind(null, { employeeId, id: c.id })} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">No emergency contacts added.</p>
        )}
      </Section>
      <Section title="Dependents and nominees" actions={canEdit ? <DependentEditor employeeId={employeeId} /> : null}>
        {dependents.length ? (
          <ul className="divide-y">
            {dependents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{d.name}</p>
                  <p className="text-muted-foreground">
                    {titleCase(d.relationship)}
                    {d.dateOfBirth ? ` · Born ${formatDate(d.dateOfBirth)}` : ""}
                    {d.isNominee ? ` · Nominee ${d.nominationPercent ?? 0}%` : ""}
                  </p>
                </div>
                {canEdit ? (
                  <>
                    <DependentEditor employeeId={employeeId} value={d} />
                    <DeleteRowButton label={`Remove ${d.name}`} action={deleteDependentAction.bind(null, { employeeId, id: d.id })} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">No dependents added.</p>
        )}
      </Section>
    </div>
  );
}

async function CompensationTab({
  ctx,
  employeeId,
  canEdit,
  joiningDate,
  exited,
}: {
  ctx: RequestContext;
  employeeId: string;
  canEdit: boolean;
  joiningDate: string;
  exited: boolean;
}) {
  const rows = await getCompensationHistory(ctx, employeeId);
  const current = rows.find((r) => !r.effectiveTo) ?? rows[0];
  return (
    <div className="space-y-5">
      <Section
        title="Current compensation"
        description="Annual cost to company. Component breakdown and payslips live in Payroll."
        actions={canEdit && !exited ? <AddCompensationButton employeeId={employeeId} minDate={current?.effectiveFrom ?? joiningDate} /> : null}
      >
        {current ? (
          <div className="grid gap-6 p-5 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Annual CTC</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{formatMoney(current.annualCtc, current.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Monthly (CTC ÷ 12)</p>
              <p className="mt-1 text-lg font-medium tabular">{formatMoney(Math.round(current.annualCtc / 12), current.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Effective from</p>
              <p className="mt-1 text-lg font-medium">{formatDate(current.effectiveFrom)}</p>
            </div>
          </div>
        ) : (
          <EmptyState className="m-5" title="No compensation recorded" description={canEdit ? "Add the starting salary to use this employee in payroll." : undefined} />
        )}
      </Section>
      {rows.length > 1 ? (
        <Section title="History">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Effective</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Annual CTC</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const prev = rows[i + 1];
                const pct = prev ? (r.annualCtc - prev.annualCtc) / prev.annualCtc : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="tabular whitespace-nowrap">
                      {formatDate(r.effectiveFrom)}
                      <span className="text-muted-foreground"> → {r.effectiveTo ? formatDate(r.effectiveTo) : "present"}</span>
                    </TableCell>
                    <TableCell>
                      {titleCase(r.reason)}
                      {r.notes ? <span className="block text-xs text-muted-foreground">{r.notes}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular">{formatMoney(r.annualCtc, r.currency)}</TableCell>
                    <TableCell className={`text-right tabular ${pct && pct > 0 ? "text-success" : pct && pct < 0 ? "text-danger" : "text-muted-foreground"}`}>
                      {pct == null ? "—" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </div>
  );
}

async function StatutoryTab({ ctx, employeeId, canEdit, isSelf }: { ctx: RequestContext; employeeId: string; canEdit: boolean; isSelf: boolean }) {
  const s = await getSensitive(ctx, employeeId);
  return (
    <Section
      title="Statutory and bank details"
      description="Identity and account numbers are encrypted and shown masked. Changes are logged."
      actions={
        canEdit ? (
          <SensitiveEditor employeeId={employeeId} taxRegime={(s?.taxRegime as "old" | "new") ?? "new"} current={s} />
        ) : isSelf ? (
          <span className="text-xs text-muted-foreground">Use “Request correction” above to change these.</span>
        ) : null
      }
    >
      <Dl
        items={[
          ["PAN", s?.pan],
          ["Aadhaar", s?.aadhaar],
          ["Passport", s?.passport],
          ["UAN (PF)", s?.uan],
          ["ESIC number", s?.esicNumber],
          ["Tax regime", s ? titleCase(s.taxRegime) + " regime" : null],
          ["Bank account", s?.bankAccount],
          ["IFSC", s?.bankIfsc],
          ["Bank", s?.bankName],
          ["Account holder", s?.accountHolderName],
        ]}
      />
      <p className="flex items-center gap-1.5 border-t px-5 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> {s ? `Last updated ${formatDateTime(s.updatedAt)}` : "No statutory details recorded yet."}
      </p>
    </Section>
  );
}

async function SkillsTab({ ctx, employeeId, canEdit }: { ctx: RequestContext; employeeId: string; canEdit: boolean }) {
  const { qualifications, skills } = await getSkillsAndQualifications(ctx, employeeId);
  return (
    <div className="space-y-5">
      <Section title="Skills" actions={canEdit ? <SkillEditor employeeId={employeeId} /> : null}>
        {skills.length ? (
          <ul className="flex flex-wrap gap-2 p-5">
            {skills.map((s) => (
              <li key={s.skillId} className="inline-flex items-center gap-2 rounded-full border bg-background py-1 pr-1.5 pl-3 text-sm">
                {s.name}
                <span className="flex gap-0.5" aria-label={`Proficiency ${s.proficiency} of 5`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className={`size-1.5 rounded-full ${i < s.proficiency ? "bg-brand" : "bg-muted"}`} />
                  ))}
                </span>
                {canEdit ? <DeleteRowButton small label={`Remove ${s.name}`} action={removeSkillAction.bind(null, { employeeId, skillId: s.skillId })} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">No skills recorded.</p>
        )}
      </Section>
      <Section title="Education and certifications" actions={canEdit ? <QualificationEditor employeeId={employeeId} /> : null}>
        {qualifications.length ? (
          <ul className="divide-y">
            {qualifications.map((q) => (
              <li key={q.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {q.title}
                    {q.kind === "certification" ? <StatusBadge status="certification" tone="info" className="ml-2" /> : null}
                  </p>
                  <p className="text-muted-foreground">
                    {[q.institution, q.fieldOfStudy, q.startYear && q.endYear ? `${q.startYear}–${q.endYear}` : q.endYear, q.grade].filter(Boolean).join(" · ")}
                    {q.expiresOn ? ` · Expires ${formatDate(q.expiresOn)}` : ""}
                  </p>
                </div>
                {canEdit ? (
                  <>
                    <QualificationEditor employeeId={employeeId} value={q} />
                    <DeleteRowButton label={`Remove ${q.title}`} action={deleteQualificationAction.bind(null, { employeeId, id: q.id })} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">No qualifications recorded.</p>
        )}
      </Section>
    </div>
  );
}

async function AssetsTab({ ctx, employeeId, canManage }: { ctx: RequestContext; employeeId: string; canManage: boolean }) {
  const rows = await getAssets(ctx, employeeId);
  return (
    <Section title="Assigned assets" actions={canManage ? <AssignAssetButton employeeId={employeeId} /> : null}>
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Tag</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? <TableHead className="w-24" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.assignmentId}>
                <TableCell>
                  <span className="font-medium">{a.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {a.category}
                    {a.serialNumber ? ` · S/N ${a.serialNumber}` : ""}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{a.tag}</TableCell>
                <TableCell className="tabular">{formatDate(a.assignedOn)}</TableCell>
                <TableCell>
                  {a.returnedOn ? <StatusBadge status="returned" tone="neutral" label={`Returned ${formatDate(a.returnedOn)}`} /> : <StatusBadge status="assigned" tone="info" />}
                </TableCell>
                {canManage ? <TableCell>{!a.returnedOn ? <AssetActions assignmentId={a.assignmentId} /> : null}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground">No assets assigned.</p>
      )}
    </Section>
  );
}

async function ActivityTab({ ctx, employeeId }: { ctx: RequestContext; employeeId: string }) {
  const rows = await getActivity(ctx, employeeId);
  return (
    <Section title="Activity" description="Changes to this profile, newest first. Sensitive values are redacted.">
      {rows.length ? (
        <ol className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{titleCase(r.action.split(".").slice(1).join(" "))}</span>
                <span className="text-muted-foreground">by {r.actorName ?? r.actorEmail ?? "System"}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular">{formatDateTime(r.createdAt)}</span>
              </div>
              {r.changes ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {Object.entries(r.changes).map(([field, c]) => (
                    <li key={field}>
                      {titleCase(field.replace(/([A-Z])/g, "_$1").toLowerCase())}: {String(c.from ?? "—")} → {String(c.to ?? "—")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground">No activity yet.</p>
      )}
    </Section>
  );
}
