# ASQL — the Matrix42 expression language

ASQL is used in two places by the query tool:
  - `where`   — a filter expression, like a SQL WHERE clause
  - `columns` — a comma-separated list of column expressions to return

Every expression is written against ONE root data definition (the `class` you pass to the query).
Bare identifiers resolve against that class. Identifiers are case-insensitive.

## Rule 1: never guess an attribute name

Attribute sets differ per instance — modules may be absent and customers add their own fields.
Before writing `columns` or `where`, read the real attributes with
schema_discovery(action='describe_data_definition', name='<class>'). A guessed name fails with
"Class X does not contain attribute Y".

Two quirks worth knowing:
  - ID is always included for you. Matrix42 sorts by ID and rejects a sort on a column that was not
    selected, so a projection without it fails.
  - DisplayString is returned automatically but CANNOT be requested explicitly — asking for it is
    rejected on every definition. Leave it out of `columns`; you will get it anyway.

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

People and roles are relations, not names. A ticket has no InitiatorName column — Initiator,
Recipient and RecipientRole point at another definition, so filter through them:

  Initiator.LastName = 'Smith'                              -- SPSUserClassBase behind the relation
  Recipient.MailAddress LIKE '%@example.com'
  RecipientRole.T(SPSSecurityClassRole).Name = 'Service Desk'

The last one pivots with T(...) because SPSScRoleClassBase carries no attributes of its own. Read the
target definition with describe_data_definition rather than guessing an attribute name, and check the
expression with validate_asql before you rely on the result.

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

Opens an expression scope whose context is the target of `Owner`. Useful in `columns` to build a
display string in one go.

## SUBQUERY(...) — correlated subqueries

  SUBQUERY(<BaseClass> AS <alias>, <TargetAttribute>, <Filter>)

Inside the filter, `<alias>.` refers to the subquery's base class and `base.` refers to the
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

## Rule 2: bracket every identifier

The expression parser reserves words that collide with real attribute names. "End" is the
clearest case — it closes a CASE block, so selecting it bare fails with a syntax error that never
names the column, even though the attribute exists:

    Columns=ID,End      -> 500, ExpressionParser syntax error
    Columns=ID,[End]    -> 200

Bracketing a name that is NOT reserved is harmless, so bracket unconditionally rather than keeping
a keyword list that will go stale. Bracket each segment of a dotted path independently, and the
alias too, since it is parsed as an identifier in its own right:

    [State].[DisplayString] AS [State]

A dotted expression must carry an AS alias.

## Rule 3: sort names the projected output, unbracketed

Sorting is applied to the result of the projection rather than to the table, so a sort clause must
name whatever the projection emits — the alias where one is applied — and must not be bracketed:

    Columns=[ID],[End] AS [EndedOn]  &  Sort=EndedOn DESC    -> 200
    Columns=[ID],[End] AS [EndedOn]  &  Sort=End DESC        -> 500

## Rule 4: ID in, DisplayString out

ID must be in every projection: Matrix42 sorts by it and rejects a sort on a column that was not
selected. It does not appear in a class’s attribute list, so add it rather than looking it up.
DisplayString is the mirror image — selecting it explicitly is rejected on every class tested, yet
it comes back automatically with any projection. Never ask for it.

Relation attributes are also absent from the attribute list while remaining selectable, so a
strict "reject anything not in Attributes" check would block valid columns as well as invalid ones.

## Functions

Aggregates (COUNT, SUM, MIN, MAX), null handling (ISNULL, COALESCE), CAST, and the usual date and
string functions are available. CURRENTUSERID() and INTERACTIVEUSERID() return the calling user —
note that with a service API token these usually resolve to no user, so do not rely on them to
answer "my items" questions.

## Official documentation

Matrix42 documents ASQL at:
  https://docs.matrix42.com  → search for "ASQL"
That page is the authoritative reference for the full grammar and function list.

---

*This is the text the Matrix42 MCP server serves as the resource `matrix42://guide/asql`.
It is generated from `src/asql-guide.ts` — edit that file and run `npm run docs`.*
