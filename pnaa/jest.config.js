// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextJest = require("next/jest");

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: "./",
});

const customJestConfig = {
  // Setup files to run after Jest is initialized
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],

  // Use jsdom for DOM testing (simulates browser environment)
  testEnvironment: "jest-environment-jsdom",

  // Module path aliases to match tsconfig.json
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },

  // Where to find test files
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],

  // Files to include in coverage reports
  collectCoverageFrom: [
    "hooks/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "!**/*.d.ts",
    "!**/node_modules/**",
  ],

  // Ignore these paths when looking for tests
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/"],

  // Transform TypeScript files
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
};

module.exports = createJestConfig(customJestConfig);
