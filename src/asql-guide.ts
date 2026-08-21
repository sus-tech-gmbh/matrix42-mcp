// src/asql-guide.ts — guide to ASQL, the expression language used for filters and columns.
//
// Written for this project from observed behaviour and this repo's own grammar notes; it links to
// the official documentation rather than reproducing it.

/**
 * Teaches the ASQL constructs a model needs to write a working filter or column list. Proprietary
 * query languages are where models hallucinate most, so this is served as its own action and is
 * paired with validate_asql.
 */
export const ASQL_GUIDE = `# ASQL — the Matrix42 expression language

ASQL is used in two places by the query tool:
  - \`where\`   — a filter expression, like a SQL WHERE clause
  - \`columns\` — a comma-separated list of column expressions to return

Every expression is written against ONE root data definition (the \`class\` you pass to the query).
Bare identifiers resolve against that class. Identifiers are case-insensitive.

Validate before you run: call action='validate_asql' with your expression and the class. It reports
exactly which attribute or construct is wrong, which is far cheaper than a failed query.

## Literals and operators

  strings   'single quotes'      (embed a quote by doubling it: 'it''s')
  dates     #2026-08-21#  or  #2026-08-21 14:12:56#
  numbers   42, 3.14, 0x1F
  comments  -- to end of line, or /* block */

  = <> < > <= >=   AND OR NOT   LIKE ('%' wildcard)   IN (...)   IS NULL / IS NOT NULL
  BETWEEN ... AND ...   EXISTS   CASE WHEN ... THEN ... ELSE ... END

Prefer server-side date functions over hardcoded dates:
  CreatedDate >= DATEADD(day, -30, GETDATE())

## Dot chains — following relations

A relation or pickup attribute can be followed with a dot to reach the target definition:

  Owner.LastName = 'Smith'
  Category.DisplayString LIKE 'Network%'

A chain ends at a plain attribute. Pickups behave like relations for chaining.

## Pickups — .Value and .DisplayString

A pickup attribute exposes both the stored number and its localised label:

  State.Value = 710                -- the underlying integer
  State.DisplayString = 'Closed'   -- the label, language-dependent

Prefer .Value for filters and get the real numbers from
schema_discovery(action='get_pickup_values') — never guess them, they differ per instance.

## T(...) — pivot to a sibling definition in the same object

An object is made of several data definitions. From the root class you can pivot to another
definition of the same configuration item:

  T(SPSCommonClassBase).State.Value = 710

Use schema_discovery(action='describe_configuration_item') to see which definitions share the object.
This is the construct to reach through when the attribute you want lives on a sibling definition.

## Brackets — expressions over a related definition

  Owner[LastName + ', ' + FirstName]

Opens an expression scope whose context is the target of \`Owner\`. Useful in \`columns\` to build a
display string in one go.

## SUBQUERY(...) — correlated subqueries

  SUBQUERY(<BaseClass> AS <alias>, <TargetAttribute>, <Filter>)

Inside the filter, \`<alias>.\` refers to the subquery's base class and \`base.\` refers to the
enclosing class, so the two can be correlated.

## [Expression-ObjectID] — the bridge to the object

Every data definition used in a configuration item exposes this computed column, holding the id of
the object the row belongs to. Select it when you need to fetch the whole object afterwards, or to
correlate rows of different definitions:

  columns: 'ID,Subject,[Expression-ObjectID]'

Note that some definitions also have an ordinary attribute called ObjectID holding a human-readable
key (e.g. an activity number) — that is a different thing.

## Aliases in columns

  columns: 'ID,Subject,T(SPSCommonClassBase).State.DisplayString AS StateLabel'

Alias any expression that is not a plain attribute name, so the result key is predictable.

## Functions

Aggregates (COUNT, SUM, MIN, MAX), null handling (ISNULL, COALESCE), CAST, and the usual date and
string functions are available. CURRENTUSERID() and INTERACTIVEUSERID() return the calling user —
note that with a service API token these usually resolve to no user, so do not rely on them to
answer "my items" questions.

## Official documentation

Matrix42 documents ASQL at:
  https://docs.matrix42.com  → search for "ASQL"
That page is the authoritative reference for the full grammar and function list.`;
