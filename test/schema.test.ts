// test/schema.test.ts — unit tests for schema decoding, projections, and pickup resolution.

import { describe, expect, it } from 'vitest';
import {
  cardinalityName,
  classTypeName,
  dataTypeName,
  matchesSearch,
  projectAttributes,
  projectConfigurationItems,
  projectDataDefinitions,
  projectPickupValues,
  projectRelatedClasses,
  projectRelations,
  relationTypeName,
  resolvePickupColumns,
  SchemaCache,
} from '../src/schema.js';
import { DEFAULT_SCHEMA_LIMIT, limitList } from '../src/tools/schema-discovery.js';

describe('enum decoding', () => {
  it('names the datatypes a model will meet', () => {
    expect(dataTypeName(0)).toBe('String');
    expect(dataTypeName(2)).toBe('Int');
    expect(dataTypeName(9)).toBe('Bool');
  });

  it('names relation types including the high-numbered ones', () => {
    expect(relationTypeName(0)).toBe('OneToMany');
    expect(relationTypeName(1)).toBe('ManyToMany');
    expect(relationTypeName(61443)).toBe('ManyToZeroOrOne');
  });

  it('names class types', () => {
    expect(classTypeName(3)).toBe('Data Definition');
    expect(classTypeName(4)).toBe('Pickup');
    expect(classTypeName(9)).toBe('Common Data Definition');
  });

  it('surfaces unknown ids instead of hiding them', () => {
    expect(dataTypeName(999)).toBe('Unknown(999)');
    expect(relationTypeName(12345)).toBe('Unknown(12345)');
  });
});

describe('cardinality — omitted defaults', () => {
  it('decodes the documented values', () => {
    expect(cardinalityName(0)).toBe('Mandatory');
    expect(cardinalityName(1)).toBe('Mandatory (Multi)');
    expect(cardinalityName(2)).toBe('Optional');
    expect(cardinalityName(3)).toBe('Optional (Multi)');
  });

  it('treats an absent cardinality as Mandatory, because Matrix42 omits default values', () => {
    expect(cardinalityName(undefined)).toBe('Mandatory');
    expect(cardinalityName(null)).toBe('Mandatory');
  });
});

describe('projectDataDefinitions', () => {
  const rows = [
    { InternalName: 'SPSUserClassBase', DisplayName: 'User', ClassType: 3, IsPickup: false },
    { InternalName: 'SPSUserPickupType', DisplayName: 'User Type', ClassType: 4, IsPickup: true },
    { InternalName: 'MTX_Custom', DisplayName: 'Custom', ClassType: 3, IsPickup: false },
  ];

  it('joins descriptions in and decodes the class type', () => {
    const descriptions = new Map([['SPSUserClassBase', 'Basic person attributes']]);
    const [user, pickup] = projectDataDefinitions(rows, descriptions, 'MTX_');
    expect(user).toMatchObject({
      internalName: 'SPSUserClassBase',
      description: 'Basic person attributes',
      classType: 'Data Definition',
      isPickup: false,
      isCustom: false,
    });
    expect(pickup).toMatchObject({ classType: 'Pickup', isPickup: true, description: '' });
  });

  it('flags customer-created objects using the instance prefix', () => {
    const [, , custom] = projectDataDefinitions(rows, new Map(), 'MTX_');
    expect(custom?.isCustom).toBe(true);
  });

  it('flags nothing as custom when the instance reports no prefix', () => {
    expect(projectDataDefinitions(rows, new Map(), '').every((e) => !e.isCustom)).toBe(true);
  });
});

describe('projectConfigurationItems', () => {
  it('exposes the main class and member definitions', () => {
    const [item] = projectConfigurationItems(
      [
        {
          InternalName: 'SPSUserType',
          DisplayName: 'User',
          MainClassName: 'SPSUserClassBase',
          RelatedClasses: ['SPSUserClassBase', 'SPSCommonClassBase'],
        },
      ],
      new Map([['SPSUserType', 'A person']]),
      'MTX_',
    );
    expect(item).toEqual({
      internalName: 'SPSUserType',
      displayName: 'User',
      description: 'A person',
      mainClass: 'SPSUserClassBase',
      dataDefinitions: ['SPSUserClassBase', 'SPSCommonClassBase'],
      isCustom: false,
    });
  });

  it('tolerates a missing RelatedClasses array', () => {
    const [item] = projectConfigurationItems([{ InternalName: 'X' }], new Map(), '');
    expect(item?.dataDefinitions).toEqual([]);
  });
});

describe('projectAttributes', () => {
  it('decodes the datatype and cross-links the pickup class', () => {
    const [attribute] = projectAttributes([
      {
        InternalName: 'UserType',
        DisplayName: 'User Type',
        Datatype: 2,
        AllowNull: true,
        Length: 4,
        DefaultValue: '3',
        PickupClass: { InternalName: 'SPSUserPickupType', DisplayName: 'User Pickup Type' },
      },
    ]);
    expect(attribute).toEqual({
      name: 'UserType',
      displayName: 'User Type',
      datatype: 'Int',
      allowNull: true,
      length: 4,
      defaultValue: '3',
      pickupClass: 'SPSUserPickupType',
    });
  });

  it('omits optional fields that Matrix42 did not send', () => {
    const [attribute] = projectAttributes([
      { InternalName: 'Name', DisplayName: 'Name', Datatype: 0 },
    ]);
    expect(attribute).toEqual({ name: 'Name', displayName: 'Name', datatype: 'String' });
    expect(attribute).not.toHaveProperty('pickupClass');
    expect(attribute).not.toHaveProperty('allowNull');
  });
});

describe('projectRelations', () => {
  it('flattens both sides of the relation and decodes its type', () => {
    const [relation] = projectRelations([
      {
        InternalName: 'FK_Something',
        RelationType: 61443,
        AttributeNameLeft: 'ShoppingCarts',
        AttributeNameRight: 'Requestor',
        ClassLeft: { InternalName: 'SPSUserClassBase' },
        ClassRight: { InternalName: 'SVCShoppingCartClassBase' },
      },
    ]);
    expect(relation).toEqual({
      name: 'FK_Something',
      type: 'ManyToZeroOrOne',
      leftClass: 'SPSUserClassBase',
      leftAttribute: 'ShoppingCarts',
      rightClass: 'SVCShoppingCartClassBase',
      rightAttribute: 'Requestor',
    });
  });
});

describe('projectRelatedClasses', () => {
  it('decodes cardinality and flags multi-fragments', () => {
    const related = projectRelatedClasses([
      { InternalName: 'A', DisplayName: 'A', ClassType: 3, Cardinality: 1 },
      { InternalName: 'B', DisplayName: 'B', ClassType: 3, Cardinality: 3 },
      { InternalName: 'C', DisplayName: 'C', ClassType: 3, Cardinality: 2 },
    ]);
    expect(related.map((r) => [r.cardinality, r.isMultiFragment])).toEqual([
      ['Mandatory (Multi)', true],
      ['Optional (Multi)', true],
      ['Optional', false],
    ]);
  });

  it('reads an omitted cardinality as Mandatory and not a multi-fragment', () => {
    const [related] = projectRelatedClasses([{ InternalName: 'A', DisplayName: 'A', ClassType: 3 }]);
    expect(related).toMatchObject({ cardinality: 'Mandatory', isMultiFragment: false });
  });
});

describe('resolvePickupColumns', () => {
  it('uses Value/DisplayString for the common pickup shape', () => {
    expect(resolvePickupColumns(['Value', 'Position', 'DisplayString'])).toEqual({
      valueColumn: 'Value',
      labelColumn: 'DisplayString',
      sortColumn: 'Position',
    });
  });

  it('falls back to the label column a pickup actually has', () => {
    expect(resolvePickupColumns(['Position', 'Image', 'DisplayText', 'Value'])).toMatchObject({
      valueColumn: 'Value',
      labelColumn: 'DisplayText',
    });
  });

  it('returns no label column when the pickup exposes none', () => {
    const resolved = resolvePickupColumns(['Value', 'Position', 'Image']);
    expect(resolved.labelColumn).toBeUndefined();
    expect(resolved.valueColumn).toBe('Value');
  });

  it('sorts by Value when Position is absent', () => {
    expect(resolvePickupColumns(['Value', 'DisplayString']).sortColumn).toBe('Value');
  });
});

describe('pickup column selection', () => {
  it('keeps the sort column selectable — Matrix42 rejects sorting on an unselected column', () => {
    const { valueColumn, labelColumn, sortColumn } = resolvePickupColumns([
      'Value',
      'Position',
      'DisplayString',
    ]);
    const requested = [...new Set([valueColumn, ...(labelColumn ? [labelColumn] : []), sortColumn])];
    expect(requested).toContain(sortColumn);
    expect(requested).toEqual(['Value', 'DisplayString', 'Position']);
  });

  it('does not duplicate a column that is both value and sort', () => {
    const { valueColumn, labelColumn, sortColumn } = resolvePickupColumns(['Value', 'DisplayString']);
    const requested = [...new Set([valueColumn, ...(labelColumn ? [labelColumn] : []), sortColumn])];
    expect(requested).toEqual(['Value', 'DisplayString']);
  });
});

describe('projectPickupValues', () => {
  it('pairs each value with its label', () => {
    expect(
      projectPickupValues(
        [
          { Value: 0, DisplayString: 'End User' },
          { Value: 15, DisplayString: 'Administrator' },
        ],
        'Value',
        'DisplayString',
      ),
    ).toEqual([
      { value: 0, label: 'End User' },
      { value: 15, label: 'Administrator' },
    ]);
  });

  it('returns empty labels when the pickup has no label column', () => {
    expect(projectPickupValues([{ Value: 7 }], 'Value')).toEqual([{ value: 7, label: '' }]);
  });
});

describe('matchesSearch', () => {
  const entry = {
    internalName: 'SVMEmailConfigurationClassBase',
    displayName: 'E-Mail Konfiguration',
    description: 'Controller for email settings',
  };

  it('matches on internal name, display name, and description, case-insensitively', () => {
    expect(matchesSearch(entry, 'svmemail')).toBe(true);
    expect(matchesSearch(entry, 'Konfiguration')).toBe(true);
    expect(matchesSearch(entry, 'EMAIL SETTINGS')).toBe(true);
    expect(matchesSearch(entry, 'email settings')).toBe(true);
  });

  it('rejects a term that appears in none of the three fields', () => {
    expect(matchesSearch(entry, 'workflow')).toBe(false);
  });

  it('keeps everything when no search term is given', () => {
    expect(matchesSearch(entry)).toBe(true);
    expect(matchesSearch(entry, '   ')).toBe(true);
  });
});

describe('SchemaCache', () => {
  it('returns what was stored', () => {
    const cache = new SchemaCache();
    expect(cache.getClasses()).toBeUndefined();
    cache.setClasses([]);
    expect(cache.getClasses()).toEqual([]);
    cache.setCustomPrefix('MTX_');
    expect(cache.getCustomPrefix()).toBe('MTX_');
  });

  it('keeps classes and configuration items separate', () => {
    const cache = new SchemaCache();
    cache.setClasses([]);
    expect(cache.getItems()).toBeUndefined();
  });
});

describe('limitList', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);

  it('caps and reports the true total', () => {
    expect(limitList(items, 10)).toMatchObject({ total: 250, truncated: true });
  });

  it('treats 0 as no limit', () => {
    expect(limitList(items, 0).returned).toHaveLength(250);
  });

  it('has a default that keeps listings readable', () => {
    expect(DEFAULT_SCHEMA_LIMIT).toBeGreaterThan(0);
    expect(limitList(items, DEFAULT_SCHEMA_LIMIT).returned).toHaveLength(DEFAULT_SCHEMA_LIMIT);
  });
});
