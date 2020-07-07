module.exports = {
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*\\.(spec|test)\\.(ts)'],
  transform: { '^.+\\.(ts|tsx)$': 'ts-jest' },
  collectCoverage: true,
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,tsx}', '!<rootDir>/src/**/__tests__/**/*', '!<rootDir>/src/bin.ts'],
};
