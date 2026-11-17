import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { ARTIFACT_PUBLISH_TOOL_NAME, ARTIFACT_READ_TOOL_NAME } from "@t3tools/shared/artifacts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const ArtifactId = Schema.String.check(Schema.isPattern(/^[a-z0-9]{12}$/)).annotate({
  description: "The id artifact_publish returned.",
});

const Row = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)).annotate({
    description: "Stable id, e.g. login-1. Keep ids across republishes so results stay.",
  }),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  detail: Schema.optional(
    Schema.String.check(Schema.isMaxLength(4000)).annotate({
      description: "Steps and the expected result.",
    }),
  ),
  group: Schema.optional(Schema.String.check(Schema.isMaxLength(120))),
});

const ArtifactReferenceSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(["sheet", "html"]),
  version: Schema.Int,
});

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ServerSettings.ServerSettingsService,
  HtmlRender.HtmlRender,
];

// This affects only the hub, not the workspace, so read-only sandboxes and plan mode may use it.
const ArtifactPublishTool = Tool.make(ARTIFACT_PUBLISH_TOOL_NAME, {
  description:
    "Publish a page the user fills in and you read back: a test sheet (rows, each marked Pass / Fail / Skip / Blocked with a note) or your own HTML. It shows inline in this thread and in the Review window, saves as the user works, and has a stable link for their phone or teammates. Pass `id` to update the same artifact in place; results for rows you keep survive. Use a sheet for test plans and checklists of any length. In HTML pages, `window.t3artifact` has `state`, `save(data)`, `submit(text, data)` and `onChange(fn)`; submit also sends the user's message to you. Don't restate the page in your reply.",
  parameters: Schema.Struct({
    id: Schema.optional(ArtifactId),
    title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    sheet: Schema.optional(
      Schema.Struct({
        intro: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
        rows: Schema.Array(Row).check(Schema.isMinLength(1), Schema.isMaxLength(300)),
      }),
    ),
    html: Schema.optional(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512_000)).annotate({
        description:
          "A complete, self-contained page, styled with the same theme variables as html_render. Give either sheet or html.",
      }),
    ),
  }),
  success: Schema.Struct({ artifact: ArtifactReferenceSchema, message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Publish artifact")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ArtifactReadTool = Tool.make(ARTIFACT_READ_TOOL_NAME, {
  description:
    "Read an artifact's current state: each sheet row's result, note, who set it and when (or an HTML page's saved data), submissions, and recent changes.",
  parameters: Schema.Struct({ id: ArtifactId }),
  success: Schema.Struct({
    artifact: ArtifactReferenceSchema,
    counts: Schema.optional(Schema.Record(Schema.String, Schema.Int)),
    rows: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          title: Schema.String,
          status: Schema.NullOr(Schema.String),
          note: Schema.NullOr(Schema.String),
          by: Schema.NullOr(Schema.String),
          at: Schema.NullOr(Schema.String),
        }),
      ),
    ),
    data: Schema.optional(Schema.Unknown),
    submissions: Schema.Array(
      Schema.Struct({ at: Schema.String, by: Schema.NullOr(Schema.String), text: Schema.String }),
    ),
    recentChanges: Schema.Array(
      Schema.Struct({ at: Schema.String, by: Schema.NullOr(Schema.String), change: Schema.String }),
    ),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read artifact")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const ArtifactToolkit = Toolkit.make(ArtifactPublishTool, ArtifactReadTool);
