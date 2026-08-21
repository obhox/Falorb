import { AI_PROVIDER_BASE_URLS, AI_PROVIDER_LABELS, type AiCredentials, type AiProvider } from "./credentials";

/**
 * The read-only half of an AI-gateway connection: is this key good, and
 * what can it call?
 *
 * Every other integration in `integration_connections` is reached through
 * its own client package (`@falorb/clay-client`, `@falorb/research`, ...)
 * exposing a `verifyConnection()` the connect/test actions call. The two AI
 * gateways get the same interface, but from inside `@falorb/ai` rather than
 * a package of their own — the request path, the base URLs, and the
 * provider fork already live here, and a separate package would only wrap
 * them.
 *
 * `listModels()` is what makes "bring your own model" usable rather than a
 * text box you have to guess into: OpenRouter's ids are public but there
 * are hundreds, and Ramp Router's are key-specific — its own docs say the
 * display names in its model table "are not necessarily valid `model`
 * values" and to read `GET /models` for the callable ids. So the model
 * picker asks the gateway rather than shipping a list that goes stale.
 */

export class AiGatewayError extends Error {}

export interface GatewayModel {
  id: string;
  /** Human label when the gateway supplies one, else the id. */
  name: string;
}

export interface VerifyResult {
  ok: boolean;
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export interface AiGatewayClientOptions {
  provider: AiProvider;
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
}

export class AiGatewayClient {
  private provider: AiProvider;
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: AiGatewayClientOptions) {
    this.provider = opts.provider;
    this.baseUrl = (opts.baseUrl ?? AI_PROVIDER_BASE_URLS[opts.provider]).replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static fromCredentials(credentials: AiCredentials): AiGatewayClient {
    return new AiGatewayClient({
      provider: credentials.provider,
      baseUrl: credentials.baseUrl,
      apiKey: credentials.apiKey,
    });
  }

  private async get(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const label = AI_PROVIDER_LABELS[this.provider];
      // 401 is the key; 403 is not. On Router a 403 means a provider is
      // unavailable, so reporting it as a bad key sends the reader off to
      // re-enter a credential that was fine all along.
      if (response.status === 401) throw new AiGatewayError(`${label} rejected the API key.`);
      if (response.status === 403) {
        throw new AiGatewayError(`${label} refused the request (403) — the key is recognised but not allowed to make it.`);
      }
      throw new AiGatewayError(`${label} returned HTTP ${response.status}.`);
    }
    return response.json();
  }

  /**
   * A reachability-and-key check, in the shape every other integration's
   * client returns.
   *
   * OpenRouter is checked against `GET /key` rather than `GET /models`
   * deliberately: its model list is public and answers 200 for a completely
   * invalid key, so verifying against it would report every typo as a
   * working connection. Ramp Router's `GET /models` is key-scoped — it
   * returns what *this* key may call — so there it is the right check.
   */
  async verifyConnection(): Promise<VerifyResult> {
    try {
      if (this.provider === "openrouter") {
        const payload = (await this.get("/key")) as { data?: { label?: string; limit?: number | null } };
        const label = payload.data?.label;
        return { ok: true, detail: label ? `OpenRouter key "${label}" is valid.` : "OpenRouter key is valid." };
      }

      const models = await this.listModels();
      return {
        ok: true,
        detail: models.length
          ? `Ramp Router key is valid — ${models.length} model${models.length === 1 ? "" : "s"} available.`
          : "Ramp Router key is valid, but no models are available to it.",
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error
            ? error.message
            : `Could not reach ${AI_PROVIDER_LABELS[this.provider]}.`,
      };
    }
  }

  /** The model ids this key can actually call, for the model picker. Both
   * gateways answer `GET /models` in OpenAI's `{ data: [...] }` shape. */
  async listModels(): Promise<GatewayModel[]> {
    const payload = (await this.get("/models")) as {
      data?: Array<{ id?: string; name?: string }>;
    };
    return (payload.data ?? [])
      .filter((m): m is { id: string; name?: string } => typeof m.id === "string" && m.id.length > 0)
      .map((m) => ({ id: m.id, name: m.name?.trim() || m.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
