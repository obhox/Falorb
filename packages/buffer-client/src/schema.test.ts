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
  resultShape,
} from "./schema";
import { INTROSPECTION } from "./schema.fixture";

const schema = new BufferSchema(INTROSPECTION);

describe("buildSelection", () => {
  it("expands an object-typed field into its subfields", () => {
    // The exact failure that broke the first client: `weeklyPostingLimit` is
    // a `WeeklyPostingLimit`, so selecting it bare is a validation error.
    const selection = buildSelection(schema, "Channel", ["id", "name", "weeklyPostingLimit"]);
    expect(selection).toBe("id name weeklyPostingLimit { limit remaining }");
  });

  it("drops fields the schema doesn't have instead of failing the query", () => {
    expect(buildSelection(schema, "Channel", ["id", "postingGoal", "allowedActions"])).toBe("id");
  });

  it("never auto-walks into a paginated connection", () => {
    expect(buildSelection(schema, "Channel", ["id", "posts"])).toBe("id");
  });

  it("honours pinned subfields", () => {
    expect(buildSelection(schema, "Post", ["id", { name: "channel", subfields: ["id"] }])).toBe("id channel { id }");
  });

  it("returns an empty selection for an unknown type, so the caller can skip the field", () => {
    expect(buildSelection(schema, "Nope", ["id"])).toBe("");
  });
});

describe("planArgs", () => {
  it("emits only the arguments the live field declares", () => {
    const plan = planArgs(schema.queryField("channels"), {
      organizationId: "org_1",
      // Written for a schema that takes `channels(input:)` — silently ignored here.
      input: { organizationId: "org_1" },
    });
    expect(plan.variableDefinitions).toBe("($organizationId: OrganizationId!)");
    expect(plan.argumentList).toBe("(organizationId: $organizationId)");
    expect(plan.variables).toEqual({ organizationId: "org_1" });
    expect(plan.missingRequired).toEqual([]);
  });

  it("reports a required argument it has no value for", () => {
    expect(planArgs(schema.queryField("channels"), {}).missingRequired).toEqual(["organizationId"]);
  });

  it("omits optional arguments that are absent", () => {
    const plan = planArgs(schema.queryField("posts"), { channelId: "ch_1", first: 100 });
    expect(plan.argumentList).toBe("(channelId: $channelId, first: $first)");
  });
});

describe("resultShape", () => {
  it("recognises a plain list", () => {
    expect(resultShape(schema, schema.queryField("channels"))).toEqual({ kind: "list", typeName: "Channel" });
  });

  it("recognises a Relay connection and its node type", () => {
    expect(resultShape(schema, schema.queryField("posts"))).toEqual({
      kind: "connection",
      typeName: "PostConnection",
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
    expect(inputValueForCandidates(schema, "CreatePostInput", "schedulingType", ["draft"])).toBe("DRAFT");
  });

  it("returns null for an input field Buffer doesn't declare, so the caller omits it", () => {
    expect(inputValueForCandidates(schema, "CreatePostInput", "mode", ["queue"])).toBeNull();
  });

  it("falls back to the documented spelling when the schema is unknown", () => {
    expect(inputValueForCandidates(null, "CreatePostInput", "mode", ["queue", "addToQueue"])).toBe("queue");
  });

  it("strips input keys the mutation doesn't declare", () => {
    const filtered = filterInputObjects(schema, schema.mutationField("createPost"), {
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
