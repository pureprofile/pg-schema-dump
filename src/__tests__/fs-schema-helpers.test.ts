import { normalizedSrc, unquoted, quotedIfKeyword, sortedAttributes } from '../fs-schema-helpers';

test('normalizedSrc', () => {
  expect(normalizedSrc(null as any)).toBe(null);
  expect(normalizedSrc(1 as any)).toBe(1);
  expect(normalizedSrc(`hello\rworld`)).toBe(`hello\nworld`);
  expect(normalizedSrc(`hello\r\nworld`)).toBe(`hello\nworld`);
  expect(normalizedSrc(`hello\n\rworld`)).toBe(`hello\nworld`);
  expect(normalizedSrc(`hello\nworld`)).toBe(`hello\nworld`);
  expect(normalizedSrc(`hello\tworld`)).toBe(`hello  world`);
});

test('unquoted', () => {
  expect(unquoted(`xxx`)).toBe(`xxx`);
  expect(unquoted(`"xxx"`)).toBe(`xxx`);
});

test('quotedIfKeyword', () => {
  expect(quotedIfKeyword(`count`)).toBe(`"count"`);
  expect(quotedIfKeyword(`from`)).toBe(`"from"`);
  expect(quotedIfKeyword(`happy`)).toBe(`happy`);
});

test('sortedAttributes', () => {
  expect(
    sortedAttributes([
      {
        name: 'city',
        references: {
          table: 'cities',
        },
      },
      {
        name: 'id',
      },
      {
        name: 'name',
      },
      {
        name: 'created_at',
      },
    ] as any)
  ).toEqual([
    {
      name: 'id',
    },
    {
      name: 'created_at',
    },
    {
      name: 'city',
      references: {
        table: 'cities',
      },
    },
    {
      name: 'name',
    },
  ]);
});
