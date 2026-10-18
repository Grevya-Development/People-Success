"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction, zodFieldErrors } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import { requestMeta } from "@/server/auth/context";
import {
  documentIdSchema,
  policyIdSchema,
  policySchema,
  retentionSchema,
  templateActiveSchema,
  createTemplateSchema,
  updatePolicySchema,
  updateTemplateSchema,
  uploadDocumentSchema,
} from "@/lib/validation/documents";
import { deleteDocument, updateRetention, uploadDocument, verifyDocument } from "@/server/services/documents/documents";
import {
  acknowledgePolicy,
  archivePolicy,
  createPolicy,
  deleteDraftPolicy,
  publishPolicy,
  updatePolicy,
} from "@/server/services/documents/policies";
import {
  createTemplate,
  installStandardTemplates,
  setTemplateActive,
  updateTemplate,
} from "@/server/services/documents/templates";

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export const uploadDocumentAction = defineAction(
  { input: z.instanceof(FormData, { message: "Invalid upload" }) },
  async (ctx, form) => {
    const fields: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
    const parsed = uploadDocumentSchema.safeParse(fields);
    if (!parsed.success) {
      throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: zodFieldErrors(parsed.error) });
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Choose a file to upload.", { fieldErrors: { file: ["Choose a file"] } });
    const result = await uploadDocument(ctx, { ...parsed.data, file }, { meta: await requestMeta() });
    refresh();
    return result;
  },
);

export const verifyDocumentAction = defineAction(
  { input: documentIdSchema, permission: "documents.manage", scope: "all" },
  async (ctx, { id }) => {
    const r = await verifyDocument(ctx, id);
    refresh();
    return r;
  },
);

export const deleteDocumentAction = defineAction(
  { input: documentIdSchema, permission: "documents.manage", scope: "all" },
  async (ctx, { id }) => {
    const r = await deleteDocument(ctx, id);
    refresh();
    return r;
  },
);

export const updateRetentionAction = defineAction(
  { input: retentionSchema, permission: "documents.manage", scope: "all" },
  async (ctx, input) => {
    const r = await updateRetention(ctx, input);
    refresh();
    return r;
  },
);

/* ------------------------------------------------------------------ */
/* Policies                                                            */
/* ------------------------------------------------------------------ */

export const createPolicyAction = defineAction(
  { input: policySchema, permission: "policies.manage", scope: "all" },
  async (ctx, input) => createPolicy(ctx, input),
);

export const updatePolicyAction = defineAction(
  { input: updatePolicySchema, permission: "policies.manage", scope: "all" },
  async (ctx, input) => {
    const r = await updatePolicy(ctx, input);
    refresh();
    return r;
  },
);

export const publishPolicyAction = defineAction(
  { input: policyIdSchema, permission: "policies.manage", scope: "all" },
  async (ctx, { id }) => {
    const r = await publishPolicy(ctx, id);
    refresh();
    return r;
  },
);

export const archivePolicyAction = defineAction(
  { input: policyIdSchema, permission: "policies.manage", scope: "all" },
  async (ctx, { id }) => {
    const r = await archivePolicy(ctx, id);
    refresh();
    return r;
  },
);

export const deletePolicyAction = defineAction(
  { input: policyIdSchema, permission: "policies.manage", scope: "all" },
  async (ctx, { id }) => deleteDraftPolicy(ctx, id),
);

export const acknowledgePolicyAction = defineAction({ input: policyIdSchema }, async (ctx, { id }) => {
  const meta = await requestMeta();
  const r = await acknowledgePolicy(ctx, id, { ip: meta.ip });
  refresh();
  return r;
});

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const createTemplateAction = defineAction(
  { input: createTemplateSchema, permission: "templates.manage", scope: "all" },
  async (ctx, input) => createTemplate(ctx, input),
);

export const updateTemplateAction = defineAction(
  { input: updateTemplateSchema, permission: "templates.manage", scope: "all" },
  async (ctx, input) => {
    const r = await updateTemplate(ctx, input);
    refresh();
    return r;
  },
);

export const setTemplateActiveAction = defineAction(
  { input: templateActiveSchema, permission: "templates.manage", scope: "all" },
  async (ctx, input) => {
    const r = await setTemplateActive(ctx, input);
    refresh();
    return r;
  },
);

export const installStandardTemplatesAction = defineAction(
  { input: z.object({}), permission: "templates.manage", scope: "all" },
  async (ctx) => {
    const r = await installStandardTemplates(ctx);
    refresh();
    return r;
  },
);
