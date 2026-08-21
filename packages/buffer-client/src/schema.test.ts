import { describe, expect, it } from "vitest";
import {
  BufferSchema,
  buildSelection,
  fieldsFromValidationErrors,
  filterInputObjects,
  inputValueForCandidates,
  isValidationError,
  pickEnumValue,
  planArgs,
  pruneWishes,
  requiresArgumentMatching,
  resultShape,
} from "./schema";
import { FLAT_INTROSPECTION, INTROSPECTION } from "./schema.fixture";

const schema = new BufferSchema(INTROSPECTION);
const flat = new BufferSchema(FLAT_INTROSPECTION);

describe("buildSelection", () => {
  it("expands an object-typed field into its subfields", () => {
    // The exact failure that broke the first client: `weeklyPostingLimit` is
    // a `WeeklyPostingLimit`, so selecting it bare is a validation error.
    const selection = buildSelection(schema, "Channel", ["id", "name", "weeklyPostingLimit"]);
    expect(selection).toBe("id name weeklyPostingLimit { limit scheduled sent }");
  });

  it("drops fields the schema doesn't have instead of failing the query", () => {
    expect(buildSelection(schema, "Channel", ["id", "nickname", "postingCadence"])).toBe("id");
  });

  it("never auto-walks into a paginated connection", () => {
    expect(buildSelection(flat, "Channel", ["id", "posts"])).toBe("id");
  });

  it("honours pinned subfields", () => {
    expect(buildSelection(schema, "Post", ["id", { name: "channel", subfields: ["id"] }])).toBe("id channel { id }");
  });

  it("returns an empty selection for an unknown type, so the caller can skip the field", () => {
    expect(buildSelection(schema, "Nope", ["id"])).toBe("");
  });
});

describe("planArgs", () => {
  it("folds flat values into the input object the live schema declares", () => {
    const plan = planArgs(
      schema.queryField("channels"),
      { organizationId: "org_1", input: { organizationId: "org_1" } },
      schema,
    );
    expect(plan.variableDefinitions).toBe("($input: ChannelsInput!)");
    expect(plan.argumentList).toBe("(input: $input)");
    expect(plan.variables).toEqual({ input: { organizationId: "org_1" } });
    expect(plan.missingRequired).toEqual([]);
  });

  it("names the required input field nothing could fill", () => {
    // `channels(input: {})` is what the client used to send when it had no
    // organization id — accepted as valid GraphQL, then rejected by Buffer.
    const plan = planArgs(schema.queryField("channels"), { input: {} }, schema);
    expect(plan.missingRequired).toEqual(["input.organizationId"]);
  });

  it("moves a channel filter into the nested filter object, as a list", () => {
    const plan = planArgs(
      schema.queryField("posts"),
      { channelIds: ["ch_1"], status: "scheduled", organizationId: "org_1", first: 100 },
      schema,
    );
    expect(plan.argumentList).toBe("(first: $first, input: $input)");
    expect(plan.variables.input).toEqual({
      filter: { channelIds: ["ch_1"], status: ["scheduled"] },
      organizationId: "org_1",
    });
  });

  it("drops a filter value the enum doesn't define rather than failing the query", () => {
    const plan = planArgs(
      schema.queryField("posts"),
      { channelIds: ["ch_1"], status: "pending_review", organizationId: "org_1" },
      schema,
    );
    expect(plan.variables.input).toEqual({ filter: { channelIds: ["ch_1"] }, organizationId: "org_1" });
  });

  it("still emits flat arguments for a schema that declares them", () => {
    const plan = planArgs(
      flat.queryField("channels"),
      // Written for the input-object spelling — silently ignored here.
      { organizationId: "org_1", input: { organizationId: "org_1" } },
      flat,
    );
    expect(plan.variableDefinitions).toBe("($organizationId: OrganizationId!)");
    expect(plan.argumentList).toBe("(organizationId: $organizationId)");
    expect(plan.variables).toEqual({ organizationId: "org_1" });
  });

  it("reports a required argument it has no value for", () => {
    expect(planArgs(flat.queryField("channels"), {}, flat).missingRequired).toEqual(["organizationId"]);
  });

  it("omits optional arguments that are absent", () => {
    const plan = planArgs(flat.queryField("posts"), { channelId: "ch_1", first: 100 }, flat);
    expect(plan.argumentList).toBe("(channelId: $channelId, first: $first)");
  });
});

describe("requiresArgumentMatching", () => {
  it("sees an organization required inside an input object", () => {
    expect(requiresArgumentMatching(schema, schema.queryField("channels"), /organization/i)).toBe(true);
    expect(requiresArgumentMatching(schema, schema.queryField("posts"), /organization/i)).toBe(true);
  });

  it("sees one required as a plain argument", () => {
    expect(requiresArgumentMatching(flat, flat.queryField("channels"), /organization/i)).toBe(true);
  });

  it("is false for a field that needs nothing", () => {
    expect(requiresArgumentMatching(schema, schema.queryField("account"), /organization/i)).toBe(false);
  });
});

describe("resultShape", () => {
  it("recognises a plain list", () => {
    expect(resultShape(schema, schema.queryField("channels"))).toEqual({ kind: "list", typeName: "Channel" });
  });

  it("recognises a Relay connection and its node type", () => {
    expect(resultShape(schema, schema.queryField("posts"))).toEqual({
      kind: "connection",
      typeName: "PostsResults",
      nodeTypeName: "Post",
      via: "edges",
    });
  });
});

describe("enum and input handling", () => {
  it("matches an enum member regardless of casing or separators", () => {
    expect(pickEnumValue(["SCHEDULED", "DRAFT"], ["scheduled", "queue"])).toBe("SCHEDULED");
    expect(pickEnumValue(["addToQueue"], ["add_to_queue"])).toBe("addToQueue");
    expect(pickEnumValue(["DRAFT"], ["now"])).toBeNull();
  });

  it("picks the enum member the schema defines for our intent", () => {
    expect(inputValueForCandidates(schema, "CreatePostInput", "mode", ["addToQueue", "queue"])).toBe("addToQueue");
    expect(inputValueForCandidates(schema, "CreatePostInput", "schedulingType", ["automatic"])).toBe("automatic");
  });

  it("returns null for an input field Buffer doesn't declare, so the caller omits it", () => {
    expect(inputValueForCandidates(flat, "CreatePostInput", "mode", ["queue"])).toBeNull();
  });

  it("falls back to the documented spelling when the schema is unknown", () => {
    expect(inputValueForCandidates(null, "CreatePostInput", "mode", ["queue", "addToQueue"])).toBe("queue");
  });

  it("strips input keys the mutation doesn't declare", () => {
    const filtered = filterInputObjects(flat, flat.mutationField("createPost"), {
      input: { channelId: "ch_1", text: "hello", mode: "queue", nonsense: 1 },
    });
    expect(filtered.input).toEqual({ channelId: "ch_1", text: "hello" });
  });
});

describe("validation-error recovery", () => {
  const errors = [
    {
      message:
        'Field "weeklyPostingLimit" of type "WeeklyPostingLimit" must have a selection of subfields. Did you mean "weeklyPostingLimit { ... }"?',
      extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
    },
  ];

  it("recognises a validation failure returned as HTTP 200", () => {
    expect(isValidationError(errors)).toBe(true);
    expect(isValidationError([{ message: "Rate limited" }])).toBe(false);
  });

  it("names the field Buffer refused", () => {
    expect(fieldsFromValidationErrors(errors)).toEqual(["weeklyPostingLimit"]);
    expect(fieldsFromValidationErrors([{ message: 'Cannot query field "postingGoal" on type "Channel".' }])).toEqual([
      "postingGoal",
    ]);
  });

  it("prunes the refused field at every level of the wish list", () => {
    const pruned = pruneWishes(
      ["id", "weeklyPostingLimit", { name: "channel", subfields: ["id", "weeklyPostingLimit"] }],
      ["weeklyPostingLimit"],
    );
    expect(pruned).toEqual(["id", { name: "channel", subfields: ["id"] }]);
  });
});
