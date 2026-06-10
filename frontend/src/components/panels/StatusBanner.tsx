"use client";

/**
 * StatusBanner — surfaces analysis / separation / connectivity messages
 * (Req 3.5, 3.6, 12.6). Renders nothing when there is no message.
 */
export interface StatusBannerProps {
  message: string | null;
  tone?: "info" | "error";
}

export function StatusBanner({ message, tone = "info" }: StatusBannerProps) {
  if (!message) return null;
  const toneClass =
    tone === "error" ? "bg-red-600/80" : "bg-blue-600/80";
  return (
    <div
      role="status"
      className={`pointer-events-auto rounded-md ${toneClass} p-2 text-sm text-white`}
      data-testid="status-banner"
    >
      {message}
    </div>
  );
}
