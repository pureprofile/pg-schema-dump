import {
  normalizedSrc,
  quoteIdent,
  quoteQualified,
  quotedIfUnsafe,
  sortedAttributes,
  unquoted,
} from '../../src/fs-schema-helpers';

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

// ---------------------------------------------------------------------------
// quoteIdent / quoteQualified
// ---------------------------------------------------------------------------
// quotedIfUnsafe only covers a hand-written keyword list, so identifiers read out
// of the catalog need a quoter that is safe for every legal name.
test('quoteIdent leaves a plain lowercase identifier bare', () => {
  expect(quoteIdent('account_holder')).toBe('account_holder');
});

test('quoteIdent quotes a name that is not a bare lowercase identifier', () => {
  expect(quoteIdent('Order-Key')).toBe('"Order-Key"');
  expect(quoteIdent('MixedCase')).toBe('"MixedCase"');
  expect(quoteIdent('has space')).toBe('"has space"');
  expect(quoteIdent('2startswithdigit')).toBe('"2startswithdigit"');
});

test('quoteIdent doubles an embedded double quote', () => {
  expect(quoteIdent('we"ird')).toBe('"we""ird"');
});

test('quoteIdent quotes a reserved word', () => {
  expect(quoteIdent('order')).toBe('"order"');
});

test('quoteQualified quotes each part independently', () => {
  expect(quoteQualified('public', 'panel')).toBe('public.panel');
  expect(quoteQualified('public', 'Order-Key')).toBe('public."Order-Key"');
});
