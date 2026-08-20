// test/discovery.test.ts — unit tests for fragment projections and path building.

import { describe, expect, it } from 'vitest';
import { fragmentsPath, projectOperations, projectServices } from '../src/discovery.js';

const SERVICE_ROWS = [
  {
    ID: 'svc-1',
    Name: 'Fragments',
    RoutePrefix: 'api/data/fragments',
    ImplementationType: 'Matrix42.Pandora.Services.GenericFragmentDataController',
    Documentation: 'Generic fragment access',
    'Sys-Entity': 'PLSLServiceTypeWebAPI',
  },
  { ID: 'svc-2', Name: 'Account', RoutePrefix: 'api/account', Documentation: null },
];

const OPERATION_ROWS = [
  {
    ID: 'op-1',
    Name: 'Delete',
    Documentation: 'Deletes the fragment from Database',
    RouteTemplate: '{ddName}/{fragmentId:Guid}',
    Method: 'DELETE',
    IsPublic: 1,
    ServiceName: 'Fragments',
    ServiceRoute: 'api/data/fragments',
  },
  {
    ID: 'op-2',
    Name: 'GetUserDetails',
    Documentation: 'Gets user details by user fragment ID',
    RouteTemplate: 'UserDetails/{userId}',
    Method: 'GET',
    IsPublic: 0,
    ServiceName: 'Activity',
    ServiceRoute: 'api/activity',
  },
];

describe('projectServices', () => {
  it('maps the fields the model needs and drops Matrix42 internals', () => {
    const [first] = projectServices(SERVICE_ROWS);
    expect(first).toEqual({
      id: 'svc-1',
      name: 'Fragments',
      routePrefix: 'api/data/fragments',
      implementationType: 'Matrix42.Pandora.Services.GenericFragmentDataController',
      documentation: 'Generic fragment access',
    });
    expect(first).not.toHaveProperty('Sys-Entity');
  });

  it('turns a null documentation into an empty string', () => {
    expect(projectServices(SERVICE_ROWS)[1]?.documentation).toBe('');
  });
});

describe('projectOperations', () => {
  it('maps every operation when no search term is given', () => {
    const operations = projectOperations(OPERATION_ROWS);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toEqual({
      id: 'op-1',
      name: 'Delete',
      method: 'DELETE',
      path: '{ddName}/{fragmentId:Guid}',
      service: 'Fragments',
      serviceRoute: 'api/data/fragments',
      isPublic: true,
      documentation: 'Deletes the fragment from Database',
    });
  });

  it('coerces the numeric IsPublic flag to a boolean', () => {
    const operations = projectOperations(OPERATION_ROWS);
    expect(operations[0]?.isPublic).toBe(true);
    expect(operations[1]?.isPublic).toBe(false);
  });

  it('filters on the operation name, case-insensitively', () => {
    expect(projectOperations(OPERATION_ROWS, 'delete').map((o) => o.id)).toEqual(['op-1']);
    expect(projectOperations(OPERATION_ROWS, 'DELETE').map((o) => o.id)).toEqual(['op-1']);
  });

  it('filters on the documentation text', () => {
    expect(projectOperations(OPERATION_ROWS, 'user details').map((o) => o.id)).toEqual(['op-2']);
  });

  it('filters on the service name', () => {
    expect(projectOperations(OPERATION_ROWS, 'activity').map((o) => o.id)).toEqual(['op-2']);
  });

  it('returns nothing when the search matches no operation', () => {
    expect(projectOperations(OPERATION_ROWS, 'zzz-not-here')).toEqual([]);
  });

  it('ignores a blank search term', () => {
    expect(projectOperations(OPERATION_ROWS, '   ')).toHaveLength(2);
  });

  it('tolerates rows with missing attributes', () => {
    const [operation] = projectOperations([{ ID: 'op-3' }]);
    expect(operation).toEqual({
      id: 'op-3',
      name: '',
      method: '',
      path: '',
      service: '',
      serviceRoute: '',
      isPublic: false,
      documentation: '',
    });
  });
});

describe('fragmentsPath', () => {
  it('builds a columns-only path', () => {
    expect(fragmentsPath('PLSLServiceClassBase', 'Name,ID')).toBe(
      'm42Services/api/data/fragments/PLSLServiceClassBase?Columns=Name%2CID',
    );
  });

  it('appends and encodes an A-SQL Where filter', () => {
    const path = fragmentsPath('PLSLWebServiceOperation', 'ID', "Service.ID = 'guid-1'");
    expect(path).toContain('Where=Service.ID+%3D+%27guid-1%27');
  });

  it('encodes column aliases containing spaces', () => {
    expect(fragmentsPath('X', 'Type.DisplayString AS Method')).toContain(
      'Columns=Type.DisplayString+AS+Method',
    );
  });
});
