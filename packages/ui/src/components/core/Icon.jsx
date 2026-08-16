"use client";

import React from "react";
import { icons } from "lucide-react";

/**
 * The single wrapper over the icon set.
 *
 * The design system substituted Lucide for a real Falorb set and hydrated it
 * from a CDN sprite. That approach renders nothing on the server, so every
 * icon in a server-rendered table popped in a frame late. This resolves the
 * glyph at render time from the bundled `lucide-react` set instead — same
 * `name` API, same 1.5px stroke, but it is present in the first paint and
 * needs no external script.
 *
 * Names are kebab-case as in the design system (`chevron-down`); the package
 * exports PascalCase, so the lookup converts.
 */

const cache = new Map();

function resolve(name) {
  if (cache.has(name)) return cache.get(name);
  const pascal = String(name)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  const glyph = icons[pascal] ?? null;
  cache.set(name, glyph);
  return glyph;
}

export function Icon({ name, size = 16, strokeWidth = 1.5, color = "currentColor", style, ...rest }) {
  const Glyph = resolve(name);
  return (
    <span
      style={{ display: "inline-flex", width: size, height: size, flex: "0 0 auto", color, ...style }}
      {...rest}
    >
      {Glyph ? (
        <Glyph size={size} strokeWidth={strokeWidth} color={color} absoluteStrokeWidth />
      ) : null}
    </span>
  );
}
