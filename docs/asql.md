# ASQL - the Matrix42 expression language

ASQL turns up in two places in a fragment query:

    where     a filter expression, much like a SQL WHERE clause
    columns   a comma-separated list of column expressions to return

Every expression is written against one root data definition, the class the query names. Bare
identifiers resolve against that class, and identifiers are case-insensitive.

## Attribute names have to come from the instance

Attribute sets differ between instances. Modules may be absent, and customers add fields of their
own, so there is no portable list to work from. Reading the real attributes of a class before
writing `columns` or `where` is the difference between a query that works and one that fails with
"Class X does not contain attribute Y".

Validating an expression before running it is cheaper than a failed query, and the validator
reports exactly which attribute or construct is wrong.

Two quirks are worth knowing up front:

- ID is always included for you. Matrix42 sorts by ID and rejects a sort on a column that was not
  selected, so a projection without it fails.
- DisplayString comes back automatically but cannot be requested explicitly. Asking for it is
  rejected on every definition, so it does not belong in `columns` - you will get it either way.

## Literals and operators

    strings   'single quotes'      (embed a quote by doubling it: 'it''s')
    dates     #2026-08-21#  or  #2026-08-21 14:12:56#
    numbers   42, 3.14, 0x1F
    comments  -- to end of line, or /* block */

    = <> < > <= >=   AND OR NOT   LIKE ('%' wildcard)   IN (...)   IS NULL / IS NOT NULL
    BETWEEN ... AND ...   EXISTS   CASE WHEN ... THEN ... ELSE ... END

Server-side date functions age better than hardcoded dates:

    CreatedDate >= DATEADD(day, -30, GETDATE())

## Dot chains, for following relations

A relation or pickup attribute can be followed with a dot to reach the definition it points at:

    Owner.LastName = 'Smith'
    Category.DisplayString LIKE 'Network%'

A chain ends at a plain attribute. Pickups behave like relations for the purpose of chaining.

People and roles on a ticket are relations, not names, which is the single most common way a filter
goes wrong here. There is no InitiatorName column on a ticket. Initiator, Recipient and
RecipientRole all point at another definition, so a filter has to travel through them:

    Initiator.LastName = 'Smith'                              -- SPSUserClassBase behind the relation
    Recipient.MailAddress LIKE '%@example.com'
    RecipientRole.T(SPSSecurityClassRole).Name = 'Service Desk'

The last one needs the T(...) pivot because SPSScRoleClassBase carries no attributes of its own.

## Pickups expose .Value and .DisplayString

A pickup attribute exposes both the stored number and its localised label:

    State.Value = 710                -- the underlying integer
    State.DisplayString = 'Closed'   -- the label, language-dependent

Filters are better built on .Value, since the label depends on the caller's language. The numbers
themselves differ per instance, so they have to be read from the instance rather than assumed.

## T(...), for pivoting to a sibling definition

An object is made of several data definitions. From the root class you can pivot to another
definition belonging to the same configuration item:

    T(SPSCommonClassBase).State.Value = 710

This is the construct that reaches an attribute living on a sibling definition. Describing the
configuration item shows which definitions share the object.

## Brackets, for expressions over a related definition

    Owner[LastName + ', ' + FirstName]

This opens an expression scope whose context is the target of `Owner`, which is useful in
`columns` for building a display string in one go.

## SUBQUERY(...), for correlated subqueries

    SUBQUERY(<BaseClass> AS <alias>, <TargetAttribute>, <Filter>)

Inside the filter, `<alias>.` refers to the subquery's base class and `base.` refers to the
enclosing class, so the two can be correlated.

## [Expression-ObjectID], the bridge to the object

Every data definition used in a configuration item exposes this computed column, holding the id of
the object the row belongs to. It is what you select when you need to fetch the whole object
afterwards, or to correlate rows from different definitions:

    columns: 'ID,Subject,[Expression-ObjectID]'

Some definitions also have an ordinary attribute called ObjectID, holding a human-readable key such
as an activity number. That is a different thing entirely.

## Aliases in columns

    columns: 'ID,Subject,T(SPSCommonClassBase).State.DisplayString AS StateLabel'

Any expression that is not a plain attribute name is worth aliasing, so the key in the result is
predictable rather than derived.

## Every identifier should be bracketed

The expression parser reserves words that collide with real attribute names. "End" is the clearest
case. It closes a CASE block, so selecting it bare fails with a syntax error that never names the
column, even though the attribute exists:

    Columns=ID,End      -> 500, ExpressionParser syntax error
    Columns=ID,[End]    -> 200

Bracketing a name that is not reserved does no harm, which makes unconditional bracketing safer
than maintaining a keyword list that will go stale. Each segment of a dotted path is bracketed
independently, and so is the alias, since it is parsed as an identifier in its own right:

    [State].[DisplayString] AS [State]

A dotted expression must carry an AS alias.

## Sort names the projected output, unbracketed

Sorting applies to the result of the projection rather than to the table, so a sort clause names
whatever the projection emits - the alias, where one was applied - and is not bracketed:

    Columns=[ID],[End] AS [EndedOn]  &  Sort=EndedOn DESC    -> 200
    Columns=[ID],[End] AS [EndedOn]  &  Sort=End DESC        -> 500

## ID goes in, DisplayString comes out

ID belongs in every projection: Matrix42 sorts by it and rejects a sort on a column that was not
selected. It does not appear in a class's attribute list, so it has to be added rather than looked
up. DisplayString is the mirror image - selecting it explicitly is rejected on every class tested,
yet it arrives automatically with any projection.

Relation attributes are also absent from the attribute list while remaining selectable, which is
why a strict "reject anything not in Attributes" check would block valid columns alongside the
invalid ones.

## Functions

Aggregates (COUNT, SUM, MIN, MAX), null handling (ISNULL, COALESCE), CAST, and the usual date and
string functions are all available. CURRENTUSERID() and INTERACTIVEUSERID() return the calling user,
but with a service API token they usually resolve to no user at all, so they are not a dependable
way to answer "my items" questions.

## Official documentation

Matrix42 documents ASQL at https://docs.matrix42.com - search there for "ASQL". That page is the
authoritative reference for the full grammar and function list.

---

*This is the text the Matrix42 MCP server serves as the resource `matrix42://guide/asql`.
It is generated from `src/asql-guide.ts` - edit that file and run `npm run docs`.*
