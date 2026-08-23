/**
 * OAuth for an arbitrary, user-connected remote MCP server — the
 * counterpart to `index.ts`'s bearer-token path, for servers that require
 * redirecting the user to their own site to authenticate (RFC 9728 +
 * RFC 8414/OIDC discovery, RFC 7591 dynamic client registration, OAuth 2.1
 * authorization-code + PKCE), per the MCP spec.
 *
 * Deliberately thin: the SDK's own `client/auth.js` already implements the
 * whole flow via `auth()`/`refreshAuthorization()`, driven by an
 * `OAuthClientProvider`. This module supplies exactly one provider
 * implementation, `StatefulOAuthProvider` — a plain, DB-agnostic snapshot
 * holder a caller seeds from persisted state and reads back afterwards to
 * persist again. It has no idea what a `mcpConnections` row or a Postgres
 * table is; that's `apps/web`'s and `@falorb/db`'s job.
 *
 * Two SDK behaviors this provider exists to satisfy, confirmed by reading
 * the SDK's `auth()` implementation rather than assuming from its types:
 *
 *   - `auth()` never validates a `state` parameter on the callback leg —
 *     state is only ever consulted while *building* the authorization URL.
 *     CSRF protection is entirely the caller's responsibility (the state
 *     value itself, and what it's looked up against).
 *
 *   - `auth()` throws if `clientInformation()` resolves to `undefined` when
 *     exchanging a code. The dynamically-registered client (and the PKCE
 *     code verifier) *must* survive the redirect out and back — there is no
 *     way to recover a connect attempt without persisting them somewhere
 *     between the two `auth()` calls.
 */

import {
  auth,
  refreshAuthorization,
  discoverOAuthServerInfo,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export { auth, refreshAuthorization, discoverOAuthServerInfo };
export type {
  OAuthClientProvider,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthDiscoveryState,
  OAuthTokens,
};

export interface OAuthProviderState {
  clientInformation?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
}

/**
 * An `OAuthClientProvider` that holds its state in memory, seeded from
 * `initial` and readable back via `snapshot()` — the caller is responsible
 * for encrypting and persisting that snapshot between the "start" and
 * "callback" legs of a connect, and again whenever a refresh updates the
 * tokens.
 *
 * Always registers as a public client (`token_endpoint_auth_method:
 * "none"`, PKCE): this connector serves arbitrarily many organizations
 * connecting to arbitrarily many third-party servers, so there is no safe
 * way to hold one shared confidential-client secret across all of them —
 * the same shape used by e.g. Claude's and ChatGPT's own MCP connectors.
 *
 * `redirectToAuthorization` does not navigate anywhere — there is no
 * browser on this side of the call. It just records the URL the caller
 * must send the user's browser to, via `lastAuthorizationUrl`.
 */
export class StatefulOAuthProvider implements OAuthClientProvider {
  private readonly state_: OAuthProviderState;
  private authorizationUrl: URL | null = null;

  constructor(
    private readonly opts: {
      redirectUrl: string;
      /** Reused by the caller as the OAuth `state` param — see the module doc comment. */
      state: string;
      initial?: OAuthProviderState;
    },
  ) {
    this.state_ = { ...opts.initial };
  }

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.opts.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Falorb",
    };
  }

  state(): string {
    return this.opts.state;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return this.state_.clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    this.state_.clientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this.state_.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.state_.tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.state_.codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.state_.codeVerifier) {
      throw new Error("No PKCE code verifier — this connect attempt is missing or expired.");
    }
    return this.state_.codeVerifier;
  }

  saveDiscoveryState(discoveryState: OAuthDiscoveryState): void {
    this.state_.discoveryState = discoveryState;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.state_.discoveryState;
  }

  /** Set only after `auth()` returns `'REDIRECT'` — where to send the user's browser. */
  get lastAuthorizationUrl(): URL | null {
    return this.authorizationUrl;
  }

  /** The current state, for the caller to encrypt and persist. */
  snapshot(): OAuthProviderState {
    return { ...this.state_ };
  }
}
