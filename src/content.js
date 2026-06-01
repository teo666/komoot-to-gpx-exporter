(() => {
  const ROOT_ID = "komoot-gpx-export-root";
  const BUTTON_ID = "komoot-gpx-export-button";
  const STATUS_ID = "komoot-gpx-export-status";
  const DISCOVERY_PATTERN = /https:\/\/api\.komoot\.de\/v007\/([^"'\\\s<]+)\/(\d+)\/coordinates\b/i;
  const extensionApi = globalThis.browser ?? globalThis.chrome;

  if (window.__komootGpxExportInitialized) {
    return;
  }

  window.__komootGpxExportInitialized = true;

  const state = {
    endpoints: null,
    observer: null
  };

  bootstrap();

  function bootstrap() {
    ensureUi();
    refreshDiscovery();
    observePageChanges();
  }

  function ensureUi() {
    if (document.getElementById(ROOT_ID)) {
      return;
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Export GPX";
    button.addEventListener("click", handleExport);

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "Looking for Komoot track data on this page.";
    status.dataset.state = "idle";

    root.append(button, status);
    document.body.append(root);
  }

  function observePageChanges() {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(() => {
      ensureUi();

      if (!state.endpoints) {
        refreshDiscovery();
      }
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function refreshDiscovery() {
    state.endpoints = discoverTourEndpoints();

    if (state.endpoints) {
      setStatus("Tour data found. Ready to export.", "success");
      setBusy(false);
      return;
    }

    setStatus("No Komoot API URL found yet. Stay on the tour page and retry.", "idle");
    setBusy(false);
  }

  async function handleExport() {
    try {
      setBusy(true);
      setStatus("Preparing GPX export.", "idle");

      const endpoints = state.endpoints ?? discoverTourEndpoints();
      if (!endpoints) {
        throw new Error("Could not find the Komoot coordinates URL on this page.");
      }

      const [coordinatesPayload, metadataPayload] = await Promise.all([
        fetchJson(endpoints.coordinatesUrl),
        fetchJson(endpoints.metadataUrl)
      ]);

      if (!Array.isArray(coordinatesPayload.items)) {
        throw new Error("Coordinates payload is missing the items array.");
      }

      const trackPoints = normalizeTrackPoints(coordinatesPayload.items);
      if (trackPoints.length < 2) {
        throw new Error("The track does not contain enough valid points to build a GPX file.");
      }

      const rawName = typeof metadataPayload.name === "string" && metadataPayload.name.trim()
        ? metadataPayload.name.trim()
        : `komoot-tour-${endpoints.tourId}`;

      const filename = buildFileName(rawName);
      const gpx = buildGpx({
        name: rawName,
        trackPoints,
        sourceUrl: location.href
      });

      await triggerDownload(filename, gpx);

      state.endpoints = endpoints;
      setStatus(`Downloaded ${filename}`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  function discoverTourEndpoints() {
    const sources = [];

    if (document.documentElement?.innerHTML) {
      sources.push(document.documentElement.innerHTML);
    }

    for (const script of document.scripts) {
      if (script.textContent) {
        sources.push(script.textContent);
      }
    }

    for (const source of sources) {
      const normalized = source.replace(/\\\//g, "/");
      const match = normalized.match(DISCOVERY_PATTERN);
      if (!match) {
        continue;
      }

      const coordinatesUrl = match[0];
      const resourceName = match[1];
      const tourId = match[2];

      return {
        coordinatesUrl,
        metadataUrl: `https://api.komoot.de/v007/${resourceName}/${tourId}/`,
        resourceName,
        tourId
      };
    }

    return null;
  }

  async function fetchJson(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status} for ${url}`);
    }

    return response.json();
  }

  function normalizeTrackPoints(items) {
    return items
      .map((item) => {
        const lat = Number(item?.lat);
        const lng = Number(item?.lng);
        const ele = Number.isFinite(Number(item?.alt)) ? Number(item.alt) : null;
        const time = toIsoTime(item?.t);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }

        return { lat, lng, ele, time };
      })
      .filter(Boolean);
  }

  function toIsoTime(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return null;
    }

    let milliseconds;
    if (numericValue > 100000000000) {
      milliseconds = numericValue;
    } else if (numericValue > 1000000000) {
      milliseconds = numericValue * 1000;
    } else {
      return null;
    }

    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }

  function buildFileName(name) {
    const sanitized = name
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const baseName = sanitized || "komoot-tour";
    return `${baseName.slice(0, 251)}.gpx`;
  }

  function buildGpx({ name, trackPoints, sourceUrl }) {
    const metadataName = escapeXml(name);
    const escapedSourceUrl = escapeXml(sourceUrl);

    const segments = trackPoints
      .map((point) => {
        const ele = point.ele == null ? "" : `<ele>${point.ele}</ele>`;
        const time = point.time == null ? "" : `<time>${point.time}</time>`;

        return `<trkpt lat="${point.lat}" lon="${point.lng}">${ele}${time}</trkpt>`;
      })
      .join("");

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Komoot GPX Export" xmlns="http://www.topografix.com/GPX/1/1">',
      `<metadata><name>${metadataName}</name><link href="${escapedSourceUrl}" /></metadata>`,
      `<trk><name>${metadataName}</name><trkseg>${segments}</trkseg></trk>`,
      '</gpx>'
    ].join("");
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  async function triggerDownload(filename, gpx) {
    const payload = {
      type: "komoot-gpx:download",
      filename,
      url: `data:application/gpx+xml;charset=utf-8,${encodeURIComponent(gpx)}`
    };

    try {
      const response = await sendRuntimeMessage(payload);
      if (!response?.ok) {
        throw new Error(response?.error || "Runtime download failed.");
      }
      return;
    } catch (_error) {
      downloadWithAnchor(filename, gpx);
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!extensionApi?.runtime?.sendMessage) {
        reject(new Error("Runtime messaging unavailable."));
        return;
      }

      let settled = false;

      const settleOnce = (callback) => (value) => {
        if (settled) {
          return;
        }

        settled = true;
        callback(value);
      };

      const onResolve = settleOnce(resolve);
      const onReject = settleOnce(reject);

      try {
        const maybePromise = extensionApi.runtime.sendMessage(message, (response) => {
          const runtimeError = globalThis.chrome?.runtime?.lastError;
          if (runtimeError) {
            onReject(new Error(runtimeError.message));
            return;
          }

          onResolve(response);
        });

        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(onResolve).catch(onReject);
        }
      } catch (error) {
        onReject(error);
      }
    });
  }

  function downloadWithAnchor(filename, gpx) {
    const blob = new Blob([gpx], { type: "application/gpx+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";

    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function setBusy(isBusy) {
    const button = document.getElementById(BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.disabled = isBusy;
    button.textContent = isBusy ? "Exporting..." : "Export GPX";
  }

  function setStatus(text, stateName) {
    const status = document.getElementById(STATUS_ID);
    if (!status) {
      return;
    }

    status.textContent = text;
    status.dataset.state = stateName;
  }
})();
