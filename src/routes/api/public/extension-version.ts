import { createFileRoute } from "@tanstack/react-router";
import { EXTENSION_VERSION, MIN_EXTENSION_VERSION } from "@/lib/extension-version";

// Public manifest the Chrome extension polls every few hours to know whether
// the VA's installed version is current. No auth required — values are not
// sensitive and the extension may run before the VA signs in.
export const Route = createFileRoute("/api/public/extension-version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json(
          {
            latest: EXTENSION_VERSION,
            min: MIN_EXTENSION_VERSION,
            download_url: `${origin}/clockwork-extension.zip`,
            install_url: `${origin}/install`,
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
