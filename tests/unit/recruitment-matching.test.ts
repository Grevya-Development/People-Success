import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { matchSkill, ruleBasedEmailDraft, ruleBasedMatch, ruleBasedParse, ruleBasedQuestions, scrubProtected, snippet } from "@/server/services/recruitment/matching";
import { extractDocxText, extractPdfText, extractResumeText, readability, textFromContentStream } from "@/server/services/recruitment/text-extract";
import { defaultSplit, isDefaultSplit } from "@/server/services/recruitment/compensation-split";
import { openingSchema, parseCriteria, publicApplicationSchema, requisitionSchema, slugify, istLocalToDate } from "@/lib/validation/recruitment";

const RESUME = `Asha Verma
Senior Backend Engineer at Acme Payments (2019 - present)
Date of Birth: 12/03/1991
Gender: Female
Marital Status: Married
7 years of professional experience building Node.js and TypeScript services.
Operated PostgreSQL in production and designed REST APIs.
B.Tech in Computer Science, IIT Madras 2014
AWS Certified Solutions Architect`;

describe("protected characteristics", () => {
  it("removes labelled personal details and inline signals", () => {
    const { text, removed } = scrubProtected(RESUME + "\nShe is 32 years old.");
    expect(text).not.toMatch(/1991|Female|Married|32 years old/);
    expect(text).toMatch(/Node\.js/);
    expect(removed).toBeGreaterThanOrEqual(4);
  });
  it("keeps job-related lines that merely start with similar words", () => {
    const { text } = scrubProtected("Agency relationships managed for 4 years\nHealthcare analytics platform");
    expect(text).toContain("Agency relationships");
    expect(text).toContain("Healthcare analytics");
  });
});

describe("rule-based skill matching", () => {
  it("matches skills with special characters and returns evidence", () => {
    const hit = matchSkill("Wrote C++ and C# code; shipped Node.js APIs", "Node.js");
    expect(hit.assessment).toBe("meets");
    expect(hit.evidence).toContain("Node.js");
    expect(matchSkill("Wrote C++ code", "C++").assessment).toBe("meets");
    expect(matchSkill("Wrote C code", "C++").assessment).toBe("not_evident");
    expect(matchSkill("Experienced with nodejs", "Node.js").assessment).toBe("meets");
  });
  it("does not match inside other words", () => {
    expect(matchSkill("Javascript developer", "Java").assessment).toBe("not_evident");
    expect(matchSkill("Gopher community", "Go").assessment).toBe("not_evident");
  });
  it("gives partial credit for multi-word skills", () => {
    const hit = matchSkill("Strong in data pipelines and analysis of metrics", "Data analysis");
    expect(hit.assessment).toBe("partially");
  });
  it("assesses only the stated skills and experience, with missing info", () => {
    const r = ruleBasedMatch(
      { resumeText: RESUME, skills: ["TypeScript", "PostgreSQL", "Kubernetes"], experienceMinYears: 5, experienceMaxYears: 10, totalExperienceMonths: 84, requiredAnswers: [{ label: "Notice period", answered: false }] },
      new Date("2026-10-18T00:00:00Z"),
    );
    expect(r.model).toBe("rule-based");
    expect(r.criteria.map((c) => [c.criterion, c.assessment])).toEqual([
      ["Skill: TypeScript", "meets"],
      ["Skill: PostgreSQL", "meets"],
      ["Skill: Kubernetes", "not_evident"],
      ["Experience: 5–10 years", "meets"],
    ]);
    expect(r.missingInformation).toEqual(["Evidence of Kubernetes", "Answer to “Notice period”"]);
    expect(r.summary).toMatch(/2 of 3/);
    expect(JSON.stringify(r)).not.toMatch(/Female|Married|1991/);
  });
  it("flags unknown experience and empty resumes", () => {
    const r = ruleBasedMatch({ resumeText: "", skills: ["Go"], experienceMinYears: 2, experienceMaxYears: null, totalExperienceMonths: null });
    expect(r.criteria[1]).toMatchObject({ criterion: "Experience: at least 2 years", assessment: "not_evident" });
    expect(r.missingInformation[0]).toMatch(/Resume text/);
  });
  it("builds bounded snippets", () => {
    const s = snippet("a".repeat(200) + "NEEDLE" + "b".repeat(200), 200, 6, 10);
    expect(s).toBe("…aaaaaaaaaaNEEDLEbbbbbbbbbb…");
  });
});

describe("rule-based parsing and drafts", () => {
  it("extracts skills, education, certifications and experience", () => {
    const p = ruleBasedParse(RESUME, ["PostgreSQL"]);
    expect(p.skills).toEqual(expect.arrayContaining(["PostgreSQL", "TypeScript", "Node.js", "REST", "AWS"]));
    expect(p.totalExperienceMonths).toBe(84);
    expect(p.education[0]).toMatchObject({ year: 2014 });
    expect(p.certifications[0]).toMatch(/AWS Certified/);
    expect(p.workHistory[0]).toMatchObject({ title: "Senior Backend Engineer", company: "Acme Payments", from: "2019", to: null });
    expect(p.meta?.warnings?.join(" ")).toMatch(/removed/);
  });
  it("writes job-related questions per skill and requirement", () => {
    const q = ruleBasedQuestions({ title: "Backend Engineer", skills: ["Go", "SQL"], requirements: "- Operate services on call\n- x" }, "Technical");
    expect(q.map((x) => x.criterion)).toEqual(["Skill: Go", "Skill: SQL", "Requirement: Operate services on call", "Role understanding"]);
    expect(JSON.stringify(q)).not.toMatch(/age|married|family/i);
  });
  it("drafts emails without inventing details", () => {
    const d = ruleBasedEmailDraft("rejection", { candidateFirstName: "Asha", jobTitle: "Backend Engineer", companyName: "Acme", senderName: "Riya" });
    expect(d.subject).toBe("Your application for Backend Engineer");
    expect(d.body).toMatch(/^Dear Asha,/);
    expect(d.body).toMatch(/Riya\nAcme$/);
  });
});

describe("resume text extraction", () => {
  it("reads text from a simple PDF", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage();
    page.drawText("Kubernetes and Terraform at scale (C++ too)", { x: 40, y: 700, size: 12, font });
    page.drawText("Second line: PostgreSQL", { x: 40, y: 680, size: 12, font });
    const text = extractPdfText(await doc.save());
    expect(text).toContain("Kubernetes and Terraform at scale (C++ too)");
    expect(text).toContain("PostgreSQL");
  });
  it("parses literal strings, escapes and TJ spacing", () => {
    const out = textFromContentStream("BT /F1 12 Tf 10 10 Td (Hello \\(world\\)) Tj 0 -14 Td [(Sp) -300 (aced)] TJ ET");
    expect(out.trim()).toBe("Hello (world)\nSp aced");
  });
  it("reads paragraphs from a DOCX", () => {
    const xml = Buffer.from('<w:document><w:body><w:p><w:r><w:t>Python &amp; SQL</w:t></w:r></w:p><w:p><w:r><w:t>Five years</w:t></w:r></w:p></w:body></w:document>');
    const docx = zip([
      ["[Content_Types].xml", Buffer.from("<Types/>")],
      ["word/document.xml", xml],
    ]);
    expect(extractDocxText(docx)).toBe("Python & SQL\nFive years");
    expect(extractResumeText(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document").text).toBeNull(); // too short to trust
  });
  it("rejects garbled output", () => {
    expect(readability("Ã¿Ã¿\u0001\u0002ÿþ")).toBeLessThan(0.5);
    expect(extractResumeText(new TextEncoder().encode("%PDF-1.4 nothing here"), "application/pdf").warning).toMatch(/Paste the resume text/);
  });
});

describe("validation helpers", () => {
  it("parses scorecard criteria with unique keys", () => {
    expect(parseCriteria("Communication: clear\nCommunication\n\nOwnership")).toEqual([
      { key: "communication", label: "Communication", description: "clear" },
      { key: "communication_2", label: "Communication" },
      { key: "ownership", label: "Ownership" },
    ]);
  });
  it("slugifies titles", () => expect(slugify("Sr. Backend Engineer (Payments) — Bengaluru")).toBe("sr-backend-engineer-payments-bengaluru"));
  it("treats datetime-local input as IST", () => expect(istLocalToDate("2026-10-20T10:00").toISOString()).toBe("2026-10-20T04:30:00.000Z"));
  it("validates requisition budgets and backfills", () => {
    const base = { title: "Engineer", headcount: 1, employmentType: "full_time", reason: "backfill", justification: "Replacing a departing engineer on the team." };
    expect(requisitionSchema.safeParse(base).success).toBe(false);
    expect(requisitionSchema.safeParse({ ...base, reason: "new", budgetMinAnnual: "20,00,000", budgetMaxAnnual: "10" }).success).toBe(false);
    expect(requisitionSchema.parse({ ...base, reason: "new", budgetMinAnnual: "1000000", budgetMaxAnnual: "" })).toMatchObject({ budgetMinAnnual: 1_000_000, budgetMaxAnnual: null });
  });
  it("normalises opening skills and requires a salary to show it", () => {
    const base = { title: "Engineer", description: "Builds the core platform services.", workMode: "remote", employmentType: "full_time", openings: 1, questions: [], showSalary: false };
    expect(openingSchema.parse({ ...base, skills: " Go, go , SQL,," }).skills).toEqual(["Go", "go", "SQL"]);
    expect(openingSchema.safeParse({ ...base, skills: "", showSalary: true }).success).toBe(false);
  });
  it("requires explicit consent on applications", () => {
    const base = { tenantSlug: "acme", jobSlug: "eng", firstName: "A", email: "A@Example.com" };
    expect(publicApplicationSchema.safeParse(base).success).toBe(false);
    expect(publicApplicationSchema.parse({ ...base, consent: true }).email).toBe("a@example.com");
  });
});

describe("default compensation split", () => {
  it("balances exactly to CTC", () => {
    const c = defaultSplit(1_234_567_89);
    expect(c.map((x) => x.code)).toEqual(["BASIC", "HRA", "SPECIAL"]);
    expect(c.reduce((s, x) => s + x.annualAmount, 0)).toBe(1_234_567_89);
    expect(isDefaultSplit(c)).toBe(true);
  });
});

/** Minimal stored (method 8) zip writer for tests. */
function zip(entries: [string, Buffer][]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
