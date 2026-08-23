import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.INTEGRATION_CREDENTIAL_ENC_KEY ??= "a".repeat(64);

const refreshAuthorization = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  refreshAuthorization: (...args: unknown[]) => refreshAuthorization(...args),
}));

const { encryptOAuthState, resolveOAuthAccessToken } = await import("./mcp-oauth");

function fakeDb(captured: { set?: Record<string, unknown> }) {
  return {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        captured.set = values;
        return { where: async () => undefined };
      },
    }),
  } as never;
}

beforeEach(() => {
  refreshAuthorization.mockReset();
});

describe("resolveOAuthAccessToken", () => {
  it("returns the cached token when it's not expired, without refreshing", async () => {
    const encrypted = encryptOAuthState({
      tokens: { access_token: "still-good", token_type: "bearer", expires_in: 3600, obtainedAt: Date.now() },
      clientInformation: { client_id: "client-1" },
      authorizationServerUrl: "https://as.example.com",
    });
    const captured: { set?: Record<string, unknown> } = {};

    const token = await resolveOAuthAccessToken(fakeDb(captured), {
      id: "row-1",
      url: "https://mcp.example.com",
      encryptedOAuth: encrypted.ciphertext,
      oauthIv: encrypted.iv,
      oauthAuthTag: encrypted.authTag,
    });

    expect(token).toBe("still-good");
    expect(refreshAuthorization).not.toHaveBeenCalled();
    expect(captured.set).toBeUndefined();
  });

  it("treats a token with no stated expires_in as valid indefinitely", async () => {
    const encrypted = encryptOAuthState({
      tokens: { access_token: "no-expiry-stated", token_type: "bearer", obtainedAt: Date.now() - 999_999_999 },
      clientInformation: { client_id: "client-1" },
      authorizationServerUrl: "https://as.example.com",
    });

    const token = await resolveOAuthAccessToken(fakeDb({}), {
      id: "row-1",
      url: "https://mcp.example.com",
      encryptedOAuth: encrypted.ciphertext,
      oauthIv: encrypted.iv,
      oauthAuthTag: encrypted.authTag,
    });

    expect(token).toBe("no-expiry-stated");
    expect(refreshAuthorization).not.toHaveBeenCalled();
  });

  it("refreshes and persists a new token when the stored one has expired", async () => {
    refreshAuthorization.mockResolvedValueOnce({
      access_token: "refreshed",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "same-refresh-token",
    });

    const encrypted = encryptOAuthState({
      tokens: {
        access_token: "expired",
        token_type: "bearer",
        expires_in: 60,
        refresh_token: "refresh-1",
        obtainedAt: Date.now() - 999_999,
      },
      clientInformation: { client_id: "client-1" },
      authorizationServerUrl: "https://as.example.com",
    });
    const captured: { set?: Record<string, unknown> } = {};

    const token = await resolveOAuthAccessToken(fakeDb(captured), {
      id: "row-1",
      url: "https://mcp.example.com",
      encryptedOAuth: encrypted.ciphertext,
      oauthIv: encrypted.iv,
      oauthAuthTag: encrypted.authTag,
    });

    expect(token).toBe("refreshed");
    expect(refreshAuthorization).toHaveBeenCalledWith(
      "https://as.example.com",
      expect.objectContaining({ refreshToken: "refresh-1", resource: new URL("https://mcp.example.com") }),
    );
    expect(captured.set).toBeDefined();
  });

  it("throws a clear, reconnect-pointing error when expired with no refresh token", async () => {
    const encrypted = encryptOAuthState({
      tokens: { access_token: "expired", token_type: "bearer", expires_in: 60, obtainedAt: Date.now() - 999_999 },
      clientInformation: { client_id: "client-1" },
      authorizationServerUrl: "https://as.example.com",
    });

    await expect(
      resolveOAuthAccessToken(fakeDb({}), {
        id: "row-1",
        url: "https://mcp.example.com",
        encryptedOAuth: encrypted.ciphertext,
        oauthIv: encrypted.iv,
        oauthAuthTag: encrypted.authTag,
      }),
    ).rejects.toThrow(/reconnect/i);
    expect(refreshAuthorization).not.toHaveBeenCalled();
  });

  it("throws when there's no stored OAuth credential at all", async () => {
    await expect(
      resolveOAuthAccessToken(fakeDb({}), {
        id: "row-1",
        url: "https://mcp.example.com",
        encryptedOAuth: null,
        oauthIv: null,
        oauthAuthTag: null,
      }),
    ).rejects.toThrow(/reconnect/i);
  });
});
