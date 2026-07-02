import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";

/**
 * Vim-style leader navigation: press G, then H/S/I/T within 1.2s.
 * G H → home, G S → SOPs, G I → install, G T → team (admin only).
 * Ignores input/textarea/contenteditable focus.
 */
export function GoToNav() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const armedRef = useRef<number | null>(null);

  useEffect(() => {
    function isTyping(t: EventTarget | null) {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      const now = Date.now();
      const armed = armedRef.current && now - armedRef.current < 1200;
      if (armed) {
        armedRef.current = null;
        const isAdmin = profile?.role === "admin";
        const map: Record<string, string> = { h: isAdmin ? "/me" : "/", s: "/sops", i: "/install", t: "/admin", ",": "/settings" };
        const to = map[k];
        if (!to) return;
        if (to === "/admin" && !isAdmin) return;
        e.preventDefault();
        navigate({ to });
        return;
      }
      if (k === "g") armedRef.current = now;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, profile?.role]);

  return null;
}
