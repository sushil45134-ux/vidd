import { createFileRoute } from "@tanstack/react-router";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";

const ADMIN_EMAIL = "sushil45134@gmail.com";
const ADMIN_PASSWORD = "rajaji00";
const AUTH_COOKIE = "vid_admin";
const AUTH_TOKEN = "vid_auth_a7x9k2m4p8q1";

export const Route = createFileRoute("/api/auth")({
  server: {
    handlers: {
      GET: () => {
        const token = getCookie(AUTH_COOKIE);
        return Response.json({ isAdmin: token === AUTH_TOKEN });
      },
      POST: async ({ request }) => {
        try {
          const { email, password } = (await request.json()) as {
            email?: string;
            password?: string;
          };
          if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            setCookie(AUTH_COOKIE, AUTH_TOKEN, {
              httpOnly: true,
              secure: true,
              sameSite: "none",
              path: "/",
              maxAge: 60 * 60 * 24 * 7,
            });
            return Response.json({ ok: true });
          }
          return Response.json(
            { error: "Invalid email or password" },
            { status: 401 }
          );
        } catch {
          return Response.json({ error: "Login failed" }, { status: 500 });
        }
      },
      DELETE: () => {
        deleteCookie(AUTH_COOKIE, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          path: "/",
        });
        return Response.json({ ok: true });
      },
    },
  },
});
