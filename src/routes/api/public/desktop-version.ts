import { createFileRoute } from "@tanstack/react-router";
import { DESKTOP_VERSION, MIN_DESKTOP_VERSION, DESKTOP_DOWNLOADS } from "@/lib/desktop-version";

// Public manifest the ClockWork Desktop (Electron) app polls every few hours to
// know whether the installed version is current. Mirrors the extension-version
// endpoint. No auth required — values are not sensitive and the app may run
// before the VA signs in.
export const Route = createFileRoute("/api/public/desktop-version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json(
          {
            latest: DESKTOP_VERSION,
            min: MIN_DESKTOP_VERSION,
            install_url: `${origin}/install`,
            // Absolute GitHub Release asset URLs (see src/lib/desktop-version.ts).
            downloads: {
              windows: DESKTOP_DOWNLOADS.windows,
              mac: DESKTOP_DOWNLOADS.mac,
              linux: DESKTOP_DOWNLOADS.linux,
            },
          },
          {
            headers: {
              "Cache-Control": "public, max-age=300",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
          },
        }),
    },
  },
});
