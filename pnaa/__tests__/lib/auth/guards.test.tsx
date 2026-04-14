/**
 * Unit Tests for auth/guards.tsx
 *
 * These components protect routes based on authentication status and user roles.
 *
 * RequireAuth:
 * - Shows loading skeleton while auth state is loading
 * - Redirects to /signin if user is not authenticated
 * - Renders children if user is authenticated
 *
 * RequireRole:
 * - Renders children if user has one of the required roles
 * - Redirects to /dashboard if user lacks required role
 */

import { render, screen, waitFor } from "@testing-library/react";
import { RequireAuth, RequireRole } from "@/lib/auth/guards";

// Mock the router
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock the auth context
const mockUseAuthContext = jest.fn();
jest.mock("@/lib/auth/context", () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

// Mock the Skeleton component (we just need to know it renders)
jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

describe("RequireAuth", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseAuthContext.mockReset();
  });

  it("shows loading skeleton when isLoading is true", () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    // Should show skeletons
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    // Should not show protected content
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("redirects to /signin when not authenticated", async () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/signin");
    });

    // Should not render children
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("renders children when authenticated", () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not redirect while still loading", () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    // Should not redirect yet - still loading
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("RequireRole", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseAuthContext.mockReset();
  });

  it("renders children when user has the required role", () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: false,
      user: { role: "national_admin" },
    });

    render(
      <RequireRole roles={["national_admin"]}>
        <div>Admin Only Content</div>
      </RequireRole>
    );

    expect(screen.getByText("Admin Only Content")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("renders children when user has one of multiple allowed roles", () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: false,
      user: { role: "chapter_admin" },
    });

    render(
      <RequireRole roles={["national_admin", "region_admin", "chapter_admin"]}>
        <div>Admin Only Content</div>
      </RequireRole>
    );

    expect(screen.getByText("Admin Only Content")).toBeInTheDocument();
  });

  it("redirects to /dashboard when user lacks required role", async () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: false,
      user: { role: "member" },
    });

    render(
      <RequireRole roles={["national_admin"]}>
        <div>Admin Only Content</div>
      </RequireRole>
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });

    // Should not render children
    expect(screen.queryByText("Admin Only Content")).not.toBeInTheDocument();
  });

  it("returns null when user is null", () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: false,
      user: null,
    });

    render(
      <RequireRole roles={["national_admin"]}>
        <div>Admin Only Content</div>
      </RequireRole>
    );

    expect(screen.queryByText("Admin Only Content")).not.toBeInTheDocument();
  });

  it("returns null while loading", () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: true,
      user: { role: "national_admin" },
    });

    render(
      <RequireRole roles={["national_admin"]}>
        <div>Admin Only Content</div>
      </RequireRole>
    );

    // Should not render anything while loading
    expect(screen.queryByText("Admin Only Content")).not.toBeInTheDocument();
    // And should not redirect yet
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("handles region_admin role correctly", () => {
    mockUseAuthContext.mockReturnValue({
      isLoading: false,
      user: { role: "region_admin" },
    });

    render(
      <RequireRole roles={["national_admin", "region_admin"]}>
        <div>Admin Content</div>
      </RequireRole>
    );

    expect(screen.getByText("Admin Content")).toBeInTheDocument();
  });
});
