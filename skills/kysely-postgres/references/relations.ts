/**
 * Relations Patterns
 * jsonArrayFrom and jsonObjectFrom for nested data
 */
import { db } from "./db";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";

// ============================================
// IMPORTANT: Kysely is NOT an ORM
// ============================================

// Kysely doesn't have built-in relations like Prisma or TypeORM.
// Instead, use PostgreSQL JSON functions to fetch related data
// in a single query.

// ============================================
// jsonArrayFrom - One-to-Many
// ============================================

// User with their orders (one user -> many orders)
const usersWithOrders = await db
  .selectFrom("user")
  .select((eb) => [
    "user.id",
    "user.email",
    "user.first_name",
    // Correlated subquery returns JSON array
    jsonArrayFrom(
      eb
        .selectFrom("order")
        .select(["order.id", "order.status", "order.total_amount"])
        .whereRef("order.user_id", "=", "user.id") // Correlation!
        .orderBy("order.created_at", "desc")
    ).as("orders"),
  ])
  .where("user.is_active", "=", true)
  .execute();

// Result type: { id, email, first_name, orders: Array<{id, status, total_amount}> }

// ============================================
// jsonObjectFrom - Many-to-One
// ============================================

// Product with its category (many products -> one category)
const productsWithCategory = await db
  .selectFrom("product")
  .select((eb) => [
    "product.id",
    "product.name",
    "product.price",
    // Correlated subquery returns single JSON object
    jsonObjectFrom(
      eb
        .selectFrom("category")
        .select(["category.id", "category.name"])
        .whereRef("category.id", "=", "product.category_id") // Correlation!
    ).as("category"),
  ])
  .execute();

// Result type: { id, name, price, category: {id, name} | null }

// ============================================
// COMBINED NESTED RELATIONS
// ============================================

// Deep nesting: User -> Orders -> Products
const userOrderDetails = await db
  .selectFrom("user")
  .select((eb) => [
    "user.id",
    "user.email",
    jsonArrayFrom(
      eb
        .selectFrom("order")
        .innerJoin("order_item", "order_item.order_id", "order.id")
        .innerJoin("product", "product.id", "order_item.product_id")
        .select([
          "order.id as orderId",
          "order.status",
          "product.name as productName",
          "order_item.quantity",
        ])
        .whereRef("order.user_id", "=", "user.id")
    ).as("orderDetails"),
  ])
  .where("user.email", "=", "alice@example.com")
  .executeTakeFirst();

// ============================================
// MULTIPLE RELATIONS
// ============================================

// Order with user (many-to-one) AND items (one-to-many)
const ordersComplete = await db
  .selectFrom("order")
  .select((eb) => [
    "order.id",
    "order.status",
    "order.total_amount",
    // Many-to-one: user
    jsonObjectFrom(
      eb
        .selectFrom("user")
        .select(["user.id", "user.email", "user.first_name"])
        .whereRef("user.id", "=", "order.user_id")
    ).as("user"),
    // One-to-many: items
    jsonArrayFrom(
      eb
        .selectFrom("order_item")
        .innerJoin("product", "product.id", "order_item.product_id")
        .select([
          "order_item.quantity",
          "order_item.unit_price",
          "product.name as productName",
        ])
        .whereRef("order_item.order_id", "=", "order.id")
    ).as("items"),
  ])
  .execute();

// ============================================
// WITH FILTERING AND ORDERING
// ============================================

// Only include active items, ordered by price
const productWithActiveReviews = await db
  .selectFrom("product")
  .select((eb) => [
    "product.id",
    "product.name",
    jsonArrayFrom(
      eb
        .selectFrom("review")
        .select(["review.id", "review.rating", "review.title"])
        .whereRef("review.product_id", "=", "product.id")
        .where("review.rating", ">=", 4) // Filter inside relation!
        .orderBy("review.created_at", "desc")
        .limit(5) // Limit inside relation!
    ).as("topReviews"),
  ])
  .execute();

// ============================================
// KEY PATTERNS SUMMARY
// ============================================

/*
1. jsonArrayFrom - One-to-Many:
   - Returns JSON array of related rows
   - Use whereRef() to correlate with outer query
   - Can include joins, filters, ordering inside

2. jsonObjectFrom - Many-to-One:
   - Returns single JSON object or null
   - Use whereRef() to correlate with outer query
   - Returns null if no match (like LEFT JOIN)

3. Key differences from ORMs:
   - No automatic eager/lazy loading
   - You explicitly define what to fetch
   - Single query, no N+1 problem
   - Full control over the SQL

4. whereRef() is critical:
   - Links subquery to outer query
   - First arg: inner table column
   - Third arg: outer table column (eb.ref())

5. Performance benefits:
   - Single database round trip
   - PostgreSQL optimizes the JSON aggregation
   - No N+1 queries ever
*/
