/**
 * ORDER BY and Pagination Patterns
 * Sorting, NULLS handling, DISTINCT, pagination
 */
import { db } from "./db";

// ============================================
// ORDER BY
// ============================================

// Simple ORDER BY
const productsByPrice = await db
  .selectFrom("product")
  .select(["name", "price"])
  .orderBy("price", "desc")
  .execute();

// Multiple ORDER BY - chain calls
// NOT array syntax - that's deprecated!
const sortedProducts = await db
  .selectFrom("product")
  .select(["name", "price", "stock_quantity"])
  .orderBy("is_active", "desc")  // Primary sort
  .orderBy("price", "asc")       // Secondary sort
  .execute();

// ============================================
// NULLS FIRST / NULLS LAST
// ============================================

// Use order builder callback (ob) - NOT sql``!
const productsNullsLast = await db
  .selectFrom("product")
  .select(["name", "category_id"])
  .orderBy("category_id", (ob) => ob.asc().nullsLast())
  .execute();

const productsNullsFirst = await db
  .selectFrom("product")
  .select(["name", "category_id"])
  .orderBy("category_id", (ob) => ob.desc().nullsFirst())
  .execute();

// ============================================
// PAGINATION
// ============================================

// LIMIT and OFFSET
const page2 = await db
  .selectFrom("product")
  .selectAll()
  .orderBy("name")
  .limit(10)    // Items per page
  .offset(10)   // Skip first page (page 1)
  .execute();

// Pagination helper pattern
async function getPaginatedProducts(page: number, pageSize: number) {
  return db
    .selectFrom("product")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();
}

// ============================================
// DISTINCT
// ============================================

// DISTINCT - unique values
const uniqueStatuses = await db
  .selectFrom("order")
  .select("status")
  .distinct()
  .execute();

// DISTINCT ON (PostgreSQL only)
// Get first row for each unique value of specified column(s)
const latestOrderPerUser = await db
  .selectFrom("order")
  .distinctOn("user_id")
  .select(["user_id", "id", "status", "created_at"])
  .orderBy("user_id")
  .orderBy("created_at", "desc") // Most recent first
  .execute();
// Returns one row per user - their latest order

// ============================================
// KEY PATTERNS SUMMARY
// ============================================

/*
1. ORDER BY syntax:
   .orderBy("column", "asc")   // ascending
   .orderBy("column", "desc")  // descending

2. Multiple columns - CHAIN, don't use array:
   .orderBy("col1", "desc")
   .orderBy("col2", "asc")

3. NULLS handling - use order builder callback:
   .orderBy("col", (ob) => ob.asc().nullsLast())
   .orderBy("col", (ob) => ob.desc().nullsFirst())

   AVOID sql`` for this - deprecated pattern!

4. Pagination:
   .limit(pageSize)
   .offset((page - 1) * pageSize)

5. DISTINCT ON (PostgreSQL):
   - Gets first row per unique value
   - ORDER BY must start with DISTINCT ON column(s)
   - Then order by what determines "first"
*/
