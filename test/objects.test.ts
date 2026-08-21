// test/objects.test.ts — unit tests for journal, attachment and saved-view projections.

import { describe, expect, it, vi } from 'vitest';
import {
  projectAttachments,
  projectJournal,
  projectViews,
  resolveObjectType,
} from '../src/objects.js';
import type { M42Client } from '../src/m42-client.js';
import { availableTools, READ_TOOLS, WRITE_TOOLS, selectTools } from '../src/tools/index.js';

describe('projectJournal', () => {
  it('keeps the timeline fields and drops presentation noise', () => {
    expect(
      projectJournal([
        {
          Id: 'j-1',
          CreatedDate: '2025-11-29T08:52:00Z',
          Header: 'Solution point escalated',
          Text: 'The Ticket solution point was escalated',
          Creator: 'SYSTEM',
          CreatorPhoto: '/WM/Images/Uploads/ContactPhotos/EmptyUserMale.png',
          Color: '0xff808080',
          CreatorFragmentId: '0000',
        },
      ]),
    ).toEqual([
      {
        id: 'j-1',
        createdDate: '2025-11-29T08:52:00Z',
        header: 'Solution point escalated',
        text: 'The Ticket solution point was escalated',
        creator: 'SYSTEM',
      },
    ]);
  });

  it('returns an empty list for a non-array response', () => {
    expect(projectJournal(null)).toEqual([]);
    expect(projectJournal({ Message: 'error' })).toEqual([]);
  });
});

describe('projectAttachments', () => {
  it('drops the inline base64 thumbnail, which is large and useless to a model', () => {
    const [file] = projectAttachments([
      {
        UniqueFileId: 'f-1',
        Name: 'w3c_home.png',
        Comment: 'Uploaded by User',
        UpdatedBy: 'SYSTEM',
        UpdatedOn: '2025-10-11T17:10:09Z',
        Thumbnail: `data:image/jpg;base64,${'A'.repeat(5000)}`,
        StorageId: 's-1',
      },
    ]);
    expect(file).toEqual({
      fileId: 'f-1',
      name: 'w3c_home.png',
      comment: 'Uploaded by User',
      updatedBy: 'SYSTEM',
      updatedOn: '2025-10-11T17:10:09Z',
    });
    expect(JSON.stringify(file).length).toBeLessThan(200);
  });

  it('handles an object with no files', () => {
    expect(projectAttachments([])).toEqual([]);
  });
});

describe('projectViews', () => {
  it('exposes the predefined filter, which is what makes a view worth using', () => {
    expect(
      projectViews([
        {
          Name: 'Recently Added Knowledge Articles',
          Description: '',
          SchemaClassName: 'SVMKBArticleClassBase',
          PrimaryFilter: 'Parent is null',
          'Expression-ObjectID': 'view-1',
        },
      ]),
    ).toEqual([
      {
        id: 'view-1',
        name: 'Recently Added Knowledge Articles',
        description: '',
        class: 'SVMKBArticleClassBase',
        predefinedFilter: 'Parent is null',
      },
    ]);
  });

  it('drops rows without an object id, which cannot be run', () => {
    expect(projectViews([{ Name: 'orphan' }])).toEqual([]);
  });
});

describe('write gating', () => {
  it('hides write tools unless writes are enabled', () => {
    expect(availableTools(false).map((t) => t.id)).toEqual(READ_TOOLS.map((t) => t.id));
    expect(availableTools(false).some((t) => t.id === 'ticket_actions')).toBe(false);
  });

  it('exposes write tools when writes are enabled', () => {
    expect(availableTools(true).some((t) => t.id === 'ticket_actions')).toBe(true);
  });

  it('keeps every read tool read-only', () => {
    expect(READ_TOOLS.map((t) => t.id)).toEqual([
      'server_info',
      'webservice_discovery',
      'schema_discovery',
      'data_query',
      'service_desk',
    ]);
    expect(WRITE_TOOLS.map((t) => t.id)).toEqual(['ticket_actions']);
  });

  it('refuses to select a write tool by name when writes are disabled', () => {
    const { tools, unknown } = selectTools(['ticket_actions'], false);
    expect(tools).toEqual([]);
    expect(unknown).toEqual(['ticket_actions']);
  });

  it('allows selecting a write tool by name once writes are enabled', () => {
    const { tools, unknown } = selectTools(['ticket_actions'], true);
    expect(tools.map((t) => t.id)).toEqual(['ticket_actions']);
    expect(unknown).toEqual([]);
  });
});

describe('resolveObjectType', () => {
  /** A client whose getJson answers with a canned payload, or throws. */
  function fakeClient(payload: unknown, throws = false) {
    const getJson = vi.fn(async () => {
      if (throws) throw new Error('404');
      return payload;
    });
    return { client: { getJson } as unknown as M42Client, getJson };
  }

  it('answers the configuration item an object belongs to', async () => {
    const { client } = fakeClient('SPSUserType');
    expect(await resolveObjectType(client, 'obj-1')).toBe('SPSUserType');
  });

  it('asks the object-type endpoint, escaping the id', async () => {
    const { client, getJson } = fakeClient('T');
    await resolveObjectType(client, 'a/b');
    expect(getJson).toHaveBeenCalledWith('m42Services/api/data/objectTypeName/a%2Fb');
  });

  it('reports a miss for a fragment id, which the API answers with an empty string', async () => {
    const { client } = fakeClient('');
    expect(await resolveObjectType(client, 'frag-1')).toBeNull();
  });

  it('treats whitespace as a miss too', async () => {
    const { client } = fakeClient('   ');
    expect(await resolveObjectType(client, 'x')).toBeNull();
  });

  it('treats an unknown id as data rather than raising', async () => {
    const { client } = fakeClient(null, true);
    expect(await resolveObjectType(client, 'x')).toBeNull();
  });

  it('reports a miss when the answer is not a string', async () => {
    const { client } = fakeClient({ unexpected: true });
    expect(await resolveObjectType(client, 'x')).toBeNull();
  });
});
