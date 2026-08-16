import { betterAuth } from "better-auth";
import pg from "pg";
import { Mailer, resetPasswordMail, verifyEmailMail } from "@falorb/mailer";

/** Created once, lazily — constructing a transport per email would be wasteful. */
let sharedMailer: Mailer | undefined;
function mailer(): Mailer {
  sharedMailer ??= new Mailer();
  return sharedMailer;
}

/**
 * Whether a new account must confirm its address before it counts as real.
 *
 * This used to be `mailer().isConfigured` — verification switched itself off
 * whenever no mail provider was set. That is a fail-open default: a production
 * install that simply had not configured `RESEND_API_KEY` accepted unverified
 * addresses forever, and because invitation acceptance binds a seat to an
 * email address, an unverified account was enough to claim someone else's
 * invitation. (Both accept paths now check `emailVerified` independently, so
 * that specific escalation is closed twice over.)
 *
 * The default is now inverted: production requires verification unless
 * explicitly told otherwise, and refuses to start if that would lock everyone
 * out. Outside production it follows the mailer, so local development stays
 * frictionless.
 */
function requireVerification(): boolean {
  const override = process.env.FALORB_REQUIRE_EMAIL_VERIFICATION;
  if (override) return override === "true";

  if (process.env.NODE_ENV === "production") {
    if (!mailer().isConfigured) {
      throw new Error(
        "Email verification is required in production but no mail provider is configured. " +
          "Set RESEND_API_KEY (or SMTP_*), or set FALORB_REQUIRE_EMAIL_VERIFICATION=false to " +
          "accept unverified addresses deliberately.",
      );
    }
    return true;
  }

  return mailer().isConfigured;
}

/**
 * Authentication for dashboard users, shared by every app that needs to read a
 * session.
 *
 * This started life inside `apps/api`. It lives here now because the dashboard
 * also has to validate sessions, and it does so in server components — an HTTP
 * hop to the API for every render would be both slow and circular. Two
 * better-auth instances configured separately would drift on field mappings and
 * silently stop accepting each other's cookies, so there is one config and each
 * app supplies only its own `baseURL`.
 *
 * better-auth gets its own `pg` pool rather than sharing the application's
 * Drizzle connection. It costs a handful of connections and keeps better-auth's
 * schema expectations from coupling to the application's ORM version.
 *
 * This used to be justified by the workspace sitting on drizzle-orm 0.38 while
 * better-auth's adapter wanted ^0.45, with the upgrade judged not worth the
 * churn. That trade stopped being defensible once 0.38 carried a published SQL
 * injection advisory (patched in 0.45.2): a version pin held for convenience
 * becomes a liability the moment it has a CVE attached, and the workspace is
 * now on 0.45.2 throughout. The separate pool stays because the isolation is
 * worth having on its own merits, not because the versions have to differ.
 *
 * Field mapping is explicit because this schema uses snake_case columns while
 * better-auth's models are camelCase. Without it, every insert would fail on a
 * missing column.
 */

export interface AuthOptions {
  /** Origin this instance is mounted on, e.g. http://localhost:3000. */
  baseURL: string;
  /** Mount path. Both apps expose better-auth at /api/auth. */
  basePath?: string;
  connectionString?: string;
  secret?: string;
  trustedOrigins?: string[];
  /** Pool size. Small by default: this pool only serves auth. */
  maxConnections?: number;
}

export function createAuth(options: AuthOptions) {
  const pool = new pg.Pool({
    connectionString: options.connectionString ?? process.env.DATABASE_URL,
    max: options.maxConnections ?? 5,
  });

  return betterAuth({
    database: pool,
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    baseURL: options.baseURL,
    basePath: options.basePath ?? "/api/auth",

    emailAndPassword: {
      enabled: true,
      // Long enough to resist trivial guessing; better-auth hashes with scrypt.
      minPasswordLength: 10,
      maxPasswordLength: 256,
      /**
       * Verification is required only when email can actually be delivered.
       *
       * Hardcoding `true` would lock every new account out of any install that
       * has not configured SMTP, and hardcoding `false` would leave a
       * production deployment accepting unverified addresses forever. Deriving
       * it from whether a mailer exists makes the safe choice automatic in both
       * cases. `FALORB_REQUIRE_EMAIL_VERIFICATION` overrides either way.
       */
      requireEmailVerification: requireVerification(),
      autoSignIn: true,

      sendResetPassword: async ({ user, url }) => {
        await mailer().send(resetPasswordMail(user.email, url));
      },
    },

    emailVerification: {
      sendOnSignUp: mailer().isConfigured,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer().send(verifyEmailMail(user.email, url));
      },
    },

    /**
     * Brute-force protection.
     *
     * Left unconfigured, better-auth applies a generic 100-requests-per-minute
     * default and only in production, which is no obstacle at all to a
     * credential-stuffing run against `/sign-in/email`. The rules below are
     * per-path because the useful limits differ by two orders of magnitude:
     * a dashboard makes many session reads and a human makes very few sign-in
     * attempts.
     *
     * Storage is in-memory, which is correct for the single-replica topology
     * in `infra/docker-compose.production.yml` but does not survive a restart
     * and is not shared between instances. Scaling the API horizontally means
     * moving this to shared storage first, or the effective limit multiplies
     * by the replica count.
     */
    rateLimit: {
      /**
       * Disabled only when explicitly asked, for the end-to-end suite.
       *
       * The limits below are per IP: 5 sign-ups an hour, 5 sign-ins per five
       * minutes. A test run legitimately spends several of both — it registers
       * a fixture account and deliberately fails sign-ins to assert the error
       * path — so consecutive runs throttle themselves and fail on auth,
       * looking exactly like a broken dashboard. Opt out by origin, never by
       * NODE_ENV, so a misconfigured production cannot silently unlimit itself.
       */
      enabled: process.env.FALORB_AUTH_RATE_LIMIT !== "off",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 300, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/forget-password": { window: 3600, max: 5 },
        "/reset-password": { window: 3600, max: 5 },
        "/send-verification-email": { window: 3600, max: 5 },
      },
    },

    advanced: {
      /**
       * Without this, every rate-limit bucket keys on the reverse proxy's
       * address — one shared bucket for all users, which is simultaneously a
       * brute-force hole and a self-inflicted denial of service. Both proxies
       * in front of this (Caddy in `infra/Caddyfile`, Coolify's in the
       * production stack) overwrite `X-Forwarded-For` with the real peer, so
       * the header is trustworthy *here* and must not be forwarded from
       * anywhere else.
       */
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      useSecureCookies: process.env.NODE_ENV === "production",
    },

    session: {
      modelName: "session",
      /**
       * Seven days rather than thirty, refreshed daily. This console holds
       * behavioural data about a customer's visitors, so a stolen session
       * cookie is worth having; a month of validity makes that theft
       * effectively permanent.
       */
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      /**
       * One minute, not five. The cached cookie is what the dashboard's role
       * checks read, so this window is exactly how long a revoked session, a
       * removed member or a demoted admin keeps their old privileges.
       */
      cookieCache: { enabled: true, maxAge: 60 },
      fields: {
        expiresAt: "expires_at",
        userId: "user_id",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    trustedOrigins: options.trustedOrigins ?? defaultTrustedOrigins(),

    user: {
      modelName: "user",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      modelName: "account",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    // Ids are generated by better-auth, not the database: `user.id` and friends
    // are plain `text` columns with no default, so leaving generation to
    // Postgres would insert nulls.
  });
}

export function defaultTrustedOrigins(): string[] {
  return (process.env.FALORB_TRUSTED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
