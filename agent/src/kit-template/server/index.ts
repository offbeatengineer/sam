import { Hono } from "hono";
import type { KitContext } from "../../../agent/src/kits-server";

export default function(ctx: KitContext): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, kitId: ctx.kitId }));

  return app;
}
