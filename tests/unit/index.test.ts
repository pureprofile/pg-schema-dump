import { PgClient } from '../../src';

test('PgClient is exported as a function/class', () => {
  expect(typeof PgClient).toBe('function');
});
