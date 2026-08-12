import { defineConfig } from 'oxfmt';
import ultracite from 'ultracite/oxfmt';

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    // Owned by release-please — never hand-edited, so never reformatted either.
    'CHANGELOG.md',
  ],
  printWidth: 120,
  proseWrap: 'preserve',
  singleQuote: true,
});
