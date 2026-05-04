/**
 * Expression Patterns
 * CASE, $if, subqueries, eb functions, advanced expression building
 */
import { db } from "./db";
import { sql, expressionBuilder, Expression, SqlBool } from "kysely";
import type { DB } from "./db.d";

// ============================================
// CASE EXPRESSIONS
// ============================================

// Simple CASE
const ordersWithLabels = await db
  .selectFrom("order")
  .select((eb) => [
    "id",
    "status",
    eb
      .case()
      .when("status", "=", "completed")
      .then("Done")
      .when("status", "=", "shipped")
      .then("In Transit")
      .when("status", "=", "pending")
      .then("Processing")
      .else("Unknown")
      .end()
      .as("statusLabel"),
  ])
  .execute();

// ============================================
// $if - CONDITIONAL QUERY BUILDING
// ============================================

// $if for conditional WHERE
const includeInactive = false;
const users = await db
  .selectFrom("user")
  .selectAll()
  .$if(!includeInactive, (qb) => qb.where("is_active", "=", true))
  .execute();

// $if for conditional SELECT columns
const includeMetadata = true;
const usersWithOptionalMeta = await db
  .selectFrom("user")
  .select(["id", "email", "first_name", "last_name"])
  .$if(includeMetadata, (qb) => qb.select("metadata"))
  .execute();
// Note: metadata becomes OPTIONAL in result type (metadata?: Json)

// Multiple $if conditions
const filterRole: string | null = "admin";
const onlyActive = true;
const filteredUsers = await db
  .selectFrom("user")
  .selectAll()
  .$if(!!filterRole, (qb) => qb.where("role", "=", filterRole!))
  .$if(onlyActive, (qb) => qb.where("is_active", "=", true))
  .execute();

// ============================================
// SUBQUERIES
// ============================================

// Subquery in WHERE (IN)
const usersWithOrders = await db
  .selectFrom("user")
  .selectAll()
  .where(
    "id",
    "in",
    db.selectFrom("order").select("user_id").where("status", "=", "completed")
  )
  .execute();

// EXISTS subquery
const productsWithReviews = await db
  .selectFrom("product")
  .selectAll()
  .where((eb) =>
    eb.exists(
      db
        .selectFrom("review")
        .select(sql`1`.as("one"))
        .whereRef("review.product_id", "=", eb.ref("product.id"))
    )
  )
  .execute();

// ============================================
// eb.fn - FUNCTION CALLS
// ============================================

// String functions with eb.fn<ReturnType>
const userNames = await db
  .selectFrom("user")
  .select((eb) => [
    eb.fn<string>("concat", [
      eb.ref("first_name"),
      eb.cast(eb.val(" "), "text"), // Cast string literals!
      eb.ref("last_name"),
    ]).as("fullName"),
    eb.fn<string>("upper", [eb.ref("email")]).as("upperEmail"),
    eb.fn<number>("length", [eb.ref("email")]).as("emailLength"),
  ])
  .execute();

// COALESCE
const productsWithDefault = await db
  .selectFrom("product")
  .select((eb) => [
    "name",
    eb.fn.coalesce("cost", sql`0`).as("costOrZero"),
  ])
  .execute();

// ============================================
// BINARY EXPRESSIONS
// ============================================

// Arithmetic with eb()
const lineItems = await db
  .selectFrom("order_item")
  .select((eb) => [
    "id",
    "quantity",
    "unit_price",
    eb("quantity", "*", eb.ref("unit_price")).as("lineTotal"),
  ])
  .execute();

// ============================================
// eb.val() vs eb.lit()
// ============================================

// eb.val() - Parameterized value ($1, $2) - SAFER for user input
// Note: May need cast for type inference
const searchTerm = "alice";
const searchResults = await db
  .selectFrom("user")
  .select(["id", "email"])
  .where("email", "like", (eb) =>
    eb.fn<string>("concat", [
      eb.cast(eb.val("%"), "text"),
      eb.cast(eb.val(searchTerm), "text"),
      eb.cast(eb.val("%"), "text"),
    ])
  )
  .execute();

// eb.lit() - Literal in SQL - ONLY for numbers, booleans, null
// THROWS "unsafe immediate value" for strings!
const priceCategories = await db
  .selectFrom("product")
  .select((eb) => [
    "name",
    "price",
    eb
      .case()
      .when("price", ">", eb.lit(100)) // Number literal - OK
      .then(sql<string>`'expensive'`)   // String - use sql``
      .when("price", ">", eb.lit(50))   // Number literal - OK
      .then(sql<string>`'moderate'`)    // String - use sql``
      .else(sql<string>`'cheap'`)       // String - use sql``
      .end()
      .as("priceCategory"),
  ])
  .execute();

// ============================================
// eb.not() - NEGATION
// ============================================

// Negate a condition
const inactiveProducts = await db
  .selectFrom("product")
  .select(["name", "is_active"])
  .where((eb) => eb.not(eb("is_active", "=", true)))
  .execute();

// NOT EXISTS
const usersWithoutOrders = await db
  .selectFrom("user")
  .select(["id", "email"])
  .where((eb) =>
    eb.not(
      eb.exists(
        db
          .selectFrom("order")
          .select(sql`1`.as("one"))
          .whereRef("order.user_id", "=", "user.id")
      )
    )
  )
  .execute();

// ============================================
// STANDALONE expressionBuilder
// ============================================

// Build expressions outside query context
const eb = expressionBuilder<DB, "user">();
const activeCondition = eb("is_active", "=", true);
const adminCondition = eb("role", "=", "admin");

const activeAdmins = await db
  .selectFrom("user")
  .select(["id", "email", "role"])
  .where((qb) => qb.and([activeCondition, adminCondition]))
  .execute();

// ============================================
// CONDITIONAL EXPRESSIONS WITH ARRAYS
// ============================================

// Build conditions dynamically
const conditions: Expression<SqlBool>[] = [];
const productEb = expressionBuilder<DB, "product">();

const filterActive = true;
const minPrice = 50;
const maxPrice: number | null = null;

if (filterActive) {
  conditions.push(productEb("is_active", "=", true));
}
if (minPrice) {
  conditions.push(productEb("price", ">=", String(minPrice)));
}
if (maxPrice) {
  conditions.push(productEb("price", "<=", String(maxPrice)));
}

const filteredProducts = await db
  .selectFrom("product")
  .select(["name", "price", "is_active"])
  .$if(conditions.length > 0, (qb) => qb.where((eb) => eb.and(conditions)))
  .execute();

// ============================================
// KEY PATTERNS SUMMARY
// ============================================

/*
1. CASE expressions:
   eb.case().when(...).then(...).else(...).end()

2. $if for conditional query parts:
   .$if(condition, (qb) => qb.where/select/etc)
   - Columns added via $if become OPTIONAL in type

3. eb.val() vs eb.lit():
   - eb.val(): Parameterized ($1) - use for user input
   - eb.lit(): Literal - ONLY numbers, booleans, null
   - For string literals: use sql`'string'`

4. eb.not(): Negate any expression
   eb.not(eb("col", "=", value))
   eb.not(eb.exists(...))

5. Standalone expressionBuilder:
   const eb = expressionBuilder<DB, "table">();
   - Build expressions outside query context
   - Useful for dynamic condition building

6. Expression<SqlBool>[] arrays:
   - Build conditions dynamically
   - Combine with eb.and([...]) or eb.or([...])
*/
