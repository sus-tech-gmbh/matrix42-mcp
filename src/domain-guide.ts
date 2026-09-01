// src/domain-guide.ts — how Matrix42's functional areas map onto one data model.
//
// Orientation for anyone working against a Matrix42 instance for the first time. Written for this
// project; it links to the official documentation rather than reproducing it.

/**
 * The central insight: Matrix42 is one graph, not a set of separate modules. Getting this wrong
 * sends people hunting for entity types that do not exist.
 */
export const DOMAIN_GUIDE = `# Matrix42 is one graph, not many modules

Matrix42 is sold as a set of modules: service desk, asset management, licensing, contracts, service
catalog. The database underneath is not organised that way. Almost every functional area turns out
to be a small number of base data definitions, reused under different configuration items.

That one fact explains most of the confusion people hit early on. There is no "Licenses" table and
no "SLAs" table, because licenses are assets and service level agreements are contracts. Once you
know which base class an area sits on, a single query reaches the whole of it.

## The four base classes that carry most of the product

### SPSActivityClassBase, for every kind of ticket

Incidents, service requests, problems, changes and tasks are all rows of this one definition. What
tells them apart is the configuration item they belong to:

    SPSActivityTypeIncident        incident (break/fix)
    SPSActivityTypeServiceRequest  service request (wants something)
    SPSActivityTypeTicket          generic ticket, the portal entry point
    SPSActivityTypeGroupTicket     problem (cause behind several incidents)
    SPSActivityTypeBase            task (delegated unit of work)
    SVMChangeRequestType           change request

So one query over SPSActivityClassBase spans every ticket type at once, and filtering by
configuration item narrows it to a single kind. Fields that belong to only one kind live in sibling
definitions such as SPSActivityClassIncident and SVMActivityClassChange, which the T(...) pivot
reaches.

### SPSAssetClassBase, for every kind of asset, licenses included

A license is not a separate entity. The SPSAssetTypeLicense configuration item reuses
SPSAssetClassBase as its main class and layers license-specific definitions on top. Hardware,
licenses and every other asset kind therefore share the same identity, financial and lifecycle
fields: InventoryNumber, SerialNumber, AcquisitionDate, BookValue, AmortizationEndDate and
GuarantyEndDate.

### SPSContractClassBase, for every kind of contract, SLAs included

Service level agreements are contracts. The SLA configuration item uses SPSContractClassBase as its
main class, with SVCServiceLevelAgreementClassBase carrying the service-level specifics: reaction
and solution times, availability targets, MTBF and MTRS. Master contracts, purchase contracts and
volume license agreements are the same class again, under different configuration items.

### SPSArticleClassBase, for every catalog service

Catalog services, bundles and groups are all articles. Pricing and charge fields for a catalog item
live in SVCPortfolioClassServiceItem. The ordering trail runs from shopping cart to order to one
service booking per service and recipient, the last of which is SVCServiceBookingClassBase.

## Attribute names are not portable between instances

Every deployment carries a different set of attributes. Modules may be absent, and customers add
fields of their own. There is no way to tell from the outside whether a column exists, so the one
piece of advice worth repeating is to never guess an attribute name: read the definition from the
instance and use the names it reports. A name that does not exist comes back as an opaque 500,
without ever saying which column was wrong.

The tools in this server resolve their own columns against the live schema for exactly that reason.
When a field is missing they report it and return the rest of the row, rather than failing the
whole call.

## What this means when you go looking for something

- There is no "Licenses" or "SLAs" table to find. Look for the base class first, then the
  configuration item that specialises it.
- One well-chosen query covers a whole functional area. Describing a configuration item shows which
  definitions make up an object, and with what cardinality.
- Objects of different kinds are linked through relations rather than duplicated columns. Every row
  exposes [Expression-ObjectID], which points at the object that row belongs to.

## Orders and bookings have four independent status axes

A service booking tracks approval, provisioning, accounting and acceptance separately, as
ApprovalStatus, ProvisioningStatus, AccountingStatus and AcceptanceStatus. A stuck order is almost
always one axis that stalled, so all four are worth reading before concluding there is a single
state to fix.

## Two things worth knowing before you depend on an operation

**Part of the API is stable and part of it is not.** A small set of operations is marked public and
is update-safe: generic fragment and object access, the ticket create and close family,
attachments. Most domain services, including incident, order, license manager, workflow and the
activity verbs, are product API and can change between releases. Discovery reports isPublic for
every operation, which is the thing to check when an integration has to keep working.

**Modules differ per instance.** Licensing, SAM and others may simply not be installed, in which
case their definitions are absent altogether. A missing class usually means "not installed here"
rather than "wrong name", and listing the data definitions settles which it is.

**Endpoint management is a separate product.** Empirum and endpoint data protection run their own
databases. This API exposes their connector configuration and whatever inventory has been imported
from them; it cannot manage endpoints directly.

## Official documentation

Matrix42 publishes its own documentation at https://docs.matrix42.com. Search there for "Data
Definition", "Configuration Item", "Asset", "Contract Management", "Service Catalog" or "License
Management". Each instance also carries an API reference of its own, in the Administration
application under Integration → Web Services.`;
