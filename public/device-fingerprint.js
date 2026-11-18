/**
 * LocalFingerprint Client-Side Device Fingerprinting Agent
 * Collects high-entropy browser signals: Canvas, WebGL, AudioContext, Fonts, Screen, Navigator, Intl
 * Zero external dependencies.
 */
(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LocalFingerprint = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  async function sha256(str) {
    if (crypto && crypto.subtle && crypto.subtle.digest) {
      const buffer = new TextEncoder().encode(str);
      const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    }
    // Simple fast 32-bit FNV fallback if subtle crypto is unavailable
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  function getCanvasFingerprint() {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 60;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "unsupported";

      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial', sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("Fingerprint.to Local 🕵️‍♂️ 123", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("Fingerprint.to Local 🕵️‍♂️ 123", 4, 17);

      ctx.shadowBlur = 10;
      ctx.shadowColor = "blue";
      ctx.fillRect(20, 25, 50, 20);

      return canvas.toDataURL();
    } catch {
      return "blocked";
    }
  }

  function getWebGLFingerprint() {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return { vendor: "unsupported", renderer: "unsupported" };

      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

      return {
        vendor: String(vendor || "unknown"),
        renderer: String(renderer || "unknown"),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION)
      };
    } catch {
      return { vendor: "blocked", renderer: "blocked" };
    }
  }

  async function getAudioFingerprint() {
    return new Promise(resolve => {
      try {
        const AudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!AudioContext) return resolve("unsupported");

        const context = new AudioContext(1, 44100, 44100);
        const oscillator = context.createOscillator();
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(10000, context.currentTime);

        const compressor = context.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-50, context.currentTime);
        compressor.knee.setValueAtTime(40, context.currentTime);
        compressor.ratio.setValueAtTime(12, context.currentTime);
        compressor.attack.setValueAtTime(0, context.currentTime);
        compressor.release.setValueAtTime(0.25, context.currentTime);

        oscillator.connect(compressor);
        compressor.connect(context.destination);
        oscillator.start(0);
        context.startRendering();

        context.oncomplete = event => {
          let hash = 0;
          const samples = event.renderedBuffer.getChannelData(0);
          for (let i = 0; i < samples.length; i += 100) {
            hash += Math.abs(samples[i]);
          }
          resolve(hash.toFixed(6));
        };
      } catch {
        resolve("blocked");
      }
    });
  }

  function getFontFingerprint() {
    try {
      const baseFonts = ["monospace", "sans-serif", "serif"];
      const testFonts = [
        "Arial", "Helvetica", "Times New Roman", "Courier New", "Verdana",
        "Georgia", "Palatino", "Garamond", "Bookman", "Comic Sans MS",
        "Trebuchet MS", "Arial Black", "Impact", "Segoe UI", "Roboto", "Ubuntu",
        "Cantarell", "Fira Code", "Consolas", "Menlo", "Monaco", "Apple Color Emoji"
      ];

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];

      const baseWidths = {};
      for (const base of baseFonts) {
        ctx.font = `72px ${base}`;
        baseWidths[base] = ctx.measureText("mmmmmmmmmmlli").width;
      }

      const available = [];
      for (const font of testFonts) {
        for (const base of baseFonts) {
          ctx.font = `72px '${font}', ${base}`;
          const width = ctx.measureText("mmmmmmmmmmlli").width;
          if (width !== baseWidths[base]) {
            available.push(font);
            break;
          }
        }
      }
      return available;
    } catch {
      return [];
    }
  }

  return {
    async getFingerprint() {
      const canvasRaw = getCanvasFingerprint();
      const canvasHash = await sha256(canvasRaw);
      const webgl = getWebGLFingerprint();
      const audioHash = await getAudioFingerprint();
      const fonts = getFontFingerprint();
      const fontsHash = await sha256(fonts.join(","));

      const components = {
        canvasHash,
        webglVendor: webgl.vendor,
        webglRenderer: webgl.renderer,
        audioHash,
        installedFonts: fonts,
        installedFontsHash: fontsHash,
        screenResolution: `${screen.width}x${screen.height}`,
        availableResolution: `${screen.availWidth}x${screen.availHeight}`,
        colorDepth: screen.colorDepth,
        pixelRatio: window.devicePixelRatio || 1,
        hardwareConcurrency: navigator.hardwareConcurrency || "unknown",
        deviceMemory: navigator.deviceMemory || "unknown",
        platform: navigator.platform || "unknown",
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: (navigator.languages || []).join(","),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: new Date().getTimezoneOffset(),
        touchSupport: navigator.maxTouchPoints || 0,
        webdriver: Boolean(navigator.webdriver),
        headless: /HeadlessChrome/.test(navigator.userAgent)
      };

      const entropyString = Object.values(components).join("|#|");
      const visitorId = await sha256(entropyString);

      return {
        visitorId,
        components,
        timestamp: Date.now()
      };
    }
  };
});
