export interface ClientEnvironment {
  browserFamily: string;
  browserMajorVersion: string | null;
  operatingSystem: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  touchPoints: number;
}

export function readCompatibilityIssues(): string[] {
  const issues: string[] = [];
  if (!window.isSecureContext) issues.push("必須使用 HTTPS 網址，否則無法安全建立研究資料");
  if (!("indexedDB" in window)) issues.push("瀏覽器不支援本機 session 暫存");
  if (!globalThis.crypto?.subtle) issues.push("瀏覽器不支援 SHA-256 資料完整性檢查");
  if (!("WebAssembly" in window)) issues.push("瀏覽器不支援臉部特徵模型所需的 WebAssembly");
  const videoPrototype = HTMLVideoElement.prototype as HTMLVideoElement & {
    requestVideoFrameCallback?: unknown;
  };
  if (typeof videoPrototype.requestVideoFrameCallback !== "function") {
    issues.push("瀏覽器不支援精確影片影格時間；請更新 Safari、Chrome 或 Edge");
  }
  return issues;
}

export function readClientEnvironment(): ClientEnvironment {
  const userAgent = navigator.userAgent;
  const browser = parseBrowser(userAgent);
  return {
    browserFamily: browser.family,
    browserMajorVersion: browser.majorVersion,
    operatingSystem: parseOperatingSystem(userAgent),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: Number(window.devicePixelRatio.toFixed(2)),
    touchPoints: navigator.maxTouchPoints || 0,
  };
}

function parseBrowser(userAgent: string) {
  const candidates: Array<[string, RegExp]> = [
    ["Edge", /Edg\/(\d+)/],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["Safari", /Version\/(\d+).+Safari/],
  ];
  for (const [family, pattern] of candidates) {
    const match = userAgent.match(pattern);
    if (match) return { family, majorVersion: match[1] };
  }
  return { family: "Other", majorVersion: null };
}

function parseOperatingSystem(userAgent: string) {
  if (/iPad|Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1) return "iPadOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return "Other";
}
