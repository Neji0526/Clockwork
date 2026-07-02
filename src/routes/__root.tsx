import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/sonner";
import { BrandedNotFound, BrandedError } from "@/components/branded-boundaries";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ClockWork — Transparent time & work tracking for VAs" },
      { name: "description", content: "Transparent time tracking for virtual assistants. Capture work, surface insights, and turn repeated tasks into automatic SOPs." },
      { property: "og:title", content: "ClockWork — Transparent time & work tracking for VAs" },
      { property: "og:description", content: "Transparent time tracking for virtual assistants. Capture work, surface insights, and turn repeated tasks into automatic SOPs." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "ClockWork" },
      { property: "og:url", content: "https://clockwork.aiforbusiness.com/" },
      { property: "og:image", content: "https://clockwork.aiforbusiness.com/og-image.jpg" },
      { property: "og:image:width", content: "1216" },
      { property: "og:image:height", content: "640" },
      { property: "og:image:alt", content: "ClockWork — Transparent time tracking. Automatic SOPs." },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "ClockWork — Transparent time & work tracking for VAs" },
      { name: "twitter:description", content: "Transparent time tracking for virtual assistants. Capture work, surface insights, and turn repeated tasks into automatic SOPs." },
      { name: "twitter:image", content: "https://clockwork.aiforbusiness.com/og-image.jpg" },
      { name: "twitter:image:alt", content: "ClockWork — Transparent time tracking. Automatic SOPs." },

      { name: "theme-color", content: "#0f0f12" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "ClockWork" },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: BrandedNotFound,
  errorComponent: BrandedError,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
