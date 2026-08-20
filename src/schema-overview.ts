// src/schema-overview.ts — orientation text for the Matrix42 schema model, served as a tool action.
//
// Written for this project from observed API behaviour; it paraphrases concepts rather than
// reproducing vendor documentation, and links out to the official docs for the authoritative text.

/**
 * Explains how Matrix42 structures data, so a model can navigate the schema tools without
 * mistaking a data definition for a configuration item (the most common and most costly error).
 */
export const SCHEMA_OVERVIEW = `# Matrix42 schema — how the data model is organised

## The two building blocks

**Data Definition (DD)** — a physical table. It owns attributes and relations. Internal names
usually contain "Class", e.g. SPSUserClassBase.

**Configuration Item (CI)** — a structural unit that combines several DDs into one addressable
object. It is largely metadata: the DDs hold the columns. Internal names usually contain "Type",
e.g. SPSUserType. Permissions are applied at CI level.

The Class/Type naming is a convention, not a guarantee — confirm with list_data_definitions and
list_configuration_items rather than inferring from the name alone. (The vocabulary is historical:
DDs were once called classes and CIs were called types.)

## Fragments and objects

A **fragment** is one row of one DD. An **object** is the CI-level composite: the fragments across
several DDs that share the same object id. Every DD used in a CI exposes a computed column
\`[Expression-ObjectID]\` holding the id of the CI-level object — this is the bridge from any row
back to the object it belongs to.

Careful: some DDs also have an ordinary attribute literally named ObjectID holding a human-readable
key such as ACT00100. That is a different thing from \`[Expression-ObjectID]\`.

## Cardinality and multi-fragments

Each DD joins a CI with one of four cardinalities:
  Mandatory | Mandatory (Multi) | Optional | Optional (Multi)

The "(Multi)" ones are **multi-fragments**: one object can have many rows of that DD. This is the
usual source of surprises when reading or writing — a single object may return several fragments,
and a fragment is addressed by its own fragment id rather than by the object id.
describe_configuration_item reports the cardinality of every DD and flags multi-fragments.

## Attributes and pickups

Attributes are typed (String, Int, Guid, Date, Bool, Text, …). An attribute whose values come from
a fixed list is a **pickup**: it is an Int column that references a separate pickup class holding
the selectable options. describe_data_definition reports the pickup class for such attributes;
get_pickup_values then returns the actual options.

Use this rather than guessing numeric codes: pickup values are assigned per instance, so a status
value that means one thing on one system can mean something else on another.

In query expressions, a pickup attribute exposes both forms — the underlying number and the
localised label — typically as \`<Attribute>.Value\` and \`<Attribute>.DisplayString\`.

## Relations

Relations connect two DDs and are named from both sides, each side owning an attribute name. The
relation type records the multiplicity (OneToMany, ManyToMany, ManyToZeroOrOne, …). In query
expressions you traverse a relation with dot notation from the attribute name.
Within one CI you can pivot from one DD to a sibling DD using the \`T(<ClassName>)\` form.

Relations are numerous: a central class can carry well over a hundred. describe_data_definition
returns attributes by default and only includes relations when you ask for them.

## Reading names

Internal names carry a module prefix (SPS, SVM, SVC, PDR, PLSL and others) grouping them by
functional area. These prefixes are conventional and are not formally documented.

Schema objects created on a specific instance (customisations) carry that instance's own custom
prefix. The listings mark them with \`isCustom: true\`, using the prefix reported by the instance
itself, so customisations are distinguishable from the shipped product schema.

Always key on \`internalName\`. Display names are returned in the caller's language and will differ
between systems and users.

## A note on absent fields

Matrix42's JSON omits properties that equal their default. An absent cardinality means Mandatory,
not "unknown"; an absent boolean means false. These tools decode such defaults for you.

## Suggested path

1. list_configuration_items / list_data_definitions with a search term to find the area.
2. describe_configuration_item to see which DDs make up the object and how (incl. multi-fragments).
3. describe_data_definition for the attributes; ask for relations when you need to traverse.
4. get_pickup_values before filtering on any pickup attribute.

## Official documentation

The authoritative reference is Matrix42's own documentation:
  - Documentation portal:        https://docs.matrix42.com
  - Data model (DDs, CIs):       search the portal for "Data Definition" and "Configuration Item"
  - Fragments / data service:    search for "Fragments Data Service"
  - REST integration basics:     search for "Web Services REST API Integration"
Each instance also ships an API reference in its own Administration application, under
Integration → Web Services, which reflects that instance's actual endpoints.`;
