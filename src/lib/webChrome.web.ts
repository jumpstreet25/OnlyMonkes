/**
 * Page-level fixes for the web app that react-native-web leaves to the host
 * page. Without them, phone Chrome felt glitchy:
 *  - the address bar showing/hiding resized `100%` layouts mid-scroll (dvh),
 *  - pulling down on the chat reloaded the page (overscroll-behavior),
 *  - every tap flashed a blue box (tap highlight),
 *  - text inputs drew the browser's white focus rectangle,
 *  - the keyboard covered the composer instead of resizing the page
 *    (interactive-widget=resizes-content).
 */
const CSS = `
html, body { height: 100%; height: 100dvh; background: #0A0A0F; overscroll-behavior: none; }
#root { height: 100%; height: 100dvh; }
* { -webkit-tap-highlight-color: transparent; }
input, textarea { outline: none; caret-color: #7c5cfc; }
[role="button"], [role="link"], [role="tab"] { -webkit-user-select: none; user-select: none; }
* { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent; }
`;

if (typeof document !== "undefined" && !document.getElementById("om-web-chrome")) {
  const style = document.createElement("style");
  style.id = "om-web-chrome";
  style.textContent = CSS;
  document.head.appendChild(style);

  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content");

  if (!document.querySelector('meta[name="theme-color"]')) {
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#0A0A0F";
    document.head.appendChild(theme);
  }
}

export {};
