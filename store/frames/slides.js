// Store screenshot scenes (1280x800). Crops are in raw screenshot pixels (1456x823).
const RAW = window.RAW_DIR || "../raw/en";
const icon = (d) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

window.SLIDES = {
  hero: {
    title: "Export any Komoot tour to <em>GPX</em>",
    sub: "Open a tour, add it to your list and download a clean GPX file for Garmin, Wahoo or any GPS app.",
    parts: [
      { type: "browser", img: `${RAW}/desktop-hero.jpg`, left: 300, top: 236, width: 940, url: "komoot.com/discover/Dolomites" },
      { type: "callout", img: `${RAW}/desktop-hero.jpg`, crop: window.CROPS?.hero || [23, 158, 360, 609], left: 56, top: 250, scale: 0.86 }
    ]
  },
  history: {
    title: "Every tour you open is <em>remembered</em>",
    sub: "The history keeps each tour, even when Komoot reopens it from its cache.",
    parts: [
      { type: "browser", img: `${RAW}/desktop-history.jpg`, left: 300, top: 236, width: 940, url: "komoot.com/discover/Dolomites" },
      { type: "callout", img: `${RAW}/desktop-history.jpg`, crop: window.CROPS?.history || [23, 158, 360, 609], left: 56, top: 250, scale: 0.86 }
    ]
  },
  addById: {
    title: "Add a tour by <em>ID or link</em>",
    sub: "Paste a komoot.com link or a tour ID. It is checked with Komoot before it lands in your list.",
    parts: [
      { type: "browser", img: `${RAW}/desktop-add-by-id.jpg`, left: 300, top: 236, width: 940, url: "komoot.com/discover/Dolomites" },
      { type: "callout", img: `${RAW}/desktop-add-by-id.jpg`, crop: window.CROPS?.addById || [535, 290, 400, 196], left: 56, top: 462, scale: 1.25 }
    ]
  },
  compact: {
    title: "Compact, <em>draggable</em>, out of your way",
    sub: "Collapse the panel to a slim bar and drag it anywhere. Position, state and tab are remembered.",
    parts: [
      { type: "browser", img: `${RAW}/desktop-collapsed.jpg`, left: 300, top: 236, width: 940, url: "komoot.com/discover/Dolomites" },
      { type: "callout", img: `${RAW}/desktop-collapsed.jpg`, crop: window.CROPS?.compact || [960, 710, 360, 57], left: 56, top: 640, scale: 1.3 }
    ]
  },
  mobile: {
    title: "Made for <em>mobile</em> too",
    sub: "Works on Firefox for Android with a touch-friendly panel that you can collapse and drag with a finger.",
    parts: [
      { type: "phone", img: `${RAW}/mobile-2.jpg`, left: 250, top: 262, width: 300, rotate: -5 },
      { type: "phone", img: `${RAW}/mobile-3.jpg`, left: 830, top: 262, width: 300, rotate: 5 },
      { type: "phone", img: `${RAW}/mobile-1.jpg`, left: 520, top: 228, width: 320, z: 2 }
    ]
  },
  features: {
    title: "Everything stays in <em>your browser</em>",
    sub: "No account, no tracking: GPX files are built locally from Komoot's own data.",
    parts: [
      {
        type: "features",
        items: [
          { icon: icon('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'), title: "One-click GPX", text: "GPX 1.1 with coordinates, elevation and time, ready for any GPS device or app." },
          { icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), title: "Automatic history", text: "Every tour you open is listed, so nothing is lost when Komoot uses its cache." },
          { icon: icon('<path d="M6 3h12v18l-6-4-6 4z"/>'), title: "Saved list", text: "Collect up to 40 tours, kept across reloads, and download them all at once." },
          { icon: icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), title: "Add by ID or link", text: "Paste a tour link or ID: editorial, smart and regular tours are supported." },
          { icon: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>'), title: "5 languages", text: "English, Italiano, Español, Deutsch and Français, following your browser." },
          { icon: icon('<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'), title: "Private by design", text: "No servers of ours, no analytics. Data stays in your browser's storage." }
        ]
      }
    ]
  }
};
