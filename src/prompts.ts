// src/prompts.ts — reusable prompt templates a client can offer its user.
//
// Prompts are the third MCP primitive alongside tools and resources. Each one encodes the order of
// operations this server rewards: orient, read the schema, validate, only then query or write. A
// model that follows one of these does not have to rediscover the never-guess rule by failing.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

/** One prompt template: metadata plus the text it expands to. */
export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  /** Argument names, each optional unless listed in `required`. */
  args: { name: string; description: string; required?: boolean }[];
  /** Builds the message text from the supplied arguments. */
  build(args: Record<string, string | undefined>): string;
}

/** Renders an optional argument as a line, or nothing when it was not supplied. */
function line(label: string, value: string | undefined): string {
  return value && value.trim() ? `\n${label}: ${value.trim()}` : '';
}

/** The prompt catalogue. */
export const PROMPTS: PromptDefinition[] = [
  {
    name: 'explore_instance',
    title: 'Get oriented in this Matrix42 instance',
    description:
      'Survey an unfamiliar instance: what it runs, which modules are installed, and where the data you care about lives.',
    args: [{ name: 'interest', description: 'What you care about, e.g. "assets" or "the service desk"' }],
    build: (a) => `Help me get oriented in this Matrix42 instance.${line('I am interested in', a.interest)}

Work in this order and show me what you find at each step:

1. Call server_info to confirm which instance is connected and which account is being used.
2. Read the data model guide — service_desk with action='data_model', or the resource
   matrix42://guide/data-model. It explains that Matrix42 is one graph rather than separate
   modules, which is what makes the rest of this efficient.
3. Use schema_discovery(action='list_data_definitions') with a search term to find the definitions
   relevant to my interest, and tell me which ones actually exist here — a missing definition means
   the module is not installed, not that the name is wrong.
4. Use service_desk(action='browse') on any curated domain that matches, and report the row counts
   plus any fields this instance does not have.

Finish with a short summary of what this instance can answer and what it cannot.`,
  },
  {
    name: 'build_query',
    title: 'Build a validated Matrix42 query',
    description:
      'Turn a question in plain language into a correct ASQL query, checking every attribute name against the live schema before running it.',
    args: [
      { name: 'goal', description: 'What you want to find, in plain language', required: true },
      { name: 'data_definition', description: 'Target data definition, if you already know it' },
    ],
    build: (a) => `Build a Matrix42 query for this goal: ${a.goal ?? '(describe the goal)'}${line(
      'Suggested data definition',
      a.data_definition,
    )}

Follow this sequence and do not skip a step:

1. Read the ASQL guide once — data_query(action='asql_guide'), or the resource matrix42://guide/asql.
2. Identify the data definition. If more than one plausibly fits, list the candidates with their
   descriptions and ask me which I mean rather than picking one.
3. Call schema_discovery(action='describe_data_definition') on it and use ONLY the attribute names
   it reports. Never guess a name — attribute sets differ per instance, and a guessed name fails
   with an opaque 500 rather than a helpful error.
4. For any pickup attribute in the filter, call schema_discovery(action='get_pickup_values') and use
   a real value. Pickup numbers differ between instances; do not carry one over from memory.
5. Check whether a saved view already expresses this — data_query(action='list_views'). A view
   carries a server-side filter and is more reliable than hand-written ASQL.
6. Validate the filter with data_query(action='validate_asql') before running it.
7. Run it with data_query(action='query'), and pass a sort whenever you page.

Show me the final query, then the results.`,
  },
  {
    name: 'triage_ticket',
    title: 'Triage a ticket',
    description:
      'Work through one ticket: what it is, who it belongs to, what the service level says, and what should happen next.',
    args: [
      { name: 'ticket', description: 'Ticket number, object id, or a description of it' },
      { name: 'concern', description: 'What you specifically want to know or decide' },
    ],
    build: (a) => `Triage a Matrix42 ticket for me.${line('Ticket', a.ticket)}${line(
      'What I want to know',
      a.concern,
    )}

1. Find it. If I gave a number or a description rather than an id, use
   service_desk(action='search_tickets'); it filters by person and category NAME, so no id lookups
   are needed first. Search kind='ticket' and widen to the other kinds if nothing matches.
2. Read it with service_desk(action='get_ticket') using its object id.
3. Read the history with data_query(action='list_journal') and tell me what has already been tried.
   Note which entries were portal-visible, i.e. what the requester has actually seen.
4. Check the service level: service_desk(action='sla_for_ticket') for which agreements apply and
   action='sla_times') for the reaction and solution clock.
5. Look for related context — the initiator's other open tickets, and any knowledge article that
   matches, via service_desk(action='browse', domain='kb_articles', search=...).

Then summarise: what the ticket is, where it stands, whether it is at risk against its service
level, and the concrete next step you recommend. Do not change anything — recommend, and let me
decide.`,
  },
  {
    name: 'safe_change',
    title: 'Make a change safely',
    description:
      'Walk a write through the preview-then-confirm protocol, so nothing reaches the instance before you have seen exactly what it will send.',
    args: [
      { name: 'intent', description: 'The change you want to make, in plain language', required: true },
    ],
    build: (a) => `I want to make this change in Matrix42: ${a.intent ?? '(describe the change)'}

Treat this as consequential and follow the protocol:

1. Confirm the write tools are actually available. If ticket_actions is not in your tool list, this
   deployment is read-only — say so and stop rather than looking for a way around it.
2. Identify the exact records involved and show them to me FIRST. Writes take OBJECT ids, not
   fragment ids; read them back so we both agree on what is about to change.
3. Preview the write. Call the action WITHOUT confirm, which returns the exact payload that would be
   sent plus any validation problems, and changes nothing. Show me that payload.
4. Wait for me to agree. Do not confirm on my behalf, and do not assume my earlier "yes" to one
   ticket covers a different one.
5. Only then repeat the call with confirm set.

Two things to be deliberate about, because they reach real people: notification flags are off by
default and must not be switched on unless I ask, and a journal entry is internal unless
visible_in_portal is set, which publishes it to the requester's self-service portal.

After the write, read the record back and show me the result.`,
  },
  {
    name: 'find_endpoint',
    title: 'Find the right Matrix42 API endpoint',
    description:
      'Locate the operation that does what you need and read its real contract — for writing integration code against Matrix42.',
    args: [
      { name: 'task', description: 'What the integration needs to do', required: true },
      { name: 'language', description: 'Language or tool you are writing it in' },
    ],
    build: (a) => `I need to call the Matrix42 API to: ${a.task ?? '(describe the task)'}${line(
      'I am writing it in',
      a.language,
    )}

1. Read the API conventions first — webservice_discovery(action='api_overview'), or the resource
   matrix42://guide/api. It covers the token exchange, the Explicit-Language header, and the
   difference between the stable public API and the product API.
2. Search for the operation: webservice_discovery(action='list_operations') with a search term.
   Show me the candidates with their documentation lines rather than picking one silently.
3. Read the winner's full contract with action='describe_operation' — method, path, every parameter
   and the return type. Use that contract verbatim; do not infer parameter names from the operation
   name.
4. Tell me whether it is marked public. Public operations are update-safe; product-API operations
   can change between Matrix42 releases, which matters for code that has to keep working.
5. If it touches schema objects, confirm the class and attribute names with schema_discovery rather
   than assuming them.

Then write the code, and point out anything in it that is instance-specific and should be verified
against the target system.`,
  },
];

/** Keeps only the string arguments, so a template never interpolates an object. */
function asStrings(args: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Registers every prompt template on the server. */
export function registerPrompts(server: McpServer): void {
  for (const prompt of PROMPTS) {
    const shape: Record<string, z.ZodType> = {};
    for (const arg of prompt.args) {
      const field = z.string().describe(arg.description);
      shape[arg.name] = arg.required ? field : field.optional();
    }

    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: z.object(shape) },
      (args: Record<string, unknown>) => ({
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: prompt.build(asStrings(args)) },
          },
        ],
      }),
    );
  }
}
