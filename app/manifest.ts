import type { MetadataRoute } from "next";

// Icons for home-screen and installed-site shortcuts only — no service worker,
// and display "browser" keeps shortcuts opening in a normal browser tab.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Polimatiq",
    short_name: "Polimatiq",
    start_url: "/",
    display: "browser",
    background_color: "#FFFFFF",
    theme_color: "#7C3AED",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
