// Just enough User-Agent parsing to label a login session ("Chrome on
// Windows"). Order matters: Edge and Opera also claim Chrome, Chrome also
// claims Safari, and iOS user agents also mention Mac OS X.
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export type DeviceKind = "mobile" | "desktop";

export function describeUserAgent(userAgent: string | null): { label: string; kind: DeviceKind } {
  const ua = userAgent ?? "";
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  const kind: DeviceKind = /Mobi|Android|iPhone|iPad|iPod/.test(ua) ? "mobile" : "desktop";

  if (browser && system) return { label: `${browser} on ${system}`, kind };
  if (browser || system) return { label: (browser ?? system)!, kind };
  return { label: "Unknown device", kind };
}
