/**
 * Introspection responses standing in for Buffer's API in this package's
 * tests, so CI — which has no Buffer key and can't reach `api.buffer.com` —
 * can still check the queries this client chooses to send.
 *
 * `INTROSPECTION` is trimmed from a real introspection of the live beta
 * schema (August 2026) and keeps the shapes that actually broke this client:
 *
 *   - every root field takes a single `input` object, and the organization id
 *     the query is scoped to is a required field *inside* it, not an argument
 *     of its own;
 *   - `posts` filters by `input.filter.channelIds` — a list, nested one level
 *     deeper than the flat `channelId` the docs suggest;
 *   - `weeklyPostingLimit` is an object (`{ limit, scheduled, sent }`), the
 *     mismatch that produced the original `GRAPHQL_VALIDATION_FAILED`;
 *   - `createPost` requires `assets`, `mode`, `needsApproval` and
 *     `schedulingType`, where `schedulingType` is automatic-vs-notification
 *     rather than queue-vs-draft, and answers with a union whose success
 *     member *wraps* the post (`PostActionSuccess { post }`).
 *
 * `FLAT_INTROSPECTION` is the older, hand-built shape — flat arguments, a
 * union of bare `Post`/`InvalidInputError` — kept because the client is meant
 * to serve either without a call site knowing which it's talking to.
 */
import type { IntrospectionResult, TypeRef } from "./schema";

const ref = (kind: string) => (name: string): TypeRef => ({ kind, name, ofType: null });
const scalarRef = ref("SCALAR");
const objectRef = ref("OBJECT");
const enumRef = ref("ENUM");
const inputRef = ref("INPUT_OBJECT");
const unionRef = ref("UNION");
const req = (type: TypeRef): TypeRef => ({ kind: "NON_NULL", name: null, ofType: type });
const list = (type: TypeRef): TypeRef => ({ kind: "LIST", name: null, ofType: type });

/** Legacy helpers, kept so the flat fixture below stays readable. */
export const scalar = (name: string) => scalarRef(name);
export const required = (name: string) => req(scalarRef(name));
export const object = (name: string) => objectRef(name);
export const listOf = (name: string) => list(objectRef(name));

const field = (name: string, type: TypeRef, args: { name: string; type: TypeRef }[] = []) => ({ name, args, type });
const inputField = (name: string, type: TypeRef) => ({ name, type });
const enumType = (name: string, values: string[]) => ({
  kind: "ENUM",
  name,
  enumValues: values.map((value) => ({ name: value })),
});
const errorType = (name: string) => ({
  kind: "OBJECT",
  name,
  fields: [field("message", req(scalarRef("String")))],
});

export const INTROSPECTION: IntrospectionResult = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: { name: "Mutation" },
    types: [
      {
        kind: "OBJECT",
        name: "Query",
        fields: [
          field("account", objectRef("Account")),
          field("channels", list(req(objectRef("Channel"))), [
            { name: "input", type: req(inputRef("ChannelsInput")) },
          ]),
          field("channel", objectRef("Channel"), [{ name: "input", type: req(inputRef("ChannelInput")) }]),
          field("posts", req(objectRef("PostsResults")), [
            { name: "after", type: scalarRef("String") },
            { name: "first", type: scalarRef("Int") },
            { name: "input", type: req(inputRef("PostsInput")) },
          ]),
          field("post", objectRef("Post"), [{ name: "input", type: req(inputRef("PostInput")) }]),
        ],
      },
      {
        kind: "OBJECT",
        name: "Mutation",
        fields: [
          field("createPost", req(unionRef("PostActionPayload")), [
            { name: "input", type: req(inputRef("CreatePostInput")) },
          ]),
          field("deletePost", req(unionRef("DeletePostPayload")), [
            { name: "input", type: req(inputRef("DeletePostInput")) },
          ]),
        ],
      },
      {
        kind: "OBJECT",
        name: "Account",
        fields: [
          field("id", req(scalarRef("ID"))),
          field("email", req(scalarRef("String"))),
          field("name", scalarRef("String")),
          field("timezone", scalarRef("String")),
          field("organizations", req(list(req(objectRef("Organization"))))),
        ],
      },
      {
        kind: "OBJECT",
        name: "Organization",
        fields: [
          field("id", req(scalarRef("OrganizationId"))),
          field("name", req(scalarRef("String"))),
          field("channelCount", req(scalarRef("Int"))),
        ],
      },
      {
        kind: "OBJECT",
        name: "Channel",
        fields: [
          field("id", req(scalarRef("ChannelId"))),
          field("name", req(scalarRef("String"))),
          field("displayName", scalarRef("String")),
          field("avatar", req(scalarRef("String"))),
          field("service", req(enumRef("Service"))),
          field("isDisconnected", req(scalarRef("Boolean"))),
          field("isQueuePaused", req(scalarRef("Boolean"))),
          field("timezone", req(scalarRef("String"))),
          field("organizationId", req(scalarRef("OrganizationId"))),
          field("weeklyPostingLimit", objectRef("WeeklyPostingLimit")),
          field("postingSchedule", req(list(req(objectRef("ScheduleV2"))))),
          field("postingGoal", objectRef("PostingGoal")),
          field("allowedActions", req(list(req(enumRef("ChannelAction"))))),
        ],
      },
      {
        kind: "OBJECT",
        name: "WeeklyPostingLimit",
        fields: [
          field("limit", req(scalarRef("Int"))),
          field("scheduled", req(scalarRef("Int"))),
          field("sent", req(scalarRef("Int"))),
        ],
      },
      {
        kind: "OBJECT",
        name: "ScheduleV2",
        fields: [
          field("day", req(enumRef("DayOfWeek"))),
          field("paused", req(scalarRef("Boolean"))),
          field("times", req(list(req(scalarRef("String"))))),
        ],
      },
      {
        kind: "OBJECT",
        name: "PostingGoal",
        fields: [
          field("goal", req(scalarRef("Int"))),
          field("periodEnd", req(scalarRef("DateTime"))),
          field("periodStart", req(scalarRef("DateTime"))),
          field("scheduledCount", req(scalarRef("Int"))),
          field("sentCount", req(scalarRef("Int"))),
        ],
      },
      {
        kind: "OBJECT",
        name: "Post",
        fields: [
          field("id", req(scalarRef("PostId"))),
          field("text", req(scalarRef("String"))),
          field("status", req(enumRef("PostStatus"))),
          field("schedulingType", enumRef("SchedulingType")),
          field("shareMode", req(enumRef("ShareMode"))),
          field("dueAt", scalarRef("DateTime")),
          field("sentAt", scalarRef("DateTime")),
          field("channelId", req(scalarRef("ChannelId"))),
          field("channel", req(objectRef("Channel"))),
          field("metrics", list(req(objectRef("PostMetric")))),
          field("metricsUpdatedAt", scalarRef("DateTime")),
          field("error", objectRef("PostPublishingError")),
          field("tags", req(list(req(objectRef("Tag"))))),
        ],
      },
      {
        kind: "OBJECT",
        name: "PostMetric",
        fields: [
          field("description", req(scalarRef("String"))),
          field("name", req(scalarRef("String"))),
          field("value", req(scalarRef("Float"))),
        ],
      },
      {
        kind: "OBJECT",
        name: "PostPublishingError",
        fields: [
          field("message", req(scalarRef("String"))),
          field("rawError", scalarRef("String")),
          field("supportUrl", scalarRef("String")),
        ],
      },
      {
        kind: "OBJECT",
        name: "Tag",
        fields: [
          field("id", req(scalarRef("TagId"))),
          field("name", req(scalarRef("String"))),
          field("color", req(scalarRef("String"))),
        ],
      },
      {
        kind: "OBJECT",
        name: "PostsResults",
        fields: [
          field("edges", list(req(objectRef("PostsEdge")))),
          field("pageInfo", req(objectRef("PaginationPageInfo"))),
        ],
      },
      {
        kind: "OBJECT",
        name: "PostsEdge",
        fields: [field("cursor", req(scalarRef("String"))), field("node", req(objectRef("Post")))],
      },
      {
        kind: "OBJECT",
        name: "PaginationPageInfo",
        fields: [
          field("endCursor", scalarRef("String")),
          field("hasNextPage", req(scalarRef("Boolean"))),
          field("hasPreviousPage", req(scalarRef("Boolean"))),
          field("startCursor", scalarRef("String")),
        ],
      },
      {
        kind: "UNION",
        name: "PostActionPayload",
        possibleTypes: [
          { kind: "OBJECT", name: "PostActionSuccess" },
          { kind: "OBJECT", name: "NotFoundError" },
          { kind: "OBJECT", name: "InvalidInputError" },
        ],
      },
      {
        kind: "OBJECT",
        name: "PostActionSuccess",
        fields: [field("post", req(objectRef("Post")))],
      },
      {
        kind: "UNION",
        name: "DeletePostPayload",
        possibleTypes: [
          { kind: "OBJECT", name: "DeletePostSuccess" },
          { kind: "OBJECT", name: "VoidMutationError" },
        ],
      },
      {
        kind: "OBJECT",
        name: "DeletePostSuccess",
        fields: [field("id", req(scalarRef("PostId")))],
      },
      errorType("NotFoundError"),
      errorType("InvalidInputError"),
      errorType("VoidMutationError"),
      {
        kind: "INPUT_OBJECT",
        name: "ChannelsInput",
        inputFields: [
          inputField("filter", inputRef("ChannelsFiltersInput")),
          inputField("organizationId", req(scalarRef("OrganizationId"))),
        ],
      },
      {
        kind: "INPUT_OBJECT",
        name: "ChannelsFiltersInput",
        inputFields: [
          inputField("isLocked", scalarRef("Boolean")),
          inputField("product", enumRef("Product")),
        ],
      },
      {
        kind: "INPUT_OBJECT",
        name: "ChannelInput",
        inputFields: [inputField("id", req(scalarRef("ChannelId")))],
      },
      {
        kind: "INPUT_OBJECT",
        name: "PostsInput",
        inputFields: [
          inputField("filter", inputRef("PostsFiltersInput")),
          inputField("organizationId", req(scalarRef("OrganizationId"))),
        ],
      },
      {
        kind: "INPUT_OBJECT",
        name: "PostsFiltersInput",
        inputFields: [
          inputField("channelIds", list(req(scalarRef("ChannelId")))),
          inputField("status", list(req(enumRef("PostStatus")))),
        ],
      },
      {
        kind: "INPUT_OBJECT",
        name: "PostInput",
        inputFields: [inputField("id", req(scalarRef("PostId")))],
      },
      {
        kind: "INPUT_OBJECT",
        name: "DeletePostInput",
        inputFields: [inputField("id", req(scalarRef("PostId")))],
      },
      {
        kind: "INPUT_OBJECT",
        name: "CreatePostInput",
        inputFields: [
          inputField("assets", req(list(req(inputRef("AssetInput"))))),
          inputField("channelId", req(scalarRef("ChannelId"))),
          inputField("dueAt", scalarRef("DateTime")),
          inputField("mode", req(enumRef("ShareMode"))),
          inputField("needsApproval", req(scalarRef("Boolean"))),
          inputField("saveToDraft", scalarRef("Boolean")),
          inputField("schedulingType", req(enumRef("SchedulingType"))),
          inputField("tagIds", list(req(scalarRef("TagId")))),
          inputField("text", scalarRef("String")),
        ],
      },
      {
        kind: "INPUT_OBJECT",
        name: "AssetInput",
        inputFields: [
          inputField("document", inputRef("DocumentAssetInput")),
          inputField("image", inputRef("ImageAssetInput")),
          inputField("video", inputRef("VideoAssetInput")),
        ],
      },
      enumType("ShareMode", ["addToQueue", "customScheduled", "shareNext", "shareNow"]),
      enumType("SchedulingType", ["automatic", "notification"]),
      enumType("PostStatus", ["draft", "error", "needs_approval", "scheduled", "sending", "sent"]),
      enumType("Service", ["bluesky", "facebook", "instagram", "linkedin", "startPage", "twitter"]),
      enumType("Product", ["analyze", "buffer", "engage", "publish", "startPage"]),
      enumType("DayOfWeek", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
      enumType("ChannelAction", ["viewChannel", "removeChannel", "publishStartPage"]),
      { kind: "SCALAR", name: "String" },
      { kind: "SCALAR", name: "Int" },
      { kind: "SCALAR", name: "Float" },
      { kind: "SCALAR", name: "Boolean" },
      { kind: "SCALAR", name: "ID" },
      { kind: "SCALAR", name: "DateTime" },
      { kind: "SCALAR", name: "ChannelId" },
      { kind: "SCALAR", name: "PostId" },
      { kind: "SCALAR", name: "OrganizationId" },
      { kind: "SCALAR", name: "TagId" },
    ],
  },
};

/**
 * The shape the first version of this client was written against: flat
 * arguments instead of an input object, and a union of bare `Post` and
 * `InvalidInputError`. Buffer's beta has moved on, but the client still has to
 * handle a schema like this — that tolerance is the whole point of building
 * queries from introspection.
 */
export const FLAT_INTROSPECTION: IntrospectionResult = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: { name: "Mutation" },
    types: [
      {
        kind: "OBJECT",
        name: "Query",
        fields: [
          field("channels", listOf("Channel"), [{ name: "organizationId", type: required("OrganizationId") }]),
          field("posts", object("PostConnection"), [
            { name: "channelId", type: required("ChannelId") },
            { name: "status", type: scalar("PostStatus") },
            { name: "first", type: scalar("Int") },
            { name: "after", type: scalar("String") },
          ]),
          field("account", object("Account")),
          field("post", object("Post"), [{ name: "id", type: required("PostId") }]),
        ],
      },
      {
        kind: "OBJECT",
        name: "Mutation",
        fields: [
          field("createPost", unionRef("CreatePostPayload"), [
            { name: "input", type: req(inputRef("CreatePostInput")) },
          ]),
        ],
      },
      {
        kind: "OBJECT",
        name: "Account",
        fields: [
          field("id", required("AccountId")),
          field("email", scalar("String")),
          field("name", scalar("String")),
          field("organizations", listOf("Organization")),
        ],
      },
      {
        kind: "OBJECT",
        name: "Organization",
        fields: [field("id", required("OrganizationId")), field("name", scalar("String"))],
      },
      {
        kind: "OBJECT",
        name: "Channel",
        fields: [
          field("id", required("ChannelId")),
          field("name", scalar("String")),
          field("service", scalar("String")),
          field("isDisconnected", scalar("Boolean")),
          field("weeklyPostingLimit", object("WeeklyPostingLimit")),
          field("posts", object("PostConnection")),
        ],
      },
      {
        kind: "OBJECT",
        name: "WeeklyPostingLimit",
        fields: [field("limit", scalar("Int")), field("remaining", scalar("Int"))],
      },
      {
        kind: "OBJECT",
        name: "PostConnection",
        fields: [field("edges", listOf("PostEdge")), field("pageInfo", object("PageInfo"))],
      },
      { kind: "OBJECT", name: "PostEdge", fields: [field("node", object("Post"))] },
      { kind: "OBJECT", name: "PageInfo", fields: [field("hasNextPage", scalar("Boolean"))] },
      {
        kind: "OBJECT",
        name: "Post",
        fields: [field("id", required("PostId")), field("text", scalar("String")), field("channel", object("Channel"))],
      },
      {
        kind: "UNION",
        name: "CreatePostPayload",
        possibleTypes: [
          { kind: "OBJECT", name: "Post" },
          { kind: "OBJECT", name: "InvalidInputError" },
        ],
      },
      errorType("InvalidInputError"),
      {
        kind: "INPUT_OBJECT",
        name: "CreatePostInput",
        inputFields: [
          inputField("channelId", required("ChannelId")),
          inputField("text", required("String")),
          inputField("dueAt", scalar("DateTime")),
          inputField("schedulingType", enumRef("SchedulingType")),
        ],
      },
      enumType("SchedulingType", ["SCHEDULED", "DRAFT", "NOW"]),
    ],
  },
};
