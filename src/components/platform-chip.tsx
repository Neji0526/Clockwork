import { Chrome, Monitor } from "lucide-react";

export type SourceLike = { source?: string | null; platform?: string | null } | null | undefined;

const PLATFORM_LABEL: Record<string, string> = {
  chrome: "Chrome",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

/** Small inline chip showing where a row was recorded: Browser vs Desktop · OS. */
export function PlatformChip({ row, size = "sm" }: { row: SourceLike; size?: "xs" | "sm" }) {
  const source = row?.source ?? "extension";
  const platform = row?.platform ?? "chrome";
  const isDesktop = source === "desktop";
  const Icon = isDesktop ? Monitor : Chrome;
  const text = isDesktop ? `Desktop · ${PLATFORM_LABEL[platform] ?? platform}` : "Browser";
  const cls = isDesktop
    ? "border-primary/30 bg-primary/10 text-primary"
    : "border-border bg-muted text-muted-foreground";
  const sz = size === "xs" ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${cls} ${sz} font-medium uppercase tracking-wider`}>
      <Icon className={size === "xs" ? "size-2.5" : "size-3"} />
      {text}
    </span>
  );
}
