// src/schema-overview.ts — orientation text for the Matrix42 schema model, served as a tool action.
//
// Written for this project from observed API behaviour; it paraphrases concepts rather than
// reproducing vendor documentation, and links out to the official docs for the authoritative text.

/**
 * Explains how Matrix42 structures data, so that a data definition is not mistaken for a
 * configuration item - the most common and most costly error when reading this schema.
 */
export const SCHEMA_OVERVIEW = `# Matrix42 schema - how the data model is organised

## The two building blocks

A **data definition**, often abbreviated DD, is a physical table. It owns attributes and relations.
Internal names usually contain "Class", as in SPSUserClassBase.

A **configuration item**, or CI, is a structural unit that combines several data definitions into
one addressable object. It is largely metadata; the definitions hold the columns. Internal names
usually contain "Type", as in SPSUserType. Permissions are applied at configuration item level.

That Class/Type naming is a convention rather than a guarantee, so the listings are the reliable
way to tell one from the other. The vocabulary is historical: data definitions were once called
classes, and configuration items were called types.

## Fragments and objects

A **fragment** is one row of one data definition. An **object** is the composite at configuration
item level: the fragments across several definitions that share the same object id.

Every definition used in a configuration item exposes a computed column, \`[Expression-ObjectID]\`,
holding the id of the object it belongs to. That column is the bridge from any row back to its
object.

One thing catches people out here. Some definitions also carry an ordinary attribute literally
named ObjectID, holding a human-readable key such as ACT00100. That is a different thing from
\`[Expression-ObjectID]\`, and the two are easy to confuse.

## Cardinality and multi-fragments

Each definition joins a configuration item with one of four cardinalities:

    Mandatory | Mandatory (Multi) | Optional | Optional (Multi)

The two "(Multi)" forms are **multi-fragments**, meaning one object can have many rows of that
definition. This is the usual source of surprises when reading or writing: a single object may come
back as several fragments, and a fragment is addressed by its own fragment id rather than by the
object id. Describing a configuration item reports the cardinality of every definition in it and
flags the multi-fragments.

## Attributes and pickups

Attributes are typed: String, Int, Guid, Date, Bool, Text and others. An attribute whose values come
from a fixed list is a **pickup**. It is stored as an Int column that references a separate pickup
class holding the selectable options.

Pickup values are assigned per instance, so a status code that means one thing on one system can
mean something else on another. Reading the actual options is the only safe way to filter on one.
Describing a data definition reports the pickup class behind such an attribute, and the pickup
values themselves are available from there.

In query expressions a pickup attribute exposes both forms, the stored number and the localised
label, typically as \`<Attribute>.Value\` and \`<Attribute>.DisplayString\`.

## Relations

Relations connect two definitions and are named from both sides, each side owning an attribute name.
The relation type records the multiplicity: OneToMany, ManyToMany, ManyToZeroOrOne and so on. In a
query expression you traverse a relation with dot notation, starting from the attribute name. Within
a single configuration item you can pivot from one definition to a sibling using the
\`T(<ClassName>)\` form.

Relations are numerous. A central class can carry well over a hundred of them, which is why
descriptions return attributes by default and include relations only on request.

## Reading internal names

Internal names carry a module prefix - SPS, SVM, SVC, PDR, PLSL and others - grouping them by
functional area. These prefixes are conventional and are not formally documented anywhere.

Schema objects created on a particular instance, meaning customisations, carry that instance's own
custom prefix. The listings mark them with \`isCustom: true\`, using the prefix the instance itself
reports, so a customisation is always distinguishable from the shipped product schema.

Internal names are the stable identifier. Display names come back in the caller's language and will
differ between systems and between users, so they are not something to key on.

## Absent fields mean defaults, not gaps

Matrix42's JSON omits any property that equals its default. An absent cardinality means Mandatory
rather than "unknown", and an absent boolean means false. The tools in this server decode those
defaults rather than passing the gap along.

## Finding your way around

Working from the top down is usually quickest. Listing configuration items or data definitions with
a search term locates the functional area. Describing a configuration item then shows which
definitions make up the object, and which of them are multi-fragments. Describing a data definition
gives the attributes, with relations available on request when you need to traverse one. Where an
attribute is a pickup, its values are worth reading before you filter on it.

## Official documentation

The authoritative reference is Matrix42's own documentation:

    Documentation portal:        https://docs.matrix42.com
    Data model (DDs, CIs):       search the portal for "Data Definition" and "Configuration Item"
    Fragments / data service:    search for "Fragments Data Service"
    REST integration basics:     search for "Web Services REST API Integration"

Each instance also ships an API reference in its own Administration application, under
Integration → Web Services, which reflects that instance's actual endpoints.`;
