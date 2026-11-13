/**
 * Fleet fork: orchestrator chats. The stock server has no field for a chat's
 * role, so the title carries it: a chat whose title starts with "⌘" is an
 * orchestrator. Titles sync to every device, and an agent can set its own with
 * t3_thread_update, so no server change is needed.
 */
const ORCHESTRATOR_TITLE_PREFIX = "⌘ ";

export function isOrchestratorTitle(title: string): boolean {
  return title.trimStart().startsWith("⌘");
}

/** The title without the marker, for places that already show the role. */
export function orchestratorDisplayTitle(title: string): string {
  return isOrchestratorTitle(title)
    ? title.trimStart().slice(1).trimStart() || "Orchestrator"
    : title;
}

/** The title after turning the role on or off. */
export function toggleOrchestratorTitle(title: string): string {
  return isOrchestratorTitle(title)
    ? orchestratorDisplayTitle(title)
    : `${ORCHESTRATOR_TITLE_PREFIX}${title.trim()}`;
}

/** One line of the orchestrator's latest reply, for its Command card. */
export function orchestratorDigestLine(text: string | null | undefined, max = 160): string | null {
  if (!text) return null;
  const line = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length === 0) return null;
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
