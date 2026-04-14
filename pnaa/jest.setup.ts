import "@testing-library/jest-dom";

// Mock next/navigation - these are used throughout the app for routing
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Firebase config - prevents real Firebase connections during unit tests
// Individual tests can override these mocks as needed
jest.mock("@/lib/firebase/config", () => ({
  db: {},
  auth: {},
  storage: {},
}));

// Note: window.location mocking is handled in individual test files that need it
// because jsdom's location object has complex behavior that's hard to mock globally

// Suppress console errors during tests (optional - remove if you want to see errors)
// const originalError = console.error;
// beforeAll(() => {
//   console.error = (...args) => {
//     if (typeof args[0] === "string" && args[0].includes("Warning:")) {
//       return;
//     }
//     originalError.call(console, ...args);
//   };
// });
// afterAll(() => {
//   console.error = originalError;
// });
