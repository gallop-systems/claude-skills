/**
 * SELECT and WHERE Patterns
 * Basic query patterns for fetching and filtering data
 */
import { db } from "./db";
import { sql } from "kysely";

// ============================================
// SELECT PATTERNS
// ============================================

// Select all columns
const allUsers = await db.selectFrom("user").selectAll().execute();

// Select specific columns
const userNames = await db
  .selectFrom("user")
  .select(["id", "email", "first_name", "last_name"])
  .execute();

// Column aliases with eb.ref().as()
const aliasedUsers = await db
  .selectFrom("user")
  .select((eb) => [
    eb.ref("first_name").as("firstName"),
    eb.ref("last_name").as("lastName"),
    eb.ref("email").as("emailAddress"),
  ])
  .execute();

// executeTakeFirst - returns T | undefined (for 0 or 1 row)
const maybeUser = await db
  .selectFrom("user")
  .selectAll()
  .where("email", "=", "alice@example.com")
  .executeTakeFirst();

// executeTakeFirstOrThrow - throws if no row found
const definiteUser = await db
  .selectFrom("user")
  .selectAll()
  .where("email", "=", "alice@example.com")
  .executeTakeFirstOrThrow();

// ============================================
// WHERE CLAUSES
// ============================================

// Equality
const admins = await db
  .selectFrom("user")
  .selectAll()
  .where("role", "=", "admin")
  .execute();

// Comparison operators (<, >, <=, >=, !=)
const expensiveProducts = await db
  .selectFrom("product")
  .select(["name", "price"])
  .where("price", ">", "100")
  .execute();

// IN clause - array of values
const pendingOrShipped = await db
  .selectFrom("order")
  .selectAll()
  .where("status", "in", ["pending", "shipped"])
  .execute();

// LIKE pattern matching
const bookProducts = await db
  .selectFrom("product")
  .select(["name", "sku"])
  .where("name", "like", "%Book%")
  .execute();

// IS NULL / IS NOT NULL
const uncategorized = await db
  .selectFrom("product")
  .select(["name", "category_id"])
  .where("category_id", "is", null)
  .execute();

// ============================================
// COMBINING CONDITIONS
// ============================================

// Multiple WHERE = AND (chained)
// Chaining .where() creates AND conditions
const activeAffordable = await db
  .selectFrom("product")
  .select(["name", "price", "is_active"])
  .where("is_active", "=", true)
  .where("price", "<", "100")
  .execute();

// OR conditions using eb.or()
const adminOrManager = await db
  .selectFrom("user")
  .selectAll()
  .where((eb) =>
    eb.or([
      eb("role", "=", "admin"),
      eb("role", "=", "manager"),
    ])
  )
  .execute();

// Complex AND/OR with eb.and() and eb.or()
const complexFilter = await db
  .selectFrom("product")
  .select(["name", "price", "stock_quantity"])
  .where((eb) =>
    eb.and([
      eb("is_active", "=", true),
      eb.or([
        eb("price", "<", "50"),
        eb("stock_quantity", ">", 100),
      ]),
    ])
  )
  .execute();

// ============================================
// KEY PATTERNS SUMMARY
// ============================================

/*
1. selectAll() vs select([...])
   - selectAll() gets all columns
   - select([...]) for specific columns - better performance

2. executeTakeFirst() vs execute()
   - execute() returns array
   - executeTakeFirst() returns single row or undefined
   - executeTakeFirstOrThrow() throws if not found

3. WHERE chaining = AND
   - .where(...).where(...) creates AND
   - Use eb.or([...]) for OR
   - Use eb.and([...]) for explicit AND

4. eb() inside where callbacks
   - eb("column", "=", value) creates comparison
   - Returns Expression<SqlBool> for composability
*/
