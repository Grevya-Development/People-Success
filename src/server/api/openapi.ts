import { z } from "zod";
import { createEmployeeSchema, employeeListSchema } from "@/lib/validation/employees";

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });

const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string", enum: ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "CONFLICT", "INVALID_STATE", "RATE_LIMITED", "PRECONDITION", "INTEGRATION", "INTERNAL"] },
        message: { type: "string" },
        fieldErrors: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
      },
      required: ["code", "message"],
    },
    requestId: { type: "string" },
  },
};

const errors = {
  "401": { description: "Missing or invalid credentials", content: { "application/json": { schema: errorSchema } } },
  "403": { description: "Not permitted", content: { "application/json": { schema: errorSchema } } },
  "422": { description: "Validation failed", content: { "application/json": { schema: errorSchema } } },
  "429": { description: "Rate limited", content: { "application/json": { schema: errorSchema } } },
};

/** OpenAPI 3.1 document, generated from the same Zod schemas the API validates with. */
export function openApiDocument(baseUrl: string) {
  const listQuery = json(employeeListSchema) as { properties: Record<string, object> };
  return {
    openapi: "3.1.0",
    info: {
      title: "PeopleSuccess API",
      version: "1.0.0",
      description:
        "REST API for PeopleSuccess by Grevya. Authenticate with a Supabase access token (Authorization: Bearer) and select the organization with X-Tenant-Id. All endpoints enforce the caller's roles and data scope. Money is in integer paise.",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      parameters: {
        tenant: { name: "X-Tenant-Id", in: "header", required: false, schema: { type: "string", format: "uuid" }, description: "Organization id. Defaults to the user's last active organization." },
        idempotency: { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", minLength: 8, maxLength: 100 }, description: "Replays return the original response; a different body with the same key returns 409." },
      },
      schemas: { Error: errorSchema, EmployeeCreate: json(createEmployeeSchema) },
    },
    security: [{ bearer: [] }],
    paths: {
      "/me": {
        get: {
          summary: "Current user, organization and permissions",
          parameters: [{ $ref: "#/components/parameters/tenant" }],
          responses: { "200": { description: "OK" }, ...errors },
        },
      },
      "/employees": {
        get: {
          summary: "List employees",
          description: "Directory with the caller's visibility (self, team or all).",
          parameters: [
            { $ref: "#/components/parameters/tenant" },
            ...Object.entries(listQuery.properties).map(([name, schema]) => ({ name, in: "query", required: false, schema })),
          ],
          responses: { "200": { description: "Paginated list (50 per page)" }, ...errors },
        },
        post: {
          summary: "Create an employee",
          parameters: [{ $ref: "#/components/parameters/tenant" }, { $ref: "#/components/parameters/idempotency" }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EmployeeCreate" } } } },
          responses: { "201": { description: "Created" }, "409": { description: "Conflict (duplicate or idempotency mismatch)" }, ...errors },
        },
      },
      "/employees/{id}": {
        get: {
          summary: "Get an employee",
          parameters: [{ $ref: "#/components/parameters/tenant" }, { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "Profile fields the caller may see" }, "404": { description: "Not found" }, ...errors },
        },
      },
    },
  };
}
