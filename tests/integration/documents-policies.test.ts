import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { employees, legalEntities, notifications, policyAcknowledgements } from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import {
  acknowledgePolicy,
  archivePolicy,
  createPolicy,
  deleteDraftPolicy,
  getPolicy,
  listPolicies,
  pendingAcknowledgements,
  publishPolicy,
  updatePolicy,
} from "@/server/services/documents/policies";
import {
  createTemplate,
  getTemplate,
  installStandardTemplates,
  listTemplates,
  renderTemplate,
  setTemplateActive,
  updateTemplate,
} from "@/server/services/documents/templates";
import { resolvePlaceholders } from "@/server/services/documents/render";
import { extractPlaceholders, policySchema } from "@/lib/validation/documents";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

type Tenant = Awaited<ReturnType<typeof createOwnedTenant>>;

async function createEmployee(tenantId: string, code: string, name: string, status: "active" | "exited" = "active") {
  const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, tenantId));
  const [e] = await db
    .insert(employees)
    .values({ tenantId, legalEntityId: le.id, employeeCode: code, firstName: name, displayName: name, joiningDate: "2025-04-01", status })
    .returning();
  return e.id;
}

const policyInput = (over: Partial<Parameters<typeof policySchema.parse>[0]> = {}) =>
  policySchema.parse({
    title: "Code of conduct",
    category: "code_of_conduct",
    summary: "How we work together",
    body: "# Code of conduct\n\nBe kind and respectful.\n\n- Treat colleagues fairly\n- Report concerns",
    effectiveFrom: "2026-04-01",
    requiresAcknowledgement: true,
    documentId: null,
    ...over,
  });

describe("policies and acknowledgements", () => {
  let t: Tenant;
  let hr: RequestContext;
  let alice: RequestContext;
  let aliceEmp: string;
  let bobEmp: string;

  beforeAll(async () => {
    t = await createOwnedTenant();
    aliceEmp = await createEmployee(t.tenant.id, "E1", "Alice");
    bobEmp = await createEmployee(t.tenant.id, "E2", "Bob");
    await createEmployee(t.tenant.id, "E3", "Exited Ed", "exited");
    const hrUser = await addMember(t.tenant.id, ["hr_admin"]);
    const aUser = await addMember(t.tenant.id, ["employee"], { employeeId: aliceEmp });
    await addMember(t.tenant.id, ["employee"], { employeeId: bobEmp });
    hr = await contextFor(t.tenant.id, hrUser.user.id);
    alice = await contextFor(t.tenant.id, aUser.user.id);
  });

  it("publishes, acknowledges idempotently and reports coverage", async () => {
    await expect(createPolicy(alice, policyInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id } = await createPolicy(hr, policyInput());

    // Drafts are invisible to employees.
    expect((await listPolicies(alice)).map((p) => p.id)).not.toContain(id);
    await expect(getPolicy(alice, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(acknowledgePolicy(alice, id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await publishPolicy(hr, id);
    const notes = await db.select().from(notifications).where(eq(notifications.tenantId, t.tenant.id));
    expect(notes.filter((n) => n.href === `/documents/policies/${id}`)).toHaveLength(2);

    const visible = await getPolicy(alice, id);
    expect(visible.canAcknowledge).toBe(true);

    const first = await acknowledgePolicy(alice, id, { ip: "198.51.100.4" });
    const second = await acknowledgePolicy(alice, id);
    expect(first.alreadyAcknowledged).toBe(false);
    expect(second.alreadyAcknowledged).toBe(true);
    const acks = await db.select().from(policyAcknowledgements).where(eq(policyAcknowledgements.policyId, id));
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ employeeId: aliceEmp, policyVersion: 1, ip: "198.51.100.4" });

    const mine = (await listPolicies(alice)).find((p) => p.id === id)!;
    expect(mine.myAcknowledgedAt).toBeTruthy();
    expect(mine.coverage).toBeNull();

    const managed = (await listPolicies(hr)).find((p) => p.id === id)!;
    // Exited employees are excluded from the denominator.
    expect(managed.coverage).toEqual({ acknowledged: 1, total: 2 });
    const pending = await pendingAcknowledgements(hr, id);
    expect(pending.map((p) => p.employeeId)).toEqual([bobEmp]);
    await expect(pendingAcknowledgements(alice, id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Editing the content of a published policy publishes a new version.
    const edited = await updatePolicy(hr, { id, ...policyInput({ body: "# Code of conduct\n\nUpdated text for 2027." }) });
    expect(edited).toMatchObject({ version: 2, republished: true });
    const after = await getPolicy(alice, id);
    expect(after.version).toBe(2);
    expect(after.myAcknowledgedAt).toBeNull();
    expect(after.canAcknowledge).toBe(true);
    expect((await getPolicy(hr, id)).coverage).toEqual({ acknowledged: 0, total: 2 });

    // A metadata-only edit does not bump the version.
    const meta = await updatePolicy(hr, { id, ...policyInput({ body: "# Code of conduct\n\nUpdated text for 2027.", summary: "New summary" }) });
    expect(meta).toMatchObject({ version: 2, republished: false });

    await archivePolicy(hr, id);
    expect((await listPolicies(alice)).map((p) => p.id)).not.toContain(id);
    await expect(updatePolicy(hr, { id, ...policyInput() })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("only deletes never-published drafts", async () => {
    const { id } = await createPolicy(hr, policyInput({ title: "Travel policy", requiresAcknowledgement: false }));
    await publishPolicy(hr, id);
    await expect(deleteDraftPolicy(hr, id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(acknowledgePolicy(alice, id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const draft = await createPolicy(hr, policyInput({ title: "Draft only" }));
    await deleteDraftPolicy(hr, draft.id);
    await expect(getPolicy(hr, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("document templates", () => {
  let t: Tenant;
  let hr: RequestContext;
  let employee: RequestContext;

  beforeAll(async () => {
    t = await createOwnedTenant();
    const hrUser = await addMember(t.tenant.id, ["hr_manager"]);
    const empId = await createEmployee(t.tenant.id, "E1", "Asha");
    const eUser = await addMember(t.tenant.id, ["employee"], { employeeId: empId });
    hr = await contextFor(t.tenant.id, hrUser.user.id);
    employee = await contextFor(t.tenant.id, eUser.user.id);
  });

  it("detects placeholders, versions bodies and renders with escaping", async () => {
    expect(extractPlaceholders("Hi {{ employee.fullName }} of {{company.legalName}} {{employee.fullName}} {{bad-one}}")).toEqual([
      "employee.fullName",
      "company.legalName",
    ]);

    await expect(
      createTemplate(employee, { kind: "other", name: "Nope", description: null, subject: null, body: "Hello {{today}} there" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { id } = await createTemplate(hr, {
      kind: "confirmation_letter",
      name: "Confirmation",
      description: "Probation confirmation",
      subject: "Confirmation for {{employee.fullName}}",
      body: "Dear {{employee.fullName}}, you are confirmed as {{employee.designation}} on {{today}}.",
    });
    let detail = await getTemplate(hr, id);
    expect(detail.currentVersion).toBe(1);
    expect(detail.placeholders).toEqual(["employee.fullName", "employee.designation", "today"]);

    const rendered = await renderTemplate(hr, id, { employee: { fullName: "<b>Asha</b> & co" }, today: "18 Oct 2026" });
    expect(rendered.output).toBe("Dear &lt;b&gt;Asha&lt;/b&gt; &amp; co, you are confirmed as [[employee.designation]] on 18 Oct 2026.");
    expect(rendered.subject).toBe("Confirmation for &lt;b&gt;Asha&lt;/b&gt; &amp; co");
    expect(rendered.missing).toEqual(["employee.designation"]);
    expect(resolvePlaceholders("{{constructor.name}}", {}).missing).toEqual(["constructor.name"]);

    const same = await updateTemplate(hr, { id, kind: "confirmation_letter", name: "Confirmation letter", description: null, subject: detail.subject, body: detail.body });
    expect(same).toMatchObject({ version: 1, newVersion: false });
    const changed = await updateTemplate(hr, {
      id,
      kind: "confirmation_letter",
      name: "Confirmation letter",
      description: null,
      subject: detail.subject,
      body: "Dear {{employee.firstName}}, welcome aboard permanently.",
    });
    expect(changed).toMatchObject({ version: 2, newVersion: true });
    detail = await getTemplate(hr, id);
    expect(detail.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(detail.placeholders).toEqual(["employee.fullName", "employee.firstName"]);
    const v1 = await renderTemplate(hr, id, { employee: { fullName: "Asha", designation: "Engineer" }, today: "x" }, { version: 1 });
    expect(v1.missing).toEqual([]);

    await setTemplateActive(hr, { id, isActive: false });
    expect((await listTemplates(hr)).find((x) => x.id === id)?.isActive).toBe(false);
  });

  it("installs standard templates idempotently", async () => {
    const first = await installStandardTemplates(hr);
    const second = await installStandardTemplates(hr);
    expect(first.added).toBe(3);
    expect(second.added).toBe(0);
    const names = (await listTemplates(hr)).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["Offer letter (standard)", "Experience letter (standard)", "Relieving letter (standard)"]));
    await expect(installStandardTemplates(employee)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
