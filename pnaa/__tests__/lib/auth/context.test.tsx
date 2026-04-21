/**
 * Unit Tests for auth/context.tsx
 *
 * The AuthProvider component:
 * - Listens to Firebase auth state changes
 * - Fetches user document from Firestore when authenticated
 * - Provides isAuthenticated, isLoading, user, signIn, signOut
 *
 * Test Strategy:
 * - Mock Firebase auth's onAuthStateChanged
 * - Mock Firestore's getDoc
 * - Verify the context values update correctly
 *
 * Note: signIn and signOut tests that involve window.location.href
 * are skipped because jsdom's location object cannot be easily mocked.
 * These are better tested via E2E tests.
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import { AuthProvider, useAuthContext } from "@/lib/auth/context";

// Track the auth state callback so we can trigger auth changes
type MockFirebaseUser = { uid: string; email?: string } | null;
let authStateCallback: ((user: MockFirebaseUser) => void) | null = null;

// Mock Firebase Auth
jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (
    _auth: unknown,
    callback: (user: MockFirebaseUser) => void
  ) => {
    authStateCallback = callback;
    // Return unsubscribe function
    return () => {
      authStateCallback = null;
    };
  },
  signInWithCustomToken: jest.fn(),
  signOut: jest.fn().mockResolvedValue(undefined),
}));

// Mock Firestore
const mockGetDoc = jest.fn();
jest.mock("firebase/firestore", () => ({
  doc: jest.fn((_db: unknown, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

// Mock Firebase config
jest.mock("@/lib/firebase/config", () => ({
  auth: {},
  db: {},
}));

// Mock fetch for signOut
global.fetch = jest.fn().mockResolvedValue({ ok: true });

// Test component that consumes the context
function TestConsumer() {
  const { user, isLoading, isAuthenticated } = useAuthContext();

  return (
    <div>
      <div data-testid="isLoading">{String(isLoading)}</div>
      <div data-testid="isAuthenticated">{String(isAuthenticated)}</div>
      <div data-testid="userEmail">{user?.email || "none"}</div>
      <div data-testid="userRole">{user?.role || "none"}</div>
      <div data-testid="userUid">{user?.uid || "none"}</div>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    authStateCallback = null;
    mockGetDoc.mockReset();
    (global.fetch as jest.Mock).mockClear();
  });

  it("starts with isLoading true", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("isLoading").textContent).toBe("true");
    expect(screen.getByTestId("isAuthenticated").textContent).toBe("false");
  });

  it("sets isLoading false and user null when no Firebase user", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Simulate Firebase reporting no user
    await act(async () => {
      authStateCallback?.(null);
    });

    await waitFor(() => {
      expect(screen.getByTestId("isLoading").textContent).toBe("false");
      expect(screen.getByTestId("isAuthenticated").textContent).toBe("false");
      expect(screen.getByTestId("userEmail").textContent).toBe("none");
    });
  });

  it("fetches user from Firestore when Firebase user exists", async () => {
    const mockFirebaseUser = {
      uid: "test-uid-123",
      email: "test@example.com",
    };

    const mockUserData = {
      email: "test@example.com",
      displayName: "Test User",
      role: "chapter_admin",
      chapterName: "PNAA Chicago",
    };

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => mockUserData,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Simulate Firebase user sign in
    await act(async () => {
      authStateCallback?.(mockFirebaseUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId("isLoading").textContent).toBe("false");
      expect(screen.getByTestId("isAuthenticated").textContent).toBe("true");
      expect(screen.getByTestId("userEmail").textContent).toBe(
        "test@example.com"
      );
      expect(screen.getByTestId("userRole").textContent).toBe("chapter_admin");
      expect(screen.getByTestId("userUid").textContent).toBe("test-uid-123");
    });
  });

  it("sets user null if Firestore document does not exist", async () => {
    const mockFirebaseUser = {
      uid: "test-uid-123",
      email: "test@example.com",
    };

    mockGetDoc.mockResolvedValue({
      exists: () => false,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await act(async () => {
      authStateCallback?.(mockFirebaseUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId("isLoading").textContent).toBe("false");
      expect(screen.getByTestId("isAuthenticated").textContent).toBe("false");
      expect(screen.getByTestId("userEmail").textContent).toBe("none");
    });
  });

  it("handles Firestore error gracefully", async () => {
    const mockFirebaseUser = {
      uid: "test-uid-123",
      email: "test@example.com",
    };

    mockGetDoc.mockRejectedValue(new Error("Firestore error"));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await act(async () => {
      authStateCallback?.(mockFirebaseUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId("isLoading").textContent).toBe("false");
      // Should be not authenticated due to error
      expect(screen.getByTestId("isAuthenticated").textContent).toBe("false");
    });
  });

  it("includes uid in user object", async () => {
    const mockFirebaseUser = {
      uid: "unique-user-id-456",
      email: "user@example.com",
    };

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        email: "user@example.com",
        role: "member",
      }),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await act(async () => {
      authStateCallback?.(mockFirebaseUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId("userUid").textContent).toBe(
        "unique-user-id-456"
      );
    });
  });

  it("updates user when Firebase auth state changes", async () => {
    const firstUser = { uid: "user-1", email: "first@example.com" };
    const secondUser = { uid: "user-2", email: "second@example.com" };

    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ email: "first@example.com", role: "member" }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ email: "second@example.com", role: "national_admin" }),
      });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // First user signs in
    await act(async () => {
      authStateCallback?.(firstUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId("userEmail").textContent).toBe(
        "first@example.com"
      );
      expect(screen.getByTestId("userRole").textContent).toBe("member");
    });

    // Second user signs in (e.g., after signout/signin)
    await act(async () => {
      authStateCallback?.(secondUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId("userEmail").textContent).toBe(
        "second@example.com"
      );
      expect(screen.getByTestId("userRole").textContent).toBe("national_admin");
    });
  });
});

describe("useAuthContext", () => {
  it("returns default values when used outside provider", () => {
    // This should not throw, but return defaults
    const TestComponent = () => {
      const context = useAuthContext();
      return (
        <div data-testid="default-loading">{String(context.isLoading)}</div>
      );
    };

    render(<TestComponent />);

    // Default isLoading is true
    expect(screen.getByTestId("default-loading").textContent).toBe("true");
  });
});
