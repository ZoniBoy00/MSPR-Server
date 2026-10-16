import { intParam } from "../context.js";
import type { Handler } from "../context.js";

// The server's event journal (admin only, see privacy.ts): game summaries and the latest events.

const diagnostics: Handler = (c) => {
  const q = c.url.searchParams;
  const limit = intParam(q, "limit", 200, 500) || 200;
  const kind = q.get("kind") ?? undefined;
  const iso = <T extends { t: number }>(e: T) => ({ ...e, time: new Date(e.t).toISOString() });
  c.json({ games: (c.diag?.list({ kind: "game.summary", limit: 50 }) ?? []).map(iso), events: (c.diag?.list({ limit, kind }) ?? []).map(iso) });
};

export const routes: Record<string, Handler> = { "/api/diagnostics": diagnostics };
