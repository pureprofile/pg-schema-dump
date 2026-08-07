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
