/**
 * JSON/JSONB and Array Patterns
 * PostgreSQL-specific JSON functions and array handling
 */
import { db } from "./db";
import { sql } from "kysely";
import { jsonBuildObject } from "kysely/helpers/postgres";

// ============================================
// JSONB INSERT/UPDATE - NO JSON.stringify!
// ============================================

// The pg driver handles JSONB serialization automatically
// Just pass JavaScript objects directly!

// Insert with JSONB
const newUser = await db
  .insertInto("user")
  .values({
    email: "test@example.com",
    first_name: "Test",
    last_name: "User",
    metadata: { preferences: { theme: "dark" }, notifications: true } as any,
  })
  .returning(["id", "email", "metadata"])
  .executeTakeFirst();

// Update JSONB
const updatedUser = await db
  .updateTable("user")
  .set({
    metadata: { preferences: { theme: "light" }, notifications: false } as any,
  })
  .where("email", "=", "test@example.com")
  .returning(["id", "metadata"])
  .executeTakeFirst();

// ============================================
// JSONB READ - NO JSON.parse!
// ============================================

// Returns parsed objects automatically
const user = await db
  .selectFrom("user")
  .select(["id", "email", "metadata"])
  .where("email", "=", "test@example.com")
  .executeTakeFirst();

// Access directly - already an object!
console.log(user?.metadata?.preferences?.theme); // "light"
console.log(typeof user?.metadata); // "object"

// ============================================
// ARRAY COLUMNS - NO JSON.stringify!
// ============================================

// Insert with text[] array - pass array directly
const product = await db
  .insertInto("product")
  .values({
    name: "Test Product",
    sku: "TEST-001",
    price: "19.99",
    tags: ["electronics", "sale", "featured"], // Direct array!
  })
  .returning(["id", "name", "tags"])
  .executeTakeFirst();

// Read array - returns native JavaScript array
const productWithTags = await db
  .selectFrom("product")
  .select(["name", "tags"])
  .where("sku", "=", "TEST-001")
  .executeTakeFirst();

console.log(productWithTags?.tags); // ["electronics", "sale", "featured"]
console.log(Array.isArray(productWithTags?.tags)); // true

// Update array
await db
  .updateTable("product")
  .set({ tags: ["updated", "tags"] })
  .where("sku", "=", "TEST-001")
  .execute();

// ============================================
// ARRAY QUERIES
// ============================================

// Array contains all (@>) - operator works natively!
const hasAllTags = await db
  .selectFrom("product")
  .select(["name", "tags"])
  .where("tags", "@>", sql`ARRAY['electronics', 'premium']::text[]`)
  .execute();

// Array overlap (&&) - operator works natively!
const premiumOrBasic = await db
  .selectFrom("product")
  .select(["name", "tags"])
  .where("tags", "&&", sql`ARRAY['premium', 'basic']::text[]`)
  .execute();

// Array contains value (ANY) - type-safe with eb.fn
// eb.ref("tags") validates column exists at compile time
const searchTag = "phone";
const phonesProducts = await db
  .selectFrom("product")
  .select(["name", "tags"])
  .where((eb) => eb(sql`${searchTag}`, "=", eb.fn("any", [eb.ref("tags")])))
  .execute();
// Using eb.ref("invalid_column") would be a TypeScript error!

// ============================================
// JSONB QUERIES - Operators that work natively
// ============================================

// Key exists (?) - works as native operator!
const hasThemeKey = await db
  .selectFrom("user")
  .selectAll()
  .where("metadata", "?", "theme")
  .execute();

// Any key exists (?|) - works as native operator!
const hasAnyKey = await db
  .selectFrom("user")
  .selectAll()
  .where("metadata", "?|", sql`array['theme', 'language']`)
  .execute();

// All keys exist (?&) - works as native operator!
const hasAllKeys = await db
  .selectFrom("user")
  .selectAll()
  .where("metadata", "?&", sql`array['theme', 'notifications']`)
  .execute();

// JSONB contains (@>) - works as native operator!
const usersWithPrefs = await db
  .selectFrom("user")
  .selectAll()
  .where("metadata", "@>", sql`'{"notifications": true}'::jsonb`)
  .execute();

// JSONB contained by (<@) - works as native operator!
const simpleMetadata = await db
  .selectFrom("user")
  .selectAll()
  .where("metadata", "<@", sql`'{"theme": "dark", "notifications": true}'::jsonb`)
  .execute();

// ============================================
// JSONB QUERIES - Extraction
// ============================================

// Single-level extraction: -> and ->> work with eb() - type-safe!
const extracted = await db
  .selectFrom("user")
  .select((eb) => [
    "id",
    eb("metadata", "->", "preferences").as("preferences"),  // Returns JSONB
    eb("metadata", "->>", "theme").as("theme"),             // Returns text
  ])
  .execute();

// Nested path extraction: #> and #>> need sql``
const nestedJson = await db
  .selectFrom("user")
  .select([
    "id",
    sql`metadata#>'{preferences,theme}'`.as("theme"),       // Returns JSONB
  ])
  .execute();

const nestedText = await db
  .selectFrom("user")
  .select([
    "id",
    sql<string>`metadata#>>'{preferences,theme}'`.as("theme"), // Returns text
  ])
  .execute();

// Filter by JSON field value - type-safe!
const darkThemeUsers = await db
  .selectFrom("user")
  .selectAll()
  .where((eb) => eb(eb("metadata", "->>", "theme"), "=", "dark"))
  .execute();
// eb("metadata", ...) validates column - eb("invalid", ...) would be TS error

// Filter by nested JSON value (path syntax still needs sql``)
const specificUsers = await db
  .selectFrom("user")
  .selectAll()
  .where(sql`metadata#>>'{preferences,theme}'`, "=", "dark")
  .execute();

// ============================================
// JSONPath (PostgreSQL 12+)
// ============================================

// JSONPath match (@@) - works as native operator!
const matchingUsers = await db
  .selectFrom("user")
  .selectAll()
  .where("metadata", "@@", sql`'$.preferences.theme == "dark"'`)
  .execute();

// JSONPath exists (@?) - NOT in Kysely's allowlist, use function instead
// Use jsonb_path_exists() for type-safe column validation
const usersWithTheme = await db
  .selectFrom("user")
  .selectAll()
  .where((eb) =>
    eb.fn("jsonb_path_exists", [eb.ref("metadata"), sql`'$.preferences.theme'`])
  )
  .execute();
// eb.ref("metadata") validates column exists - eb.ref("invalid") would be TS error

// Extract value with JSONPath - type-safe with eb.fn
const themes = await db
  .selectFrom("user")
  .select((eb) => [
    "id",
    eb
      .fn("jsonb_path_query_first", [
        eb.ref("metadata"),
        sql`'$.preferences.theme'`,
      ])
      .as("theme"),
  ])
  .execute();

// JSONPath with variables
const searchValue = "dark";
const filtered = await db
  .selectFrom("user")
  .selectAll()
  .where((eb) =>
    eb.fn("jsonb_path_exists", [
      eb.ref("metadata"),
      sql`'$.preferences.theme ? (@ == $val)'`,
      sql`jsonb_build_object('val', ${searchValue}::text)`,
    ])
  )
  .execute();

// ============================================
// jsonBuildObject
// ============================================

// Build JSON objects in SELECT
const usersWithInfo = await db
  .selectFrom("user")
  .select((eb) => [
    "id",
    jsonBuildObject({
      fullName: eb.fn<string>("concat", [
        eb.ref("first_name"),
        eb.cast(eb.val(" "), "text"),
        eb.ref("last_name"),
      ]),
      email: eb.ref("email"),
      role: eb.ref("role"),
    }).as("userInfo"),
  ])
  .execute();

// ============================================
// jsonAgg with CTEs
// ============================================

// Aggregate rows into JSON array
const usersWithOrders = await db
  .with("user_orders", (db) =>
    db
      .selectFrom("order")
      .innerJoin("user", "user.id", "order.user_id")
      .select((eb) => [
        "user.id as userId",
        "user.email",
        eb.fn
          .jsonAgg(
            jsonBuildObject({
              orderId: eb.ref("order.id"),
              status: eb.ref("order.status"),
              total: eb.ref("order.total_amount"),
            })
          )
          .as("orders"),
      ])
      .groupBy(["user.id", "user.email"])
  )
  .selectFrom("user_orders")
  .selectAll()
  .execute();

// ============================================
// NESTED jsonAgg
// ============================================

// Multiple levels of nesting
const productsWithReviews = await db
  .with("product_with_reviews", (db) =>
    db
      .selectFrom("product")
      .leftJoin("review", "review.product_id", "product.id")
      .leftJoin("user", "user.id", "review.user_id")
      .select((eb) => [
        "product.id as productId",
        "product.name as productName",
        eb.fn
          .jsonAgg(
            jsonBuildObject({
              reviewId: eb.ref("review.id"),
              rating: eb.ref("review.rating"),
              title: eb.ref("review.title"),
              // Nested object!
              reviewer: jsonBuildObject({
                name: eb.fn<string>("concat", [
                  eb.ref("user.first_name"),
                  eb.cast(eb.val(" "), "text"),
                  eb.ref("user.last_name"),
                ]),
                email: eb.ref("user.email"),
              }),
            })
          )
          .filterWhere("review.id", "is not", null) // Filter nulls!
          .as("reviews"),
      ])
      .groupBy(["product.id", "product.name"])
  )
  .selectFrom("product_with_reviews")
  .selectAll()
  .where("reviews", "is not", null)
  .execute();

// ============================================
// KEY PATTERNS SUMMARY
// ============================================

/*
1. JSONB columns:
   - INSERT/UPDATE: Pass objects directly (no JSON.stringify)
   - SELECT: Returns parsed objects (no JSON.parse)
   - The pg driver handles serialization automatically

2. Array columns (text[], int[], etc.):
   - INSERT/UPDATE: Pass arrays directly (no JSON.stringify)
   - SELECT: Returns native JavaScript arrays
   - The pg driver handles this automatically

3. Array queries - operators work natively:
   - @>  : .where("tags", "@>", sql`ARRAY[...]::text[]`)
   - &&  : .where("tags", "&&", sql`ARRAY[...]::text[]`)
   - ANY : .where((eb) => eb(sql`${val}`, "=", eb.fn("any", [eb.ref("tags")])))
           eb.ref() provides type-safety - invalid columns are TS errors

4. JSONB queries - operators that work natively:
   - ?   : .where("col", "?", "key")
   - ?|  : .where("col", "?|", sql`array[...]`)
   - ?&  : .where("col", "?&", sql`array[...]`)
   - @>  : .where("col", "@>", sql`'{...}'::jsonb`)
   - <@  : .where("col", "<@", sql`'{...}'::jsonb`)

   Extraction operators:
   - ->> : eb(eb("col", "->>", "key"), "=", val)  (type-safe!)
   - ->  : eb("col", "->", "key")                 (returns JSONB)
   - #>  : sql`col#>'{a,b}'`    (nested path, needs sql``)
   - #>> : sql`col#>>'{a,b}'`   (nested path, needs sql``)

5. JSONPath (PostgreSQL 12+):
   - @@  : .where("col", "@@", sql`'$.path == "val"'`)  (native operator!)
   - @?  : NOT in allowlist - use jsonb_path_exists() instead
   - Functions (type-safe with eb.fn):
     - jsonb_path_exists(col, path)
     - jsonb_path_query_first(col, path)
   - eb.ref() provides type-safety for column references

6. jsonBuildObject:
   - Import from "kysely/helpers/postgres"
   - Use eb.ref() for column references
   - Can be nested for deep structures

7. jsonAgg:
   - Use eb.fn.jsonAgg() (NOT imported from helpers!)
   - Use .filterWhere() to exclude nulls
   - Combine with jsonBuildObject for structured arrays
*/
