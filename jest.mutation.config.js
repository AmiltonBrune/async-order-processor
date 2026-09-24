module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  testMatch: ['**/test/unit/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
