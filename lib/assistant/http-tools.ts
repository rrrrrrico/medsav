import { z } from "zod";
import { tools } from "./tools";

/** Premium-data tools exposed over HTTP for external agent platforms such as Dify. Retrieval stays in-platform. */
export const httpTools = tools.filter((t) => t.name !== "search_documents");

export function authorised(header: string | null): boolean {
  const token = process.env.TOOLS_API_TOKEN;
  return Boolean(token) && header === `Bearer ${token}`;
}

export function openApiSpec(serverUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const t of httpTools) {
    const schema = z.toJSONSchema(t.schema as z.ZodType, { target: "openapi-3.0", io: "input" });
    delete (schema as Record<string, unknown>).$schema;
    paths[`/api/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.description,
        requestBody: { required: true, content: { "application/json": { schema } } },
        responses: { "200": { description: "JSON result", content: { "application/json": { schema: { type: "object" } } } } },
      },
    };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "MedSav VHIS premium tools",
      version: "1.0.0",
      description: "Premiums of Hong Kong VHIS certified plans from the government open-data release and insurers' premium tables.",
    },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    security: [{ bearer: [] }],
    paths,
  };
}
