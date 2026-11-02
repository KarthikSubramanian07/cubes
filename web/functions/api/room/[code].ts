/**
 * Pages Function: /api/room/:code
 *
 * The production path for room WebSockets. Validates the room code and the
 * upgrade header, then hands the request to that room's Durable Object in
 * the `playcubes-rooms` Worker (bound as ROOMS in web/wrangler.jsonc). Same
 * origin as the site, so no CORS or CSP exceptions.
 */

interface Env {
  ROOMS: DurableObjectNamespace;
}

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{5}$/;

export const onRequest: PagesFunction<Env, "code"> = async ({ request, env, params }) => {
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  if (!code || !ROOM_CODE.test(code)) {
    return new Response("bad room code", { status: 400 });
  }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected a websocket upgrade", {
      status: 426,
      headers: { Upgrade: "websocket" },
    });
  }
  return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
};
