// src/ticket-verbs.ts — the lifecycle verbs an agent uses on a ticket.
//
// Matrix42 wraps its state machine in named operations rather than exposing a raw state field,
// which is what makes these safe to offer: each one carries exactly the parameters its transition
// needs. Every verb builds a WritePlan first, so a caller can preview the exact request before it
// is sent; the execute functions then run that same plan, which is what stops a preview from ever
// drifting from the request it claims to describe.

import { M42Error, type M42Client } from './m42-client.js';
import { compact, executePlan, type WritePlan } from './write-plan.js';

/** Plans taking ownership of tickets, or accepting ones already assigned. */
export function planTakeOverOrAccept(
  verb: 'TakeOver' | 'Accept',
  objectIds: string[],
  typeName: string,
): WritePlan {
  return {
    method: 'POST',
    path: `m42Services/api/activity/${verb}`,
    // Objects is declared as an ARRAY of {ObjectIds, TypeName}; sending a single object made
    // Matrix42 report request.Objects.ObjectIds as invalid with an empty message.
    body: { Objects: [{ ObjectIds: objectIds, TypeName: typeName }] },
    summary: `${verb === 'TakeOver' ? 'Take over' : 'Accept'} ${objectIds.length} ticket(s) of type ${typeName}`,
    effects: ['Reassigns responsibility, which is visible to the current owner.'],
  };
}

/** Takes ownership of tickets, or accepts ones already assigned. */
export async function takeOverOrAccept(
  client: M42Client,
  verb: 'TakeOver' | 'Accept',
  objectIds: string[],
  typeName: string,
): Promise<{ done: true; verb: string; objectIds: string[] }> {
  await executePlan(client, planTakeOverOrAccept(verb, objectIds, typeName));
  return { done: true, verb, objectIds };
}

/** Fields a forward needs. */
export interface ForwardInput {
  tickets: { typeName: string; objectId: string }[];
  roleId?: string;
  userId?: string;
  olaId?: string;
  comments?: string;
}

/** Plans forwarding tickets to a role or a user. */
export function planForward(input: ForwardInput): WritePlan {
  if (!input.roleId && !input.userId) {
    throw new M42Error('Forward needs a target: pass role_id or user_id.');
  }
  // The contract models each ticket as a tuple of (TypeName, ObjectId).
  const Tickets = input.tickets.map((ticket) => ({ Item1: ticket.typeName, Item2: ticket.objectId }));
  const target = input.roleId ? `role ${input.roleId}` : `user ${input.userId}`;
  const effects = ['Hands the tickets to someone else, who is normally notified by Matrix42.'];
  if (input.olaId) effects.push('Applies an operational level agreement, which changes the clock.');

  return {
    method: 'POST',
    path: 'm42Services/api/activity/Forward',
    body: compact({
      Tickets,
      RoleID: input.roleId,
      UserID: input.userId,
      OlaID: input.olaId,
      Comments: input.comments,
    }),
    summary: `Forward ${Tickets.length} ticket(s) to ${target}`,
    effects,
  };
}

/** Forwards tickets to a role or a user. */
export async function forwardTickets(
  client: M42Client,
  input: ForwardInput,
): Promise<{ done: true; verb: 'Forward'; forwarded: number }> {
  await executePlan(client, planForward(input));
  return { done: true, verb: 'Forward', forwarded: input.tickets.length };
}

/** Fields a pause needs. */
export interface PauseInput {
  objectIds: string[];
  /**
   * Required in practice. The contract marks it optional, but an omitted date binds to
   * DateTime.MinValue and trips the server's "reminder date must be greater than now" guard.
   */
  reminderDate: string;
  comments?: string;
  reason?: number;
  notEscalateWhilePaused?: boolean;
}

/** Plans pausing tickets, optionally holding the escalation clock. */
export function planPause(input: PauseInput): WritePlan {
  const escalationHeld = input.notEscalateWhilePaused ?? false;
  return {
    method: 'POST',
    path: 'm42Services/api/activity/Pause',
    body: compact({
      ObjectIds: input.objectIds,
      ReminderDate: input.reminderDate,
      Comments: input.comments,
      Reason: input.reason,
      NotEscalateWhilePaused: escalationHeld,
    }),
    summary: `Pause ${input.objectIds.length} ticket(s)`,
    effects: [
      escalationHeld
        ? 'Stops the escalation clock, so service level breaches are not raised while paused.'
        : 'The escalation clock keeps running while the ticket is paused.',
    ],
  };
}

/** Pauses tickets, optionally holding the escalation clock. */
export async function pauseTickets(
  client: M42Client,
  input: PauseInput,
): Promise<{ done: true; verb: 'Pause'; objectIds: string[]; escalationHeld: boolean }> {
  await executePlan(client, planPause(input));
  return {
    done: true,
    verb: 'Pause',
    objectIds: input.objectIds,
    escalationHeld: input.notEscalateWhilePaused ?? false,
  };
}

/** Plans reopening closed tickets. */
export function planReopen(objectIds: string[], reason?: string): WritePlan {
  return {
    method: 'POST',
    path: 'm42Services/api/activity/Reopen',
    body: compact({ ObjectIds: objectIds, Reason: reason }),
    summary: `Reopen ${objectIds.length} closed ticket(s)`,
    effects: ['Puts closed tickets back into the queue, which changes closure reporting.'],
  };
}

/** Reopens closed tickets. */
export async function reopenTickets(
  client: M42Client,
  objectIds: string[],
  reason?: string,
): Promise<{ done: true; verb: 'Reopen'; objectIds: string[] }> {
  await executePlan(client, planReopen(objectIds, reason));
  return { done: true, verb: 'Reopen', objectIds };
}

/** Plans handing a ticket back to its responsible role. */
export function planReturnToRole(ticketObjectId: string, comments?: string): WritePlan {
  return {
    method: 'POST',
    path: 'm42Services/api/activity/ReturnToRole',
    body: compact({ TicketId: ticketObjectId, Comments: comments }),
    summary: 'Return the ticket to its responsible role',
    effects: ['Gives up ownership; the role is normally notified.'],
  };
}

/** Hands a ticket back to its responsible role. */
export async function returnToRole(
  client: M42Client,
  ticketObjectId: string,
  comments?: string,
): Promise<{ done: true; verb: 'ReturnToRole'; objectId: string }> {
  await executePlan(client, planReturnToRole(ticketObjectId, comments));
  return { done: true, verb: 'ReturnToRole', objectId: ticketObjectId };
}

/** Plans setting the handling deadline on tickets. */
export function planSetDeadline(objectIds: string[], deadline: string): WritePlan {
  return {
    method: 'POST',
    path: 'm42Services/api/activity/SetDeadline',
    body: { ObjectIds: objectIds, Deadline: deadline },
    summary: `Set the deadline of ${objectIds.length} ticket(s) to ${deadline}`,
    effects: ['Changes when the ticket counts as overdue, which drives escalation.'],
  };
}

/** Sets the handling deadline on tickets. */
export async function setDeadline(
  client: M42Client,
  objectIds: string[],
  deadline: string,
): Promise<{ done: true; verb: 'SetDeadline'; objectIds: string[]; deadline: string }> {
  await executePlan(client, planSetDeadline(objectIds, deadline));
  return { done: true, verb: 'SetDeadline', objectIds, deadline };
}

/** Activity types accepted when tracking working time (SVMActivityPickupActivityType). */
export const WORK_ACTIVITY_TYPES = {
  assignment: 1,
  investigation: 2,
  recording: 3,
  resolution: 4,
  administration: 5,
  other: 6,
} as const;

export type WorkActivityType = keyof typeof WORK_ACTIVITY_TYPES;

/** Fields tracking working time needs. */
export interface TrackWorkingTimeInput {
  objectIds: string[];
  minutes: number;
  description?: string;
  /** Required: the contract flags Minutes, ActivityType, Begin and End as the four mandatory fields. */
  activityType: WorkActivityType;
  /** Required, and End must be after Begin or Matrix42 rejects the booking. */
  begin: string;
  end: string;
}

/** Plans booking working time against tickets. */
export function planTrackWorkingTime(input: TrackWorkingTimeInput): WritePlan {
  return {
    method: 'POST',
    path: 'm42Services/api/activity/TrackWorkingTime',
    body: compact({
      ObjectIds: input.objectIds,
      Minutes: input.minutes,
      Description: input.description,
      ActivityType: WORK_ACTIVITY_TYPES[input.activityType],
      Begin: input.begin,
      End: input.end,
    }),
    summary: `Book ${input.minutes} minute(s) against ${input.objectIds.length} ticket(s)`,
    effects: ['Booked effort feeds time reporting, and may feed billing.'],
  };
}

/** Books working time against tickets. */
export async function trackWorkingTime(
  client: M42Client,
  input: TrackWorkingTimeInput,
): Promise<{ done: true; verb: 'TrackWorkingTime'; objectIds: string[]; minutes: number }> {
  await executePlan(client, planTrackWorkingTime(input));
  return { done: true, verb: 'TrackWorkingTime', objectIds: input.objectIds, minutes: input.minutes };
}
