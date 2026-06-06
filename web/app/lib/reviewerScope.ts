import type { ReviewerScope } from "@/app/types/movie";

export function reviewerScopeFromSearchParams(searchParams: URLSearchParams): ReviewerScope {
  const groupId = Number(searchParams.get("groupId"));
  const reviewer = searchParams.get("reviewer")?.trim() || searchParams.get("handle")?.trim();
  const scope = searchParams.get("scope")?.trim();

  if (scope === "group" && Number.isInteger(groupId)) {
    return { type: "group", groupId };
  }
  if (reviewer) {
    return { type: "reviewer", reviewer };
  }
  return { type: "all" };
}

export function reviewerScopeFromBody(body: {
  scope?: unknown;
  groupId?: unknown;
  reviewer?: unknown;
  handle?: unknown;
  username?: unknown;
}): ReviewerScope {
  const groupId = typeof body.groupId === "number" ? body.groupId : NaN;
  const reviewer =
    typeof body.reviewer === "string"
      ? body.reviewer.trim()
      : typeof body.handle === "string"
        ? body.handle.trim()
        : typeof body.username === "string"
          ? body.username.trim()
          : "";

  if (body.scope === "group" && Number.isInteger(groupId)) {
    return { type: "group", groupId };
  }
  if (reviewer) {
    return { type: "reviewer", reviewer };
  }
  return { type: "all" };
}
