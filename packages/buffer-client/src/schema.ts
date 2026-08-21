/**
 * Schema-adaptive GraphQL query building for Buffer's API.
 *
 * Why this exists: the first cut of this client hardcoded selection sets and
 * argument shapes written from Buffer's docs rather than a live schema, and
 * the first real API key produced
 *
 *   Field "weeklyPostingLimit" of type "WeeklyPostingLimit" must have a
 *   selection of subfields.
 *
 * — i.e. a field the docs list flat is an object type in the live beta
 * schema. Buffer's GraphQL API is in beta and its shapes are still moving, so
 * rather than hardcoding a second guess, the client asks the API what it
 * actually exposes (`INTROSPECTION_QUERY`) once per client instance and
 * builds every selection set and argument list from the answer:
 *
 *   - a field that is a scalar/enum is selected bare;
 *   - a field that is an object gets its own scalar subfields expanded
 *     automatically (so `weeklyPostingLimit { … }` is correct whatever the
 *     subfields turn out to be called);
 *   - a field that is a union (Buffer's mutation payloads are
 *     `Post | InvalidInputError` shaped) gets `__typename` plus one inline
 *     fragment per member;
 *   - a field Buffer doesn't expose at all is dropped instead of failing the
 *     whole query;
 *   - arguments are emitted from the live signature, so `channels(organizationId:)`
 *     and `channels(input:)` both work without this package picking a side.
 *
 * Everything here is pure — it takes an introspection result and returns
 * strings — so the query planning is unit-testable without a Buffer account,
 * which matters because CI has no key and `api.buffer.com` is not reachable
 * from it.
 */

export interface TypeRef {
  kind: string;
  name: string | null;
  ofType?: TypeRef | null;
}

export interface IntrospectedArg {
  name: string;
  type: TypeRef;
}

export interface IntrospectedField {
  name: string;
  args?: IntrospectedArg[] | null;
  type: TypeRef;
}

export interface IntrospectedType {
  kind: string;
  name: string | null;
  fields?: IntrospectedField[] | null;
  inputFields?: { name: string; type: TypeRef }[] | null;
  enumValues?: { name: string }[] | null;
  possibleTypes?: { kind: string; name: string | null }[] | null;
}

export interface IntrospectionResult {
  __schema: {
    queryType?: { name: string } | null;
    mutationType?: { name: string } | null;
    types?: IntrospectedType[] | null;
  };
}

/**
 * Deliberately not the full spec introspection query: `description` is
 * dropped (the response is large enough already) and the type-ref fragment is
 * unrolled five deep, which covers every wrapper Buffer can put around a
 * named type (`[[Foo!]!]!` and shallower).
 */
export const INTROSPECTION_QUERY = `query FalorbBufferSchema {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind
      name
      fields(includeDeprecated: true) { name args { name type { ...Ref } } type { ...Ref } }
      inputFields { name type { ...Ref } }
      enumValues(includeDeprecated: true) { name }
      possibleTypes { kind name }
    }
  }
}
fragment Ref on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
}`;

export function namedTypeRef(ref: TypeRef | null | undefined): TypeRef | null {
  let current = ref ?? null;
  while (current && !current.name) current = current.ofType ?? null;
  return current;
}

export function renderTypeRef(ref: TypeRef | null | undefined): string {
  if (!ref) return "String";
  if (ref.kind === "NON_NULL") return `${renderTypeRef(ref.ofType)}!`;
  if (ref.kind === "LIST") return `[${renderTypeRef(ref.ofType)}]`;
  return ref.name ?? "String";
}

export function isRequired(ref: TypeRef | null | undefined): boolean {
  return ref?.kind === "NON_NULL";
}

/** True when the field returns a list, at any depth of non-null wrapping. */
export function isListRef(ref: TypeRef | null | undefined): boolean {
  let current = ref ?? null;
  while (current) {
    if (current.kind === "LIST") return true;
    if (current.name) return false;
    current = current.ofType ?? null;
  }
  return false;
}

/** An indexed introspection result: the questions the client actually asks. */
export class BufferSchema {
  readonly queryTypeName: string;
  readonly mutationTypeName: string | null;
  private readonly types = new Map<string, IntrospectedType>();

  constructor(result: IntrospectionResult) {
    this.queryTypeName = result.__schema?.queryType?.name ?? "Query";
    this.mutationTypeName = result.__schema?.mutationType?.name ?? null;
    for (const type of result.__schema?.types ?? []) {
      if (type?.name) this.types.set(type.name, type);
    }
  }

  type(name: string | null | undefined): IntrospectedType | null {
    return name ? (this.types.get(name) ?? null) : null;
  }

  typeOfRef(ref: TypeRef | null | undefined): IntrospectedType | null {
    return this.type(namedTypeRef(ref)?.name);
  }

  field(typeName: string | null | undefined, fieldName: string): IntrospectedField | null {
    return this.type(typeName)?.fields?.find((f) => f.name === fieldName) ?? null;
  }

  queryField(name: string): IntrospectedField | null {
    return this.field(this.queryTypeName, name);
  }

  mutationField(name: string): IntrospectedField | null {
    return this.field(this.mutationTypeName, name);
  }

  enumValues(typeName: string | null | undefined): string[] {
    return (this.type(typeName)?.enumValues ?? []).map((v) => v.name);
  }

  /** Null (rather than `[]`) when the input type isn't in the schema, so callers can tell "unknown" from "no fields". */
  inputFieldNames(typeName: string | null | undefined): string[] | null {
    const type = this.type(typeName);
    if (!type?.inputFields) return null;
    return type.inputFields.map((f) => f.name);
  }

  inputFieldType(typeName: string | null | undefined, fieldName: string): TypeRef | null {
    return this.type(typeName)?.inputFields?.find((f) => f.name === fieldName)?.type ?? null;
  }
}

/**
 * A field this client would like to read. A bare string auto-expands (scalars
 * bare, objects to their own scalars); the object form pins the subfields
 * when we care about specific ones.
 */
export type FieldWish = string | { name: string; subfields?: FieldWish[] };

export function wishName(wish: FieldWish): string {
  return typeof wish === "string" ? wish : wish.name;
}

/** A scalar or enum: selected bare, never expanded. */
function isLeafRef(ref: TypeRef | null | undefined): boolean {
  const named = namedTypeRef(ref);
  return named?.kind === "SCALAR" || named?.kind === "ENUM";
}

/** A field taking a required argument can't be auto-selected — we have nothing to pass. */
function requiresArgs(field: IntrospectedField): boolean {
  return (field.args ?? []).some((arg) => isRequired(arg.type));
}

const CONNECTION_TYPE = /Connection$/;

function autoSelect(
  schema: BufferSchema,
  type: IntrospectedType,
  depth: number,
  maxDepth: number,
  seen: Set<string>,
): string[] {
  if (!type.name || depth > maxDepth || seen.has(type.name)) return [];
  const nested = new Set(seen).add(type.name);

  if (type.kind === "UNION") {
    const parts = ["__typename"];
    for (const possible of type.possibleTypes ?? []) {
      const member = schema.type(possible?.name);
      if (!member) continue;
      const sub = autoSelect(schema, member, depth, maxDepth, nested);
      if (sub.length) parts.push(`... on ${member.name} { ${sub.join(" ")} }`);
    }
    return parts.length > 1 ? parts : [];
  }

  if (!type.fields?.length) return [];

  const parts: string[] = [];
  for (const field of type.fields) {
    if (requiresArgs(field)) continue;
    // The ref's own kind decides scalar-ness: a custom scalar (`ChannelId`,
    // `DateTime`) need not appear in the type list for us to select it bare.
    if (isLeafRef(field.type)) {
      parts.push(field.name);
      continue;
    }
    const target = schema.typeOfRef(field.type);
    if (!target) continue;
    // Never auto-walk into a paginated edge: that's a second query's worth of
    // data hiding inside a field we only wanted the shape of.
    if (target.name && CONNECTION_TYPE.test(target.name)) continue;
    if (depth >= maxDepth) continue;
    const sub = autoSelect(schema, target, depth + 1, maxDepth, nested);
    if (sub.length) parts.push(`${field.name} { ${sub.join(" ")} }`);
  }
  return parts;
}

function selectFields(
  schema: BufferSchema,
  typeName: string,
  wishes: FieldWish[],
  depth: number,
  maxDepth: number,
): string[] {
  const parts: string[] = [];
  for (const wish of wishes) {
    const name = wishName(wish);
    const field = schema.field(typeName, name);
    if (!field || requiresArgs(field)) continue;
    if (isLeafRef(field.type)) {
      parts.push(name);
      continue;
    }
    const target = schema.typeOfRef(field.type);
    if (!target) continue;
    const explicit = typeof wish === "object" ? wish.subfields : undefined;
    // A connection asked for by name alone is a second query's worth of rows;
    // the caller has to pin the subfields it wants.
    if (!explicit?.length && target.name && CONNECTION_TYPE.test(target.name)) continue;
    const sub = explicit?.length
      ? selectFields(schema, target.name ?? "", explicit, depth + 1, maxDepth)
      : autoSelect(schema, target, depth + 1, maxDepth, new Set([typeName]));
    if (sub.length) parts.push(`${name} { ${sub.join(" ")} }`);
  }
  return parts;
}

/**
 * The selection set for `typeName`, keeping only what the live schema has.
 * Returns "" when nothing survives — the caller must treat that as "don't ask
 * for this at all" rather than emitting `field { }`.
 */
export function buildSelection(
  schema: BufferSchema,
  typeName: string | null | undefined,
  wishes: FieldWish[],
  maxDepth = 2,
): string {
  if (!typeName || !schema.type(typeName)) return "";
  return selectFields(schema, typeName, wishes, 0, maxDepth).join(" ");
}

export interface ArgPlan {
  /** `($organizationId: OrganizationId!, $first: Int)`, or "" when the field takes nothing we can supply. */
  variableDefinitions: string;
  /** `(organizationId: $organizationId, first: $first)`, or "". */
  argumentList: string;
  variables: Record<string, unknown>;
  /** Required arguments the caller had no value for — the query would be invalid. */
  missingRequired: string[];
}

/**
 * Emits variables for exactly the arguments the live field declares, taking
 * values from `available` and ignoring keys Buffer doesn't know. This is what
 * lets one call site serve both `channels(organizationId:)` and
 * `channels(input:)`.
 */
export function planArgs(
  field: IntrospectedField | null | undefined,
  available: Record<string, unknown>,
): ArgPlan {
  const definitions: string[] = [];
  const args: string[] = [];
  const variables: Record<string, unknown> = {};
  const missingRequired: string[] = [];

  for (const arg of field?.args ?? []) {
    const value = available[arg.name];
    if (value === undefined || value === null) {
      if (isRequired(arg.type)) missingRequired.push(arg.name);
      continue;
    }
    definitions.push(`$${arg.name}: ${renderTypeRef(arg.type)}`);
    args.push(`${arg.name}: $${arg.name}`);
    variables[arg.name] = value;
  }

  return {
    variableDefinitions: definitions.length ? `(${definitions.join(", ")})` : "",
    argumentList: args.length ? `(${args.join(", ")})` : "",
    variables,
    missingRequired,
  };
}

const normalizeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Picks the enum member Buffer actually defines from a list of spellings we'd
 * accept — `["queue", "addToQueue", "QUEUE"]` — so intent ("put this in the
 * queue") survives the API renaming its enum members.
 */
export function pickEnumValue(values: string[], candidates: string[]): string | null {
  if (!values.length) return null;
  const index = new Map(values.map((value) => [normalizeName(value), value]));
  for (const candidate of candidates) {
    const exact = index.get(normalizeName(candidate));
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const needle = normalizeName(candidate);
    const loose = values.find((value) => {
      const hay = normalizeName(value);
      return hay.includes(needle) || needle.includes(hay);
    });
    if (loose) return loose;
  }
  return null;
}

export type ResultShape =
  | { kind: "list"; typeName: string }
  | { kind: "connection"; typeName: string; nodeTypeName: string; via: "edges" | "nodes" }
  | { kind: "object"; typeName: string }
  | null;

/** Whether a root field returns a plain list, a Relay connection, or a single object. */
export function resultShape(schema: BufferSchema, field: IntrospectedField | null): ResultShape {
  if (!field) return null;
  const target = schema.typeOfRef(field.type);
  if (!target?.name) return null;
  if (isListRef(field.type)) return { kind: "list", typeName: target.name };

  const edges = schema.field(target.name, "edges");
  if (edges) {
    const edgeType = schema.typeOfRef(edges.type);
    const node = edgeType?.name ? schema.field(edgeType.name, "node") : null;
    const nodeType = node ? schema.typeOfRef(node.type) : null;
    if (nodeType?.name) {
      return { kind: "connection", typeName: target.name, nodeTypeName: nodeType.name, via: "edges" };
    }
  }

  const nodes = schema.field(target.name, "nodes");
  if (nodes) {
    const nodeType = schema.typeOfRef(nodes.type);
    if (nodeType?.name) {
      return { kind: "connection", typeName: target.name, nodeTypeName: nodeType.name, via: "nodes" };
    }
  }

  return { kind: "object", typeName: target.name };
}

interface GraphQLErrorShape {
  message?: unknown;
  extensions?: { code?: unknown } | null;
}

/** A validation failure means the *query* was wrong, not the account — worth retrying with a smaller one. */
export function isValidationError(errors: unknown): boolean {
  if (!Array.isArray(errors)) return false;
  return errors.some((error: GraphQLErrorShape) => {
    if (error?.extensions?.code === "GRAPHQL_VALIDATION_FAILED") return true;
    const message = typeof error?.message === "string" ? error.message : "";
    return (
      /Cannot query field/i.test(message) ||
      /must have a selection of subfields/i.test(message) ||
      /must not have a selection/i.test(message) ||
      /Unknown argument/i.test(message) ||
      /Unknown type/i.test(message)
    );
  });
}

/**
 * The *field* names a validation failure blamed — deliberately not argument
 * names, which can collide with a field of the same name (`channelId` is
 * both, on some schemas) and would prune something we still need. Used to
 * drop the blamed fields and retry once, so one unexpected field can't cost a
 * whole sync — the exact failure mode this file was written for.
 */
export function fieldsFromValidationErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  const patterns = [
    /Cannot query field "([^"]+)"/gi,
    /Field "([^"]+)" of type "[^"]*" must have a selection of subfields/gi,
    /Field "([^"]+)" must not have a selection/gi,
  ];
  const names = new Set<string>();
  for (const error of errors as GraphQLErrorShape[]) {
    const message = typeof error?.message === "string" ? error.message : "";
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of message.matchAll(pattern)) if (match[1]) names.add(match[1]);
    }
  }
  return [...names];
}

/** Drops `names` from a wish list at every level. */
export function pruneWishes(wishes: FieldWish[], names: string[]): FieldWish[] {
  if (!names.length) return wishes;
  const drop = new Set(names);
  const prune = (list: FieldWish[]): FieldWish[] =>
    list
      .filter((wish) => !drop.has(wishName(wish)))
      .map((wish) =>
        typeof wish === "string" || !wish.subfields ? wish : { ...wish, subfields: prune(wish.subfields) },
      );
  return prune(wishes);
}

/**
 * Strips keys Buffer's input object doesn't declare. GraphQL rejects an
 * unknown input field outright, so sending "channelId, text, mode,
 * schedulingType" blind fails the whole mutation the moment one of them is
 * spelled differently — this keeps the ones that exist and drops the rest.
 * A value whose input type isn't in the schema is passed through untouched.
 */
export function filterInputObjects(
  schema: BufferSchema,
  field: IntrospectedField | null | undefined,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...variables };
  for (const arg of field?.args ?? []) {
    const value = out[arg.name];
    if (value === undefined || typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const typeName = namedTypeRef(arg.type)?.name;
    const declared = schema.inputFieldNames(typeName);
    if (!declared) continue;
    const allowed = new Set(declared);
    out[arg.name] = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([key, entry]) => allowed.has(key) && entry !== undefined),
    );
  }
  return out;
}

/**
 * The value to send for an input field whose spelling we only half know:
 * an enum member the schema actually defines, or — when the field is a plain
 * string, or the schema isn't known — the documented spelling. Null when
 * Buffer has no such input field at all, so the caller omits it.
 */
export function inputValueForCandidates(
  schema: BufferSchema | null,
  inputTypeName: string | null | undefined,
  fieldName: string,
  candidates: string[],
): string | null {
  if (!candidates.length) return null;
  const documented = candidates[0] ?? null;
  if (!schema || !inputTypeName || !schema.type(inputTypeName)) return documented;
  const declared = schema.inputFieldNames(inputTypeName);
  if (declared && !declared.includes(fieldName)) return null;
  const fieldType = schema.inputFieldType(inputTypeName, fieldName);
  const named = schema.typeOfRef(fieldType);
  if (named?.kind === "ENUM") return pickEnumValue(schema.enumValues(named.name), candidates);
  return documented;
}
