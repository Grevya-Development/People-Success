import { z } from "zod";

export const createOrganizationInput = z.object({
  name: z.string().trim().min(2, "Enter your organization name").max(120),
  legalName: z.string().trim().min(2, "Enter the registered legal name").max(200),
  stateCode: z.string().trim().length(2, "Choose a state").toUpperCase(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  timezone: z.string().min(1),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationInput>;
