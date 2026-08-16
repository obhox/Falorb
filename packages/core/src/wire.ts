import { z } from "zod";
import { MAX_BATCH_SIZE, MAX_PROPS_BYTES } from "./events";

/**
 * The tracker -> ingest wire format.
 *
 * Keys are deliberately one or two characters. A typical batch is 3-8 events
 * and every byte is paid for by the visitor's connection, so verbose keys like
 * `"timestamp"` would add real weight at the tail of the request. The mapping
 * to readable names happens exactly once, server-side, in `decodeEvent`.
 *
 * This schema is a public contract: an old tracker cached in a browser for a
 * year must still be accepted. Only ever add optional fields — never rename or
 * repurpose an existing key.
 */

/** A custom property value. Deliberately narrow — no nested objects. */
const propValue = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const propsSchema = z
  .record(z.string().max(128), propValue)
  .refine(
    (p) => JSON.stringify(p).length <= MAX_PROPS_BYTES,
    { message: `properties exceed ${MAX_PROPS_BYTES} bytes` },
  );

export const wireEventSchema = z.object({
  /** name */
  n: z.string().min(1).max(128),
  /** client timestamp, epoch ms */
  t: z.number().int().positive(),
  /** full url */
  u: z.string().max(2048).optional(),
  /** referrer */
  r: z.string().max(2048).optional(),
  /** document title */
  ti: z.string().max(512).optional(),
  /** custom properties */
  p: propsSchema.optional(),
  /** duration in ms — time on page for $pageleave, session length for $session_end */
  du: z.number().int().nonnegative().max(86_400_000).optional(),
  /** revenue amount */
  rv: z.number().finite().optional(),
  /** ISO-4217 currency */
  cu: z.string().length(3).optional(),
});

export type WireEvent = z.infer<typeof wireEventSchema>;

export const wireBatchSchema = z.object({
  /** project public key */
  k: z.string().min(8).max(64),
  /** device id — first-party, generated client-side */
  d: z.string().min(8).max(64),
  /** session id */
  s: z.string().min(8).max(64),
  /** identified user id, present once `identify()` has been called */
  i: z.string().max(256).optional(),
  /** identity traits, sent alongside an $identify event */
  tr: z.record(z.string().max(128), propValue).optional(),
  /** tracker version, for debugging field reports */
  v: z.string().max(16).optional(),
  /** screen width / height */
  sw: z.number().int().nonnegative().max(65535).optional(),
  sh: z.number().int().nonnegative().max(65535).optional(),
  /** viewport width / height */
  vw: z.number().int().nonnegative().max(65535).optional(),
  vh: z.number().int().nonnegative().max(65535).optional(),
  /** IANA timezone reported by the browser */
  tz: z.string().max(64).optional(),
  /** browser language */
  l: z.string().max(35).optional(),
  /**
   * Cross-domain link token, present when the visitor arrived via a decorated
   * link from another of the org's own domains. Drives identity stitching
   * across first-party properties without any third-party cookie.
   */
  xl: z.string().max(128).optional(),
  /**
   * Consent state: 1 granted, 0 withdrawn, absent if the site never asked.
   * Absent is deliberately distinct from 0 — under opt-in the server must not
   * read a silent older tracker as permission.
   */
  c: z.union([z.literal(0), z.literal(1)]).optional(),
  /** events */
  e: z.array(wireEventSchema).min(1).max(MAX_BATCH_SIZE),
});

export type WireBatch = z.infer<typeof wireBatchSchema>;
