/**
 * Unit Tests for use-auth.ts hooks
 *
 * These hooks wrap the AuthContext and provide convenient helpers
 * for checking user roles and accessing user data.
 *
 * Test Strategy:
 * - Mock the AuthContext with different user configurations
 * - Verify each hook returns the expected value
 */

import { renderHook } from "@testing-library/react";
import {
  useAuth,
  useIsNationalAdmin,
  useIsRegionAdmin,
  useIsAdmin,
  useUserChapter,
  useUserRegion,
} from "@/hooks/use-auth";

// We need to mock the context module to control what useAuthContext returns
const mockUseAuthContext = jest.fn();

jest.mock("@/lib/auth/context", () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

describe("use-auth hooks", () => {
  // Reset mock before each test
  beforeEach(() => {
    mockUseAuthContext.mockReset();
  });

  describe("useAuth", () => {
    it("returns the full auth context", () => {
      const mockContext = {
        user: { email: "test@example.com", role: "member" },
        isLoading: false,
        isAuthenticated: true,
      };
      mockUseAuthContext.mockReturnValue(mockContext);

      const { result } = renderHook(() => useAuth());

      expect(result.current).toEqual(mockContext);
    });
  });

  describe("useIsNationalAdmin", () => {
    it("returns true for national_admin role", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "national_admin" },
      });

      const { result } = renderHook(() => useIsNationalAdmin());

      expect(result.current).toBe(true);
    });

    it("returns false for region_admin role", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "region_admin" },
      });

      const { result } = renderHook(() => useIsNationalAdmin());

      expect(result.current).toBe(false);
    });

    it("returns false for chapter_admin role", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "chapter_admin" },
      });

      const { result } = renderHook(() => useIsNationalAdmin());

      expect(result.current).toBe(false);
    });

    it("returns false for member role", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "member" },
      });

      const { result } = renderHook(() => useIsNationalAdmin());

      expect(result.current).toBe(false);
    });

    it("returns false when user is null", () => {
      mockUseAuthContext.mockReturnValue({
        user: null,
      });

      const { result } = renderHook(() => useIsNationalAdmin());

      expect(result.current).toBe(false);
    });
  });

  describe("useIsRegionAdmin", () => {
    it("returns true for region_admin role", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "region_admin" },
      });

      const { result } = renderHook(() => useIsRegionAdmin());

      expect(result.current).toBe(true);
    });

    it("returns false for national_admin role", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "national_admin" },
      });

      const { result } = renderHook(() => useIsRegionAdmin());

      expect(result.current).toBe(false);
    });

    it("returns false for chapter_admin role", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "chapter_admin" },
      });

      const { result } = renderHook(() => useIsRegionAdmin());

      expect(result.current).toBe(false);
    });

    it("returns false when user is null", () => {
      mockUseAuthContext.mockReturnValue({
        user: null,
      });

      const { result } = renderHook(() => useIsRegionAdmin());

      expect(result.current).toBe(false);
    });
  });

  describe("useIsAdmin", () => {
    it("returns true for national_admin", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "national_admin" },
      });

      const { result } = renderHook(() => useIsAdmin());

      expect(result.current).toBe(true);
    });

    it("returns true for region_admin", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "region_admin" },
      });

      const { result } = renderHook(() => useIsAdmin());

      expect(result.current).toBe(true);
    });

    it("returns true for chapter_admin", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "chapter_admin" },
      });

      const { result } = renderHook(() => useIsAdmin());

      expect(result.current).toBe(true);
    });

    it("returns false for member", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "member" },
      });

      const { result } = renderHook(() => useIsAdmin());

      expect(result.current).toBe(false);
    });

    it("returns false when user is null", () => {
      mockUseAuthContext.mockReturnValue({
        user: null,
      });

      const { result } = renderHook(() => useIsAdmin());

      expect(result.current).toBe(false);
    });
  });

  describe("useUserChapter", () => {
    it("returns chapter name when user has a chapter", () => {
      mockUseAuthContext.mockReturnValue({
        user: { chapterName: "PNAA Chicago" },
      });

      const { result } = renderHook(() => useUserChapter());

      expect(result.current).toBe("PNAA Chicago");
    });

    it("returns undefined when user has no chapter", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "national_admin" }, // national admins may not have a chapter
      });

      const { result } = renderHook(() => useUserChapter());

      expect(result.current).toBeUndefined();
    });

    it("returns undefined when user is null", () => {
      mockUseAuthContext.mockReturnValue({
        user: null,
      });

      const { result } = renderHook(() => useUserChapter());

      expect(result.current).toBeUndefined();
    });
  });

  describe("useUserRegion", () => {
    it("returns region when user has a region", () => {
      mockUseAuthContext.mockReturnValue({
        user: { region: "Western" },
      });

      const { result } = renderHook(() => useUserRegion());

      expect(result.current).toBe("Western");
    });

    it("returns undefined when user has no region", () => {
      mockUseAuthContext.mockReturnValue({
        user: { role: "member" },
      });

      const { result } = renderHook(() => useUserRegion());

      expect(result.current).toBeUndefined();
    });

    it("returns undefined when user is null", () => {
      mockUseAuthContext.mockReturnValue({
        user: null,
      });

      const { result } = renderHook(() => useUserRegion());

      expect(result.current).toBeUndefined();
    });
  });
});
