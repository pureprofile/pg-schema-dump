import { pgQuoteString, pgQuoteStrings, pgStringArray } from '../../src/pg-helpers';

// ---------------------------------------------------------------------------
// pgQuoteString
// ---------------------------------------------------------------------------
test('pgQuoteString wraps string in single quotes', () => {
  expect(pgQuoteString('abc')).toBe("'abc'");
});

test('pgQuoteString escapes embedded single quotes', () => {
  expect(pgQuoteString("O'Brien")).toBe("'O''Brien'");
});

test('pgQuoteString returns non-string values as-is', () => {
  expect(pgQuoteString(5 as any)).toBe(5 as any);
});

// ---------------------------------------------------------------------------
// pgQuoteStrings
// ---------------------------------------------------------------------------
test('pgQuoteStrings wraps each element', () => {
  expect(pgQuoteStrings(['a', 'b'])).toEqual(["'a'", "'b'"]);
});

// ---------------------------------------------------------------------------
// pgStringArray
// ---------------------------------------------------------------------------
test('pgStringArray parses postgres array literal', () => {
  expect(pgStringArray('{a,b,c}')).toEqual(['a', 'b', 'c']);
});

// node-postgres parses an array column only when its element type's oid has a
// registered parser, which is a property of the query rather than of this helper:
// array_agg(enumlabel) is name[] (oid 1003, no parser, so a raw string arrives here)
// while the same aggregate over a text column is text[] (oid 1009, already parsed).
// Handing the array parser an array silently returns [], so a cast added to a query
// must not be able to quietly empty part of a dump.
test('pgStringArray passes through a value node-postgres already parsed', () => {
  expect(pgStringArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
});
