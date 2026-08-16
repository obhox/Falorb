import React from "react";

/**
 * Thin wrapper over the Lucide CDN sprite. Renders <i data-lucide="…"> and asks
 * Lucide to hydrate it. Requires the Lucide UMD script on the page.
 */
export function Icon({ name, size = 16, strokeWidth = 1.5, color = "currentColor", style }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let cancelled = false;
    const hydrate = () => {
      if (cancelled || !window.lucide || !host) return;
      host.innerHTML = `<i data-lucide="${name}"></i>`;
      window.lucide.createIcons({
        nameAttr: "data-lucide",
        attrs: { width: size, height: size, "stroke-width": strokeWidth, stroke: color },
        root: host
      });
    };
    hydrate();
    if (!window.lucide) {
      const t = setInterval(() => { if (window.lucide) { hydrate(); clearInterval(t); } }, 60);
      return () => { cancelled = true; clearInterval(t); };
    }
    return () => { cancelled = true; };
  }, [name, size, strokeWidth, color]);
  return (
    <span
      ref={ref}
      style={{ display: "inline-flex", width: size, height: size, flex: "0 0 auto", color, ...style }}
    />
  );
}
