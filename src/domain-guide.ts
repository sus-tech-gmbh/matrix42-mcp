// src/domain-guide.ts — how Matrix42's functional areas map onto one data model.
//
// This is the orientation a model needs before reaching for any domain tool. Written for this
// project; it links to the official documentation rather than reproducing it.

/**
 * The central insight: Matrix42 is one graph, not a set of separate modules. Getting this wrong
 * sends a model hunting for entity types that do not exist.
 */
export const DOMAIN_GUIDE = `# Matrix42 is one graph, not many modules

The product is marketed as separate modules — service desk, asset management, licensing, contracts,
service catalog. The database is not organised that way. Almost every functional area is a small
number of BASE DATA DEFINITIONS reused under different configuration items.

Once you know the base class, you can reach a whole functional area with one query.

## The four base classes that carry most of the product

**SPSActivityClassBase — every kind of ticket.**
Incident, service request, problem, change and task are all rows of this one definition, separated
only by their configuration item:

    SPSActivityTypeIncident        incident (break/fix)
    SPSActivityTypeServiceRequest  service request (wants something)
    SPSActivityTypeTicket          generic ticket, the portal entry point
    SPSActivityTypeGroupTicket     problem (cause behind several incidents)
    SPSActivityTypeBase            task (delegated unit of work)
    SVMChangeRequestType           change request

Consequence: one query over SPSActivityClassBase spans every ticket type. Filter by configuration
item when you want a single kind. Extended per-kind fields live in sibling definitions such as
SPSActivityClassIncident and SVMActivityClassChange — reach them with the T(...) pivot.

**SPSAssetClassBase — every kind of asset, INCLUDING licenses.**
A license is not a separate entity: the SPSAssetTypeLicense configuration item reuses
SPSAssetClassBase as its main class and layers license-specific definitions on top. Hardware,
licenses and other asset kinds therefore share identity, financial and lifecycle fields
(InventoryNumber, SerialNumber, AcquisitionDate, BookValue, AmortizationEndDate, GuarantyEndDate).

**SPSContractClassBase — every kind of contract, INCLUDING SLAs.**
Service level agreements are contracts: the SLA configuration item uses SPSContractClassBase as its
main class, with SVCServiceLevelAgreementClassBase carrying the service-level specifics (reaction
and solution times, availability targets, MTBF/MTRS). Master contracts, purchase contracts and
volume license agreements are the same class under different configuration items.

**SPSArticleClassBase — every catalog service.**
Catalog services, bundles and groups are all articles. Pricing and charge fields for a catalog item
live in SVCPortfolioClassServiceItem; the ordering trail is shopping cart → order → one service
booking per service and recipient (SVCServiceBookingClassBase).

## Never guess an attribute name

Every instance differs. Read the definition first with
schema_discovery(action='describe_data_definition') and use the names it reports. The domain tools
here resolve their own columns against the live schema for exactly this reason, and report which
requested fields the instance does not have rather than failing.

## What this means in practice

- Do not look for a "Licenses" or "SLAs" table. Look for the base class and the configuration item.
- One well-chosen query covers a whole area; use schema_discovery(describe_configuration_item) to
  see which definitions make up an object and with what cardinality.
- Objects of different kinds are linked through relations rather than duplicated columns; every row
  exposes [Expression-ObjectID] pointing at the object it belongs to.

## Orders and bookings have FOUR independent status axes

A service booking tracks Approval, Provisioning, Accounting and Acceptance separately
(ApprovalStatus, ProvisioningStatus, AccountingStatus, AcceptanceStatus). A "stuck order" is almost
always one axis that stalled — check all four rather than assuming a single state.

## Two cautions before you rely on something

**Stable versus changeable API.** A small set of operations is marked public and is update-safe:
generic fragment and object access, the ticket create/close family, attachments. Most domain
services (incident, order, license manager, workflow, activity verbs) are product API and can change
between releases. Discovery reports isPublic per operation — prefer public operations for anything
that must keep working.

**Modules differ per instance.** Licensing, SAM and other modules may not be installed, so their
definitions can be entirely absent. Missing classes mean "not installed here", not "wrong name" —
confirm with schema_discovery(list_data_definitions) before concluding anything.

**Separate products.** Endpoint management (Empirum) and endpoint data protection run as their own
products with their own databases. This API only exposes their connector configuration and whatever
inventory has been imported — it cannot manage endpoints directly.

## Official documentation

  https://docs.matrix42.com  — search for "Data Definition", "Configuration Item", "Asset",
  "Contract Management", "Service Catalog" or "License Management".
Each instance also carries its own API reference in the Administration application, under
Integration → Web Services.`;
