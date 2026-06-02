import { log } from '../../src/utils';
import { vi } from 'vitest';

test('log.info calls console.info', () => {
  const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
  log.info('hi');
  expect(spy).toHaveBeenCalledWith('hi');
  spy.mockRestore();
});

test('log.warn calls console.warn', () => {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  log.warn('hi');
  expect(spy).toHaveBeenCalledWith('hi');
  spy.mockRestore();
});

test('log.error calls console.error', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  log.error('hi');
  expect(spy).toHaveBeenCalledWith('hi');
  spy.mockRestore();
});
