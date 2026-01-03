// server/api/validation/users.get.ts
// API endpoint with Zod query validation
import { z } from "zod";

const querySchema = z.object({
  search: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["active", "inactive", "all"]).default("all"),
});

export default defineEventHandler(async (event) => {
  // h3 v2+ - pass schema directly (Standard Schema)
  const query = await getValidatedQuery(event, querySchema);

  // query is fully typed: { search?: string, page: number, limit: number, status: "active" | "inactive" | "all" }

  // Use the validated params
  const offset = (query.page - 1) * query.limit;

  // Example: Build database query (pseudo-code)
  // const users = await db.selectFrom("user")
  //   .where((eb) => {
  //     const filters = [];
  //     if (query.search) filters.push(eb("name", "ilike", `%${query.search}%`));
  //     if (query.status !== "all") filters.push(eb("status", "=", query.status));
  //     return eb.and(filters);
  //   })
  //   .limit(query.limit)
  //   .offset(offset)
  //   .execute();

  return {
    message: "Query validated successfully",
    query,
    pagination: { page: query.page, limit: query.limit, offset },
  };
});
