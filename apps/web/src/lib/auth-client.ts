"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth. Base URL is relative on purpose: the handler is mounted
 * on this same origin, so the cookie is first-party and no cross-site
 * exemption is needed.
 */
export const authClient = createAuthClient({ basePath: "/api/auth" });

export const { signIn, signUp, signOut, useSession } = authClient;
