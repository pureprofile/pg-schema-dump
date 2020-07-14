import { normalizedSrc, unquoted, quotedIfUnsafe, sortedAttributes } from '../fs-schema-helpers';

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
  expect(quotedIfUnsafe(`count`)).toBe(`"count"`);
  expect(quotedIfUnsafe(`from`)).toBe(`"from"`);
  expect(quotedIfUnsafe(`happy`)).toBe(`happy`);
  expect(quotedIfUnsafe(`?column?`)).toBe(`"?column?"`);
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
