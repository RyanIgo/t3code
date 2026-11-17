import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { artifactSheetHtml } from "@t3tools/shared/artifacts";
import { injectHtmlRenderBootstrap } from "@t3tools/shared/htmlRender";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ArtifactToolkit } from "./tools.ts";

const failure = (code: "invalid_request" | "orchestration_error", message: string) =>
  new OrchestratorMcpFailure({ code, message });

const NO_HUB =
  "No fleet hub is set for this machine. Open the hub's web app once while this machine is connected (it sets the address), or set T3_FLEET_HUB_URL.";

const hubUrl = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const configured =
    process.env.T3_FLEET_HUB_URL?.trim() ||
    (yield* settings.getSettings.pipe(
      Effect.map((value) => value.fleetHubUrl),
      Effect.orElseSucceed(() => ""),
    ));
  if (!configured) return yield* failure("invalid_request", NO_HUB);
  return yield* Effect.try({
    try: () => new URL(configured).origin,
    catch: () => failure("invalid_request", `The fleet hub address "${configured}" isn't a URL.`),
  });
});

const HubArtifact = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["sheet", "html"]),
  title: Schema.String,
  version: Schema.Int,
  rows: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))),
  state: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        rows: Schema.optional(
          Schema.Record(
            Schema.String,
            Schema.Struct({
              status: Schema.optional(Schema.String),
              note: Schema.optional(Schema.String),
              by: Schema.optional(Schema.NullOr(Schema.String)),
              at: Schema.optional(Schema.String),
            }),
          ),
        ),
        data: Schema.optional(Schema.Unknown),
      }),
    ),
  ),
  counts: Schema.optional(Schema.Record(Schema.String, Schema.Int)),
  submissions: Schema.optional(
    Schema.Array(
      Schema.Struct({ at: Schema.String, by: Schema.NullOr(Schema.String), text: Schema.String }),
    ),
  ),
  history: Schema.optional(
    Schema.Array(
      Schema.Struct({ at: Schema.String, by: Schema.NullOr(Schema.String), change: Schema.String }),
    ),
  ),
});

const HubSaved = Schema.Struct({ id: Schema.String, version: Schema.Int });

const requestHub = Effect.fn("ArtifactTools.requestHub")(
  function* (request: HttpClientRequest.HttpClientRequest) {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(request);
    if (response.status < 200 || response.status >= 300) {
      const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* Effect.fail(`it answered ${response.status}: ${text.slice(0, 300)}`);
    }
    return yield* response.json;
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeout(Duration.seconds(20)),
      Effect.provide(FetchHttpClient.layer),
      Effect.mapError((cause) =>
        failure(
          "orchestration_error",
          `Couldn't reach the fleet hub${typeof cause === "string" ? ` (${cause})` : ""}.`,
        ),
      ),
    ),
);

const callHub = <A, I>(request: HttpClientRequest.HttpClientRequest, schema: Schema.Codec<A, I>) =>
  requestHub(request).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(() =>
          failure("orchestration_error", "The fleet hub sent something this machine can't read."),
        ),
      ),
    ),
  );

const reference = (
  hub: string,
  artifact: Pick<typeof HubArtifact.Type, "id" | "kind" | "title" | "version">,
) => ({
  id: artifact.id,
  url: `${hub}/a/${artifact.id}`,
  title: artifact.title,
  kind: artifact.kind,
  version: artifact.version,
});

const handlers = {
  artifact_publish: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "artifact_publish");
      if ((input.sheet === undefined) === (input.html === undefined)) {
        return yield* failure("invalid_request", "Give either `sheet` or `html`, not both.");
      }
      const hub = yield* hubUrl;
      const kind = input.sheet ? ("sheet" as const) : ("html" as const);
      const htmlRender = yield* HtmlRender.HtmlRender;
      const html =
        input.html !== undefined
          ? injectHtmlRenderBootstrap(
              yield* htmlRender
                .prepare(input.html)
                .pipe(Effect.mapError((error) => failure("invalid_request", error.message))),
            )
          : artifactSheetHtml({
              title: input.title,
              ...(input.sheet?.intro ? { intro: input.sheet.intro } : {}),
            });
      const request = yield* (
        input.id
          ? HttpClientRequest.put(`${hub}/fleet/artifacts/${input.id}`)
          : HttpClientRequest.post(`${hub}/fleet/artifacts`)
      ).pipe(
        HttpClientRequest.bodyJson({
          kind,
          title: input.title,
          html,
          ...(input.sheet ? { rows: input.sheet.rows } : {}),
          thread: { environmentId: scope.environmentId, threadId: thread.threadId },
        }),
        Effect.mapError(() => failure("invalid_request", "This page couldn't be encoded.")),
      );
      const saved = yield* callHub(request, HubSaved);
      return {
        artifact: reference(hub, {
          id: saved.id,
          kind,
          title: input.title,
          version: saved.version,
        }),
        message: `Shown to the user above your reply. Link for their phone or teammates: ${hub}/a/${saved.id}. Read results with artifact_read; pass this id to update it in place.`,
      };
    }),
  ),
  artifact_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const hub = yield* hubUrl;
      const artifact = yield* callHub(
        HttpClientRequest.get(`${hub}/fleet/artifacts/${input.id}`),
        HubArtifact,
      );
      const rowState = artifact.state?.rows ?? {};
      return {
        artifact: reference(hub, artifact),
        ...(artifact.counts ? { counts: artifact.counts } : {}),
        ...(artifact.kind === "sheet"
          ? {
              rows: (artifact.rows ?? []).map((row) => {
                const state = rowState[row.id];
                return {
                  id: row.id,
                  title: row.title,
                  status: state?.status ?? null,
                  note: state?.note || null,
                  by: state?.by ?? null,
                  at: state?.at ?? null,
                };
              }),
            }
          : { data: artifact.state?.data ?? null }),
        submissions: (artifact.submissions ?? []).slice(-5),
        recentChanges: (artifact.history ?? []).slice(-20),
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof ArtifactToolkit.tools>;

export const layer = McpToolAccess.toLayer(ArtifactToolkit, handlers);
