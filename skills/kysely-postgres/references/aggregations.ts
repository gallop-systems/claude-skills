/**
 * Aggregation Patterns
 * COUNT, SUM, AVG, GROUP BY, HAVING
 */
import { db } from "./db";

// ============================================
// BASIC AGGREGATIONS
// ============================================

// COUNT - total rows
const totalUsers = await db
  .selectFrom("user")
  .select((eb) => eb.fn.count("id").as("totalUsers"))
  .executeTakeFirst();
// Result: { totalUsers: "5" } - Note: returned as string!

// COUNT with GROUP BY
const usersByRole = await db
  .selectFrom("user")
  .select((eb) => [
    "role",
    eb.fn.count("id").as("count"),
  ])
  .groupBy("role")
  .execute();
// Result: [{ role: "admin", count: "1" }, { role: "user", count: "3" }]

// SUM
const totalRevenue = await db
  .selectFrom("order")
  .where("status", "=", "completed")
  .select((eb) => eb.fn.sum("total_amount").as("totalRevenue"))
  .executeTakeFirst();

// AVG
const averageRating = await db
  .selectFrom("review")
  .select((eb) => eb.fn.avg("rating").as("averageRating"))
  .executeTakeFirst();

// ============================================
// MULTIPLE AGGREGATIONS
// ============================================

// Multiple aggregations with GROUP BY
const orderStats = await db
  .selectFrom("order")
  .select((eb) => [
    "status",
    eb.fn.count("id").as("orderCount"),
    eb.fn.sum("total_amount").as("totalAmount"),
    eb.fn.avg("total_amount").as("avgAmount"),
  ])
  .groupBy("status")
  .execute();

// ============================================
// HAVING CLAUSE
// ============================================

// HAVING - filter aggregated results
// Use HAVING for conditions on aggregated values
// Use WHERE for conditions on individual rows
const popularProducts = await db
  .selectFrom("review")
  .innerJoin("product", "product.id", "review.product_id")
  .select((eb) => [
    "product.name",
    eb.fn.count("review.id").as("reviewCount"),
    eb.fn.avg("review.rating").as("avgRating"),
  ])
  .groupBy("product.id")
  .groupBy("product.name") // Group by all non-aggregated columns
  .having((eb) => eb.fn.count("review.id"), ">", 1)
  .execute();

// ============================================
// AGGREGATE FUNCTIONS REFERENCE
// ============================================

// Available aggregate functions:
// eb.fn.count(column)     - Count rows
// eb.fn.countAll()        - COUNT(*)
// eb.fn.sum(column)       - Sum values
// eb.fn.avg(column)       - Average value
// eb.fn.min(column)       - Minimum value
// eb.fn.max(column)       - Maximum value

// Example with all
const productStats = await db
  .selectFrom("product")
  .select((eb) => [
    eb.fn.count("id").as("total"),
    eb.fn.countAll().as("totalAll"),
    eb.fn.sum("price").as("totalPrice"),
    eb.fn.avg("price").as("avgPrice"),
    eb.fn.min("price").as("minPrice"),
    eb.fn.max("price").as("maxPrice"),
  ])
  .executeTakeFirst();

// ============================================
// KEY PATTERNS SUMMARY
// ============================================

/*
1. Aggregate functions return strings
   - count, sum, avg all return string type by default
   - Cast if you need numbers: eb.fn.count<number>("id")

2. GROUP BY rules:
   - All non-aggregated columns in SELECT must be in GROUP BY
   - Chain multiple .groupBy() calls for multiple columns

3. HAVING vs WHERE:
   - WHERE: filters rows BEFORE aggregation
   - HAVING: filters groups AFTER aggregation

4. Syntax pattern:
   .select((eb) => [
     "groupColumn",
     eb.fn.count("id").as("alias"),
   ])
   .groupBy("groupColumn")
   .having((eb) => eb.fn.count("id"), ">", 5)
*/
