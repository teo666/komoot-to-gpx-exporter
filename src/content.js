(() => {
  const ROOT_ID = "komoot-gpx-export-root";
  const BUTTON_ID = "komoot-gpx-export-button";
  const STATUS_ID = "komoot-gpx-export-status";
  const PANEL_TOGGLE_ID = "komoot-gpx-export-panel-toggle";
  const PANEL_ID = "komoot-gpx-export-panel";
  const TRACK_LIST_ID = "komoot-gpx-export-track-list";
  const EMPTY_ID = "komoot-gpx-export-empty";
  const DOWNLOAD_ALL_ID = "komoot-gpx-export-download-all";
  const API_VERSION = "v007";
  const DISCOVERY_PATTERN = new RegExp(`https://api\\.komoot\\.de/${API_VERSION}/([^"'\\\\\\s<]+)/(\\d+)/coordinates(?:\\?[^"'\\\\\\s<>]*)?`, "i");
  const DISCOVER_TOUR_PATTERN = new RegExp(`/api/${API_VERSION}/discover_tours/([^/?#]+)(?:[/?#]|$)`, "i");
  const MAX_TRACKS = 40;
  const DEBUG_PREFIX = "[komoot-gpx-debug]";
  const BRIDGE_EVENT_TYPE = "komoot-gpx:page-network";
  const BRIDGE_SOURCE = "komoot-gpx-page-hook";
  const extensionApi = globalThis.browser ?? globalThis.chrome;

  if (window.__komootGpxExportInitialized) {
    return;
  }

  window.__komootGpxExportInitialized = true;

  const state = {
    endpoints: null,
    tracks: [],
    panelOpen: false,
    shadowRoot: null
  };

  bootstrap();

  /**
   * Initializes the extension by setting up the UI, network interception,
   * and initial track discovery.
   */
  function bootstrap() {
    logDebug("bootstrap:start", { href: location.href });
    ensureUi();
    installPageNetworkBridge();
    refreshDiscovery();
    logDebug("bootstrap:ready");
  }

  /**
   * Sets up the page-level network bridge that intercepts fetch/XHR requests
   * from the page context and relays discover-tour responses to the content script
   * via window.postMessage.
   */
  function installPageNetworkBridge() {
    if (window.__komootGpxPageBridgeInstalled) {
      logDebug("bridge:install:skip", { reason: "already-installed" });
      return;
    }

    window.__komootGpxPageBridgeInstalled = true;
    installPageBridgeListener();
    injectPageNetworkHook();
    logDebug("bridge:install:done");
  }

  /**
   * Listens for postMessage events from the injected page-level network hook
   * and forwards matching discover-tour payloads to processDiscoverPayload.
   */
  function installPageBridgeListener() {
    window.addEventListener("message", (event) => {
      if (event.source !== window) {
        return;
      }

      const payload = event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }

      if (payload.type !== BRIDGE_EVENT_TYPE || payload.source !== BRIDGE_SOURCE) {
        return;
      }

      logDebug("bridge:event", {
        channel: payload.channel,
        requestUrl: payload.requestUrl,
        status: payload.status
      });

      processDiscoverPayload(payload.requestUrl, payload.payload);
    });

    logDebug("bridge:listener:installed");
  }

  /**
   * Injects the page-hook.js script into the page context via a src-based
   * script element to comply with Content Security Policy restrictions.
   * The script monkey-patches fetch and XMLHttpRequest to intercept
   * discover-tour API responses and relay them via postMessage.
   */
  function injectPageNetworkHook() {
    const container = document.documentElement || document.head || document.body;
    if (!container) {
      logWarn("bridge:inject:failed", { reason: "no-container" });
      return;
    }

    const script = document.createElement("script");
    script.src = extensionApi.runtime.getURL("page-hook.js");
    script.type = "text/javascript";
    container.append(script);
    script.addEventListener("load", () => {
      script.remove();
      logDebug("bridge:inject:done");
    });
    script.addEventListener("error", () => {
      script.remove();
      logWarn("bridge:inject:failed", { reason: "script-load-error" });
    });
  }

  /**
   * Creates and appends the extension's UI elements (export button, status bar,
   * track panel toggle, and side panel) to the DOM if not already present.
   * Uses Shadow DOM to isolate styles.
   */
  function ensureUi() {
    if (document.getElementById("komoot-gpx-export-host") || state.shadowRoot) {
      return;
    }

    const host = document.createElement("div");
    host.id = "komoot-gpx-export-host";
    document.body.append(host);

    const shadow = host.attachShadow({ mode: "open" });
    state.shadowRoot = shadow;

    // Inject CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = extensionApi.runtime.getURL("content.css");
    shadow.append(link);

    const root = document.createElement("div");
    root.id = ROOT_ID;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Add Trace";
    button.addEventListener("click", handleAddTrace);

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "Looking for Komoot track data on this page.";
    status.dataset.state = "idle";

    const panelToggle = document.createElement("button");
    panelToggle.id = PANEL_TOGGLE_ID;
    panelToggle.type = "button";
    panelToggle.textContent = "Tracks (0)";
    panelToggle.addEventListener("click", () => {
      setPanelOpen(!state.panelOpen);
    });

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.dataset.open = "false";

    const panelTitle = document.createElement("h2");
    panelTitle.textContent = "Saved tracks";

    const panelClose = document.createElement("button");
    panelClose.type = "button";
    panelClose.textContent = "Close";
    panelClose.addEventListener("click", () => {
      setPanelOpen(false);
    });

    const panelHeader = document.createElement("div");
    panelHeader.className = "komoot-gpx-export-panel-header";
    panelHeader.append(panelTitle, panelClose);

    const empty = document.createElement("div");
    empty.id = EMPTY_ID;
    empty.textContent = "No tracks added yet. Use 'Add Trace' to save the current track.";

    const list = document.createElement("ul");
    list.id = TRACK_LIST_ID;

    const panelFooter = document.createElement("div");
    panelFooter.className = "komoot-gpx-export-panel-footer";

    const downloadAllButton = document.createElement("button");
    downloadAllButton.id = DOWNLOAD_ALL_ID;
    downloadAllButton.type = "button";
    downloadAllButton.textContent = "Download All";
    downloadAllButton.addEventListener("click", handleDownloadAll);

    panelFooter.append(downloadAllButton);
    panel.append(panelHeader, empty, list, panelFooter);

    root.append(button, status, panelToggle);
    shadow.append(root, panel);

    renderTrackList();
  }

  /**
   * Attempts to discover tour endpoints from inline scripts on the page.
   * Updates the status message and active track accordingly.
   */
  function refreshDiscovery() {
    const endpoints = discoverTourEndpoints();

    if (endpoints) {
      registerTrack(endpoints, { makeActive: true });
      setStatus("Tour data found. Ready to add.", "success");
      setBusy(false);
      return;
    }

    if (state.endpoints) {
      setStatus("Track detected. Ready to add.", "success");
      setBusy(false);
      return;
    }

    setStatus("No Komoot API URL found yet. Stay on the tour page and retry.", "idle");
    setBusy(false);
  }

  /**
   * Click handler for the main "Add Trace" button. Discovers or uses
   * the currently active track endpoints and adds it to the saved list.
   */
  function handleAddTrace() {
    const endpoints = state.endpoints ?? discoverTourEndpoints();
    if (!endpoints) {
      setStatus("Could not find the Komoot coordinates URL on this page.", "error");
      return;
    }

    const result = registerTrack(endpoints, { makeActive: true, addToList: true });
    if (!result.track) {
      setStatus("Failed to add trace.", "error");
      return;
    }

    const label = result.track.name || `tour ${result.track.tourId || ""}`.trim() || "track";
    if (result.addedToList) {
      setStatus(`Added: ${label}`, "success");
    } else {
      setStatus(`Already in list: ${label}`, "success");
    }

    setPanelOpen(true);
  }

  /**
   * Handles downloading a specific track from the track panel by its coordinates URL.
   * @param {string} coordinatesUrl - The Komoot coordinates API URL identifying the track.
   */
  async function handleTrackDownload(coordinatesUrl) {
    const track = state.tracks.find((item) => item.coordinatesUrl === coordinatesUrl);
    if (!track) {
      setStatus("Selected track no longer exists.", "error");
      return;
    }

    try {
      setBusy(true);
      setStatus(`Preparing ${track.name || `tour ${track.tourId || ""}`}.`, "idle");
      registerTrack(track, { makeActive: true });
      await downloadTrack(track);
      setStatus(`Downloaded ${buildFileName(track.name || `komoot-tour-${track.tourId || "track"}`)}`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Fetches track coordinates and optional metadata, builds a GPX file,
   * and triggers a download for the given track reference.
   * @param {Object} reference - Track reference containing coordinatesUrl, metadataUrl, name, tourId, and pageUrl.
   */
  async function downloadTrack(reference) {
    const [coordinatesPayload, metadataPayload] = await Promise.all([
      fetchJson(reference.coordinatesUrl),
      reference.metadataUrl ? fetchJson(reference.metadataUrl).catch(() => null) : Promise.resolve(null)
    ]);

    if (!Array.isArray(coordinatesPayload.items)) {
      throw new Error("Coordinates payload is missing the items array.");
    }

    const trackPoints = normalizeTrackPoints(coordinatesPayload.items);
    if (trackPoints.length < 2) {
      throw new Error("The track does not contain enough valid points to build a GPX file.");
    }

    const metadataName = typeof metadataPayload?.name === "string" ? metadataPayload.name.trim() : "";
    const referenceName = typeof reference.name === "string" ? reference.name.trim() : "";
    const rawName = referenceName || metadataName || `komoot-tour-${reference.tourId || "track"}`;

    const filename = buildFileName(rawName);
    const gpx = buildGpx({
      name: rawName,
      trackPoints,
      sourceUrl: reference.pageUrl || location.href
    });

    await triggerDownload(filename, gpx);

    registerTrack({ ...reference, name: rawName }, { makeActive: true, addToList: false });
  }



  /**
   * Parses a discover-tour API response, extracts the coordinates link and tour
   * metadata, and registers the track as active.
   * @param {string} requestUrl - The original request URL.
   * @param {string|Object} payload - The response body as a JSON string or parsed object.
   */
  function processDiscoverPayload(requestUrl, payload) {
    let data = payload;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (_error) {
        logWarn("payload:json-invalid", { requestUrl });
        return;
      }
    }

    if (!data || typeof data !== "object") {
      logWarn("payload:invalid-shape", { requestUrl, type: typeof data });
      return;
    }

    const coordinatesHref = data?._links?.coordinates?.href;
    if (typeof coordinatesHref !== "string" || !coordinatesHref.trim()) {
      logWarn("payload:missing-coordinates-link", { requestUrl });
      return;
    }

    const parsed = parseCoordinatesUrl(coordinatesHref);
    const discoverId = extractDiscoverTourId(requestUrl);
    const tourId = parsed?.tourId || discoverId;
    const resourceName = parsed?.resourceName || "discover_tours";
    const coordinatesUrl = parsed?.coordinatesUrl || toAbsoluteUrl(coordinatesHref);
    const trackName = typeof data.name === "string" ? data.name.trim() : "";

    if (!coordinatesUrl) {
      logWarn("payload:coordinates-url-invalid", { requestUrl, coordinatesHref });
      return;
    }

    logDebug("payload:track-discovered", {
      requestUrl,
      coordinatesUrl,
      tourId,
      resourceName,
      trackName
    });

    const metadataUrl = tourId ? `https://api.komoot.de/${API_VERSION}/${resourceName}/${tourId}/` : null;
    const result = registerTrack({
      coordinatesUrl,
      metadataUrl,
      resourceName,
      tourId,
      name: trackName,
      pageUrl: location.href
    }, { makeActive: true });

    if (result.becameActive && result.track) {
      const label = result.track.name || `tour ${result.track.tourId || ""}`.trim() || "track";
      logDebug("track:active-updated", { label, coordinatesUrl: result.track.coordinatesUrl });
      setStatus(`Track selected: ${label}`, "success");
    }
  }

  /**
   * Resolves a relative or absolute URL string against the current page location.
   * @param {string} url - The URL to resolve.
   * @returns {string|null} The resolved absolute URL, or null on failure.
   */
  function toAbsoluteUrl(url) {
    if (typeof url !== "string" || !url.trim()) {
      return null;
    }

    try {
      return new URL(url, location.href).href;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Extracts the tour identifier from a discover-tour API URL.
   * Uses pathname parsing first, then falls back to regex matching.
   * @param {string} url - The URL to extract the tour ID from.
   * @returns {string|null} The tour ID, or null if the URL does not match.
   */
  function extractDiscoverTourId(url) {
    const normalized = toAbsoluteUrl(url);
    if (!normalized) {
      return null;
    }

    try {
      const parsedUrl = new URL(normalized);
      const pathMatch = parsedUrl.pathname.match(new RegExp(`^/api/${API_VERSION}/discover_tours/([^/?#]+)/?$`, "i"));
      if (pathMatch?.[1]) {
        logDebug("url:discover-tour-match", {
          normalized,
          pathname: parsedUrl.pathname,
          search: parsedUrl.search,
          tourId: pathMatch[1],
          source: "pathname"
        });
        return pathMatch[1];
      }
    } catch (_error) {
      // Keep regex fallback below when URL parsing fails unexpectedly.
    }

    const match = normalized.match(DISCOVER_TOUR_PATTERN);
    if (match?.[1]) {
      logDebug("url:discover-tour-match", {
        normalized,
        tourId: match[1],
        source: "regex"
      });
    }

    return match?.[1] || null;
  }

  /**
   * Parses a Komoot coordinates API URL to extract the resource name, tour ID,
   * and full coordinates URL.
   * @param {string} url - The coordinates URL (absolute or relative).
   * @returns {{coordinatesUrl: string, resourceName: string|null, tourId: string|null}|null}
   */
  function parseCoordinatesUrl(url) {
    const absolute = toAbsoluteUrl(url);
    if (!absolute) {
      return null;
    }

    const match = absolute.match(DISCOVERY_PATTERN);
    if (!match) {
      return { coordinatesUrl: absolute, resourceName: null, tourId: null };
    }

    return {
      coordinatesUrl: match[0],
      resourceName: match[1],
      tourId: match[2]
    };
  }

  /**
   * Registers or updates a track. When addToList is true, adds the track to the
   * user's saved list. When makeActive is true, sets it as the current endpoint.
   * Enforces the MAX_TRACKS limit.
   * @param {Object} reference - Track data containing coordinatesUrl, metadataUrl, tourId, name, etc.
   * @param {Object} [options] - Options object.
   * @param {boolean} [options.makeActive=true] - Whether to set this track as the active export target.
   * @param {boolean} [options.addToList=false] - Whether to add or update this track in the saved list.
   * @returns {{becameActive: boolean, addedToList: boolean, track: Object|null}} Whether the active track changed, whether it was added to the list, and the registered track.
   */
  function registerTrack(reference, options = {}) {
    if (!reference?.coordinatesUrl) {
      return { becameActive: false, addedToList: false, track: null };
    }

    const now = Date.now();
    const existingIndex = state.tracks.findIndex((item) => item.coordinatesUrl === reference.coordinatesUrl);
    const existing = existingIndex >= 0 ? state.tracks[existingIndex] : null;

    const track = {
      coordinatesUrl: reference.coordinatesUrl,
      metadataUrl: reference.metadataUrl || existing?.metadataUrl || null,
      resourceName: reference.resourceName || existing?.resourceName || null,
      tourId: reference.tourId || existing?.tourId || null,
      name: reference.name || existing?.name || "",
      pageUrl: reference.pageUrl || existing?.pageUrl || location.href,
      lastSeenAt: now
    };

    let addedToList = false;
    if (options.addToList) {
      if (existingIndex >= 0) {
        state.tracks.splice(existingIndex, 1);
      }

      state.tracks.unshift(track);
      if (state.tracks.length > MAX_TRACKS) {
        state.tracks.length = MAX_TRACKS;
      }

      addedToList = !existing;
    }

    let becameActive = false;
    if (options.makeActive !== false) {
      becameActive = state.endpoints?.coordinatesUrl !== track.coordinatesUrl;
      state.endpoints = track;
    }

    logDebug("track:registered", {
      coordinatesUrl: track.coordinatesUrl,
      tourId: track.tourId,
      name: track.name,
      active: options.makeActive !== false,
      addedToList,
      becameActive,
      total: state.tracks.length
    });

    renderTrackList();
    return { becameActive, addedToList, track };
  }

  /**
   * Removes a track from the saved list by its coordinates URL.
   * @param {string} coordinatesUrl - The Komoot coordinates API URL identifying the track.
   */
  function removeTrack(coordinatesUrl) {
    const index = state.tracks.findIndex((item) => item.coordinatesUrl === coordinatesUrl);
    if (index < 0) {
      return;
    }

    state.tracks.splice(index, 1);
    logDebug("track:removed", { coordinatesUrl, total: state.tracks.length });
    renderTrackList();
  }

  /**
   * Downloads all tracks in the saved list sequentially.
   * Shows progress in the status bar and reports results.
   */
  async function handleDownloadAll() {
    if (state.tracks.length === 0) {
      setStatus("No tracks to download.", "error");
      return;
    }

    const tracks = [...state.tracks];
    const total = tracks.length;
    let succeeded = 0;
    let failed = 0;

    try {
      setBusy(true);

      for (let i = 0; i < total; i++) {
        const track = tracks[i];
        const label = track.name || `tour ${track.tourId || ""}`.trim() || "track";
        setStatus(`Downloading ${i + 1}/${total}: ${label}`, "idle");

        try {
          await downloadTrack(track);
          succeeded++;
        } catch (error) {
          failed++;
          logWarn("download-all:track-failed", {
            coordinatesUrl: track.coordinatesUrl,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (failed === 0) {
        setStatus(`Downloaded ${succeeded} track${succeeded === 1 ? "" : "s"}.`, "success");
      } else {
        setStatus(`Downloaded ${succeeded}/${total}. ${failed} failed.`, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Logs a debug-level message to the console with the extension prefix.
   * @param {string} message - The log label.
   * @param {*} [details] - Optional structured data to log alongside the message.
   */
  function logDebug(message, details) {
    if (details === undefined) {
      console.debug(DEBUG_PREFIX, message);
      return;
    }

    console.debug(DEBUG_PREFIX, message, details);
  }

  /**
   * Logs a warning-level message to the console with the extension prefix.
   * @param {string} message - The log label.
   * @param {*} [details] - Optional structured data to log alongside the message.
   */
  function logWarn(message, details) {
    if (details === undefined) {
      console.warn(DEBUG_PREFIX, message);
      return;
    }

    console.warn(DEBUG_PREFIX, message, details);
  }

  /**
   * Re-renders the track list panel UI from the current state.tracks array.
   * Updates the panel toggle count, clears existing items, and rebuilds
   * list entries with select and download buttons.
   */
  function renderTrackList() {
    const list = state.shadowRoot?.getElementById(TRACK_LIST_ID);
    const empty = state.shadowRoot?.getElementById(EMPTY_ID);
    const panelToggle = state.shadowRoot?.getElementById(PANEL_TOGGLE_ID);
    const downloadAllButton = state.shadowRoot?.getElementById(DOWNLOAD_ALL_ID);
    if (!(list instanceof HTMLUListElement) || !empty || !(panelToggle instanceof HTMLButtonElement)) {
      return;
    }

    panelToggle.textContent = `Tracks (${state.tracks.length})`;

    if (downloadAllButton) {
      downloadAllButton.parentElement.hidden = state.tracks.length === 0;
    }

    while (list.firstChild) {
      list.firstChild.remove();
    }

    if (state.tracks.length === 0) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;

    for (const track of state.tracks) {
      const item = document.createElement("li");
      item.className = "komoot-gpx-export-track-item";

      const title = document.createElement("button");
      title.type = "button";
      title.className = "komoot-gpx-export-track-title";
      title.textContent = track.name || `komoot-tour-${track.tourId || "track"}`;
      title.addEventListener("click", () => {
        state.endpoints = track;
        setStatus(`Track selected: ${track.name || `tour ${track.tourId || ""}`.trim()}`, "success");
      });

      const meta = document.createElement("div");
      meta.className = "komoot-gpx-export-track-meta";
      meta.textContent = track.tourId ? `ID ${track.tourId}` : "Unknown ID";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "komoot-gpx-export-track-remove";
      removeButton.textContent = "\u00d7";
      removeButton.title = "Remove from list";
      removeButton.addEventListener("click", () => {
        removeTrack(track.coordinatesUrl);
      });

      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = "komoot-gpx-export-track-download";
      downloadButton.textContent = "Download";
      downloadButton.addEventListener("click", () => {
        handleTrackDownload(track.coordinatesUrl);
      });

      item.append(title, removeButton, meta, downloadButton);
      list.append(item);
    }
  }

  /**
   * Toggles the track list side panel open or closed.
   * @param {boolean} isOpen - Whether the panel should be open.
   */
  function setPanelOpen(isOpen) {
    state.panelOpen = !!isOpen;
    const panel = state.shadowRoot?.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }

    panel.dataset.open = state.panelOpen ? "true" : "false";
  }

  /**
   * Scans all inline <script> elements on the page for a Komoot coordinates
   * API URL matching DISCOVERY_PATTERN. Returns the first matching endpoint
   * or null if none found.
   * @returns {{coordinatesUrl: string, metadataUrl: string, resourceName: string, tourId: string, name: string, pageUrl: string}|null}
   */
  function discoverTourEndpoints() {
    const sources = [];

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
        metadataUrl: `https://api.komoot.de/${API_VERSION}/${resourceName}/${tourId}/`,
        resourceName,
        tourId,
        name: "",
        pageUrl: location.href
      };
    }

    return null;
  }

  /**
   * Fetches a URL and parses the response as JSON.
   * @param {string} url - The URL to fetch.
   * @returns {Promise<*>} The parsed JSON response.
   * @throws {Error} If the response status is not OK.
   */
  async function fetchJson(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status} for ${url}`);
    }

    return response.json();
  }

  /**
   * Converts raw coordinate items from the Komoot API into normalized track points
   * with latitude, longitude, optional elevation, and optional ISO timestamp.
   * Filters out items with invalid lat/lng values.
   * @param {Array<Object>} items - Raw coordinate items from the API response.
   * @returns {Array<{lat: number, lng: number, ele: number|null, time: string|null}>}
   */
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

  /**
   * Converts a numeric timestamp (seconds or milliseconds) to an ISO 8601 string.
   * Handles both Unix seconds (>1e9) and milliseconds (>1e11) formats.
   * @param {*} value - The timestamp value to convert.
   * @returns {string|null} The ISO date string, or null if the value is not a valid timestamp.
   */
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

  /**
   * Sanitizes a track name into a safe filename with a .gpx extension.
   * Strips invalid filesystem characters and truncates to 251 characters.
   * @param {string} name - The raw track name.
   * @returns {string} The sanitized filename ending in .gpx.
   */
  function buildFileName(name) {
    const sanitized = name
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const baseName = sanitized || "komoot-tour";
    return `${baseName.slice(0, 251)}.gpx`;
  }

  /**
   * Builds a GPX 1.1 XML string from a track name, an array of track points,
   * and an optional source URL for the metadata link.
   * @param {Object} params
   * @param {string} params.name - The track/route name.
   * @param {Array<{lat: number, lng: number, ele: number|null, time: string|null}>} params.trackPoints - Ordered track points.
   * @param {string} params.sourceUrl - The originating Komoot page URL.
   * @returns {string} The complete GPX XML document as a string.
   */
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

  /**
   * Escapes special XML characters (&, <, >, ", ') in a string.
   * @param {*} value - The value to escape (coerced to string).
   * @returns {string} The XML-safe string.
   */
  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Triggers a GPX file download, first attempting via the extension's background
   * script runtime message, then falling back to an anchor-based download.
   * @param {string} filename - The download filename.
   * @param {string} gpx - The GPX XML content.
   */
  async function triggerDownload(filename, gpx) {
    const blob = new Blob([gpx], { type: "application/gpx+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);

    const payload = {
      type: "komoot-gpx:download",
      filename,
      url: blobUrl
    };

    try {
      const response = await sendRuntimeMessage(payload);
      if (!response?.ok) {
        throw new Error(response?.error || "Runtime download failed.");
      }
    } catch (error) {
      logWarn("download:runtime-failed", { error });
      downloadWithAnchor(filename, gpx);
    } finally {
      // Small delay to ensure the background script has started the download
      // if using the downloads API.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }
  }

  /**
   * Sends a message to the extension's background script via the browser
   * runtime API. Handles both callback-style (Chrome) and promise-style
   * (Firefox) sendMessage APIs.
   * @param {Object} message - The message payload to send.
   * @returns {Promise<*>} The background script's response.
   */
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

  /**
   * Downloads a GPX file by creating a temporary Blob URL and clicking
   * a hidden anchor element. Used as a fallback when runtime messaging is unavailable.
   * @param {string} filename - The download filename.
   * @param {string} gpx - The GPX XML content.
   */
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

  /**
   * Toggles the main button's disabled state and label between
   * "Add Trace" and "Downloading...".
   * @param {boolean} isBusy - Whether an operation is currently in progress.
   */
  function setBusy(isBusy) {
    const button = state.shadowRoot?.getElementById(BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.disabled = isBusy;
    button.textContent = isBusy ? "Downloading..." : "Add Trace";
  }

  /**
   * Updates the status bar text and visual state indicator.
   * @param {string} text - The status message to display.
   * @param {"idle"|"success"|"error"} stateName - The state name used for styling via data-state attribute.
   */
  function setStatus(text, stateName) {
    const status = state.shadowRoot?.getElementById(STATUS_ID);
    if (!status) {
      return;
    }

    status.textContent = text;
    status.dataset.state = stateName;
  }
})();
