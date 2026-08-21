// src/write-plan.ts — the request a write would send, as a value.
//
// Every write builds one of these first. The preview a caller sees IS the plan that gets executed,
// so a preview can never drift from the real request — which is the only thing that makes
// "show me what you are about to do" worth trusting.

import { M42Error, type M42Client } from './m42-client.js';

/** A single write, fully described before it is sent. */
export interface WritePlan {
  method: 'POST' | 'PUT' | 'DELETE';
  /** Path relative to the instance root, as the client takes it. */
  path: string;
  body?: Record<string, unknown>;
  /** One line on what this does, in plain language. */
  summary: string;
  /**
   * Consequences worth reading before confirming — anything that reaches a person, cascades to
   * other records, or cannot be undone. Empty when the write only touches the named records.
   */
  effects: string[];
}

/** Removes unset fields so Matrix42 receives only what the caller actually set. */
export function compact(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

/** Sends a planned write and fails loudly on a non-2xx response. */
export async function executePlan(client: M42Client, plan: WritePlan): Promise<string> {
  const { status, body } = await client.request(
    plan.method,
    plan.path,
    plan.body === undefined ? undefined : JSON.stringify(plan.body),
  );
  if (status < 200 || status >= 300) {
    throw new M42Error(
      `Matrix42 returned HTTP ${status} for /${plan.path}: ${body.slice(0, 400)}`,
      status,
    );
  }
  return body;
}

/** What a preview returns: everything the caller needs to decide, and nothing was sent. */
export interface WritePreview {
  wouldChange: true;
  applied: false;
  summary: string;
  request: { method: string; path: string; body?: Record<string, unknown> };
  effects: string[];
  /** Problems found before sending, e.g. an attribute this instance does not have. */
  warnings?: string[];
  next: string;
}

/** Describes a plan without sending it. */
export function previewPlan(plan: WritePlan, warnings: string[] = []): WritePreview {
  const preview: WritePreview = {
    wouldChange: true,
    applied: false,
    summary: plan.summary,
    request: compact({
      method: plan.method,
      path: plan.path,
      body: plan.body,
    }) as WritePreview['request'],
    effects: plan.effects,
    next: 'Nothing was changed. Show this to the user, and call again with confirm:true to apply it.',
  };
  if (warnings.length > 0) preview.warnings = warnings;
  return preview;
}
