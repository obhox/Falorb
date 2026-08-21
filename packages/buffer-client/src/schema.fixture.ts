/**
 * A hand-built introspection response standing in for Buffer's live beta
 * schema, shared by this package's tests. It is deliberately shaped around
 * the mismatch that broke the first version of the client — `weeklyPostingLimit`
 * is an object rather than the `Int` the docs list, `channels` takes
 * `organizationId` rather than an `input` object, and `createPost` returns a
 * union — because those are the shapes CI has no key to discover for itself.
 */
import type { IntrospectionResult } from "./schema";

export const scalar = (name: string) => ({ kind: "SCALAR", name, ofType: null });
export const required = (name: string) => ({ kind: "NON_NULL", name: null, ofType: scalar(name) });
export const object = (name: string) => ({ kind: "OBJECT", name, ofType: null });
export const listOf = (name: string) => ({ kind: "LIST", name: null, ofType: object(name) });

export const INTROSPECTION: IntrospectionResult = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: { name: "Mutation" },
    types: [
      {
        kind: "OBJECT",
        name: "Query",
        fields: [
          {
            name: "channels",
            args: [{ name: "organizationId", type: required("OrganizationId") }],
            type: listOf("Channel"),
          },
          {
            name: "posts",
            args: [
              { name: "channelId", type: required("ChannelId") },
              { name: "status", type: scalar("PostStatus") },
              { name: "first", type: scalar("Int") },
              { name: "after", type: scalar("String") },
            ],
            type: object("PostConnection"),
          },
          { name: "account", args: [], type: object("Account") },
          { name: "post", args: [{ name: "id", type: required("PostId") }], type: object("Post") },
        ],
      },
      {
        kind: "OBJECT",
        name: "Mutation",
        fields: [
          {
            name: "createPost",
            args: [{ name: "input", type: { kind: "NON_NULL", name: null, ofType: { kind: "INPUT_OBJECT", name: "CreatePostInput", ofType: null } } }],
            type: { kind: "UNION", name: "CreatePostPayload", ofType: null },
          },
        ],
      },
      {
        kind: "OBJECT",
        name: "Account",
        fields: [
          { name: "id", args: [], type: required("AccountId") },
          { name: "email", args: [], type: scalar("String") },
          { name: "name", args: [], type: scalar("String") },
          { name: "organizations", args: [], type: listOf("Organization") },
        ],
      },
      {
        kind: "OBJECT",
        name: "Organization",
        fields: [
          { name: "id", args: [], type: required("OrganizationId") },
          { name: "name", args: [], type: scalar("String") },
        ],
      },
      {
        kind: "OBJECT",
        name: "Channel",
        fields: [
          { name: "id", args: [], type: required("ChannelId") },
          { name: "name", args: [], type: scalar("String") },
          { name: "service", args: [], type: scalar("String") },
          { name: "isDisconnected", args: [], type: scalar("Boolean") },
          { name: "weeklyPostingLimit", args: [], type: object("WeeklyPostingLimit") },
          { name: "posts", args: [], type: object("PostConnection") },
        ],
      },
      {
        kind: "OBJECT",
        name: "WeeklyPostingLimit",
        fields: [
          { name: "limit", args: [], type: scalar("Int") },
          { name: "remaining", args: [], type: scalar("Int") },
        ],
      },
      {
        kind: "OBJECT",
        name: "PostConnection",
        fields: [
          { name: "edges", args: [], type: listOf("PostEdge") },
          { name: "pageInfo", args: [], type: object("PageInfo") },
        ],
      },
      { kind: "OBJECT", name: "PostEdge", fields: [{ name: "node", args: [], type: object("Post") }] },
      { kind: "OBJECT", name: "PageInfo", fields: [{ name: "hasNextPage", args: [], type: scalar("Boolean") }] },
      {
        kind: "OBJECT",
        name: "Post",
        fields: [
          { name: "id", args: [], type: required("PostId") },
          { name: "text", args: [], type: scalar("String") },
          { name: "channel", args: [], type: object("Channel") },
        ],
      },
      {
        kind: "UNION",
        name: "CreatePostPayload",
        possibleTypes: [
          { kind: "OBJECT", name: "Post" },
          { kind: "OBJECT", name: "InvalidInputError" },
        ],
      },
      {
        kind: "OBJECT",
        name: "InvalidInputError",
        fields: [{ name: "message", args: [], type: scalar("String") }],
      },
      {
        kind: "INPUT_OBJECT",
        name: "CreatePostInput",
        inputFields: [
          { name: "channelId", type: required("ChannelId") },
          { name: "text", type: required("String") },
          { name: "dueAt", type: scalar("DateTime") },
          { name: "schedulingType", type: { kind: "ENUM", name: "SchedulingType", ofType: null } },
        ],
      },
      {
        kind: "ENUM",
        name: "SchedulingType",
        enumValues: [{ name: "SCHEDULED" }, { name: "DRAFT" }, { name: "NOW" }],
      },
    ],
  },
};
