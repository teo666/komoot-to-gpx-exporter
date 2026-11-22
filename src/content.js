(() => {
  const WIDGET_ID = "komoot-gpx-export-widget";
  const HEADER_ID = "komoot-gpx-export-header";
  const BODY_ID = "komoot-gpx-export-body";
  const COLLAPSE_ID = "komoot-gpx-export-collapse";
  const BADGE_ID = "komoot-gpx-export-badge";
  const BUTTON_ID = "komoot-gpx-export-button";
  const STATUS_ID = "komoot-gpx-export-status";
  const TRACK_LIST_ID = "komoot-gpx-export-track-list";
  const EMPTY_ID = "komoot-gpx-export-empty";
  const DOWNLOAD_ALL_ID = "komoot-gpx-export-download-all";
  const SAVED_TAB_ID = "komoot-gpx-export-tab-saved";
  const HISTORY_TAB_ID = "komoot-gpx-export-tab-history";
  const SAVED_VIEW_ID = "komoot-gpx-export-view-saved";
  const HISTORY_VIEW_ID = "komoot-gpx-export-view-history";
  const HISTORY_LIST_ID = "komoot-gpx-export-history-list";
  const HISTORY_EMPTY_ID = "komoot-gpx-export-history-empty";
  const CLEAR_HISTORY_ID = "komoot-gpx-export-clear-history";
  const BY_ID_BUTTON_ID = "komoot-gpx-export-by-id";
  const MODAL_ID = "komoot-gpx-export-modal";
  const MODAL_INPUT_ID = "komoot-gpx-export-modal-input";
  const MODAL_ERROR_ID = "komoot-gpx-export-modal-error";
  const MODAL_SUBMIT_ID = "komoot-gpx-export-modal-submit";
  const HISTORY_STORAGE_KEY = "komootGpxHistory";
  const TRACKS_STORAGE_KEY = "komootGpxTracks";
  const UI_STORAGE_KEY = "komootGpxUi";
  const DRAG_THRESHOLD_PX = 5;
  const WIDGET_MARGIN_PX = 8;
  const STYLES_TIMEOUT_MS = 2000;
  const MAX_HISTORY = 100;
  const FOCUSED_TOUR_PARAM = "focusedTour";
  // Private tours shared by link carry this token; the API needs it too.
  const SHARE_TOKEN_PARAM = "share_token";
  const URL_POLL_INTERVAL_MS = 500;
  const API_VERSION = "v007";
  const DISCOVERY_PATTERN = new RegExp(`https://api\\.komoot\\.de/${API_VERSION}/([^"'\\\\\\s<]+)/(\\d+)/coordinates(?:\\?[^"'\\\\\\s<>]*)?`, "i");
  const DISCOVER_TOUR_PATTERN = new RegExp(`/api/${API_VERSION}/discover_tours/(e?\\d+)/?(?:[?#]|$)`, "i");
  const MAX_TRACKS = 40;
  const MAX_DISCOVERED_CACHE = 200;
  // Lists persisted in storage.local: state[name] <-> storage key.
  const PERSISTED_LISTS = {
    history: { key: HISTORY_STORAGE_KEY, max: MAX_HISTORY },
    tracks: { key: TRACKS_STORAGE_KEY, max: MAX_TRACKS }
  };
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
    history: [],
    persistence: {
      history: { loaded: false, pending: false, recentWrites: new Set() },
      tracks: { loaded: false, pending: false, recentWrites: new Set() }
    },
    activeTab: "saved",
    collapsed: false,
    uiPosition: null,
    suppressHeaderClick: false,
    stylesReady: Promise.resolve(),
    shadowRoot: null,
    pendingNameLookups: new Set(),
    contextLost: false,
    contextLostMessage: "",
    discoveredTours: new Map()
  };

  bootstrap();

  /**
   * Initializes the extension by setting up the UI, network interception,
   * and initial track discovery.
   */
  function bootstrap() {
    logDebug("bootstrap:start", { href: location.href });
    // Resolved now: translations are unavailable once the context is lost.
    state.contextLostMessage = t("statusExtensionReloaded");
    ensureUi();
    loadPersistedLists();
    installPageNetworkBridge();
    refreshDiscovery();
    watchFocusedTour();
    logDebug("bootstrap:ready");
  }

  /**
   * Watches the page URL for changes of the `focusedTour` query parameter.
   * Komoot updates it every time a tour is opened from the list, even when the
   * tour data is served from the app cache and no network request is made,
   * so it is the most reliable signal of which tour the user is looking at.
   */
  function watchFocusedTour() {
    let lastKey = null;

    const check = () => {
      if (!isExtensionContextValid()) {
        handleExtensionContextLost();
        return;
      }

      const pageTour = readPageTour();
      const key = pageTour ? `${pageTour.kind}:${pageTour.rawId}:${pageTour.shareToken || ""}` : null;
      if (key === lastKey) {
        return;
      }

      lastKey = key;
      if (pageTour) {
        handleFocusedTour(pageTour);
      }
    };

    check();
    window.addEventListener("popstate", check);
    setInterval(check, URL_POLL_INTERVAL_MS);
  }

  /**
   * Tells whether this content script still belongs to the installed
   * extension. After the extension is reloaded or updated, scripts already
   * running in open tabs keep their UI but lose access to storage and APIs.
   * @returns {boolean} False once the extension context is invalidated.
   */
  function isExtensionContextValid() {
    try {
      return Boolean(extensionApi?.runtime?.id);
    } catch (_error) {
      return false;
    }
  }

  /**
   * Turns this orphaned copy of the widget into a notice asking to reload the
   * page, so actions don't silently fail. Runs once.
   */
  function handleExtensionContextLost() {
    if (state.contextLost) {
      return;
    }

    state.contextLost = true;
    setStatus(state.contextLostMessage, "error");
    setCollapsed(false, { persist: false });
    const body = state.shadowRoot?.getElementById(BODY_ID);
    if (body) {
      body.inert = true;
      body.style.opacity = "0.45";
    }
  }

  /**
   * Returns the tour currently open according to the page URL:
   * - the `focusedTour` query parameter of discover pages (desktop layout);
   * - `/smarttour/<id>/…` pages (opened from lists on narrow screens);
   * - `/tour/<id>` pages (regular tours).
   * List pages without any of these have no open tour.
   * A `share_token` parameter (private tours shared by link) is kept along.
   * @returns {{rawId: string, kind: "discover"|"tour", shareToken: string|null}|null} The open tour, or null.
   */
  function readPageTour() {
    let url;
    try {
      url = new URL(location.href);
    } catch (_error) {
      return null;
    }

    const shareToken = readShareToken(url);

    const focused = url.searchParams.get(FOCUSED_TOUR_PARAM);
    if (focused && /^e?\d+$/i.test(focused)) {
      return { rawId: focused.toLowerCase(), kind: "discover", shareToken };
    }

    const smartTour = url.pathname.match(/\/smarttour\/(e?\d+)(?:[/?#]|$)/i);
    if (smartTour) {
      return { rawId: smartTour[1].toLowerCase(), kind: "discover", shareToken };
    }

    const tour = url.pathname.match(/\/tour\/(e?\d+)(?:[/?#]|$)/i);
    if (tour) {
      const rawId = tour[1].toLowerCase();
      return { rawId, kind: rawId.startsWith("e") ? "discover" : "tour", shareToken };
    }

    return null;
  }

  /**
   * Reads the share token of a private tour shared by link.
   * @param {URL} url - A Komoot page URL.
   * @returns {string|null} The token, or null when absent or malformed.
   */
  function readShareToken(url) {
    const token = url.searchParams.get(SHARE_TOKEN_PARAM);
    return token && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
  }

  /**
   * Adds the share token to a Komoot API URL, so that private tours shared
   * by link can be read without being logged in.
   * @param {string|null} url - The API URL.
   * @param {string|null} shareToken - The token, if any.
   * @returns {string|null} The URL with the token, or the URL unchanged.
   */
  function withShareToken(url, shareToken) {
    if (!url || !shareToken) {
      return url;
    }

    try {
      const parsed = new URL(url);
      parsed.searchParams.set(SHARE_TOKEN_PARAM, shareToken);
      return parsed.href;
    } catch (_error) {
      return url;
    }
  }

  /**
   * Tells whether the page is a discover list/map, where inline data and
   * network responses describe many tours rather than one open tour.
   * @returns {boolean} True on /discover/ pages.
   */
  function isListPage() {
    return /\/discover(?:[/?#]|$)/i.test(location.pathname);
  }

  /**
   * Activates the tour currently open according to the URL, recording it in
   * the history and resolving its name if still unknown.
   * @param {{rawId: string, kind: "discover"|"tour"}} pageTour - The open tour.
   */
  function handleFocusedTour(pageTour) {
    const focusedTour = pageTour.rawId;
    // Prefer what Komoot itself returned for this tour (exact coordinates link
    // and name), fall back to deriving the URLs from the id.
    const cached = pageTour.kind === "discover" && !pageTour.shareToken ? state.discoveredTours.get(focusedTour) : null;
    const reference = cached || buildReferenceFromTourId(focusedTour, pageTour.kind, pageTour.shareToken);
    if (!reference) {
      logDebug("focused-tour:unsupported-id", { focusedTour });
      return;
    }

    const result = registerTrack(reference, { makeActive: true, recordHistory: true });
    if (!result.track) {
      return;
    }

    logDebug("focused-tour:selected", { focusedTour, coordinatesUrl: result.track.coordinatesUrl });
    setStatus(t("statusSelected", describeTrack(result.track)), "success");
    ensureTrackName(result.track);
  }

  /**
   * Builds a track reference from a Komoot tour id.
   *
   * Discover ids (the `focusedTour` URL parameter) come in two flavours:
   * - "e984826729": editorial tour, coordinates under /tours/984826729/;
   * - "37406527": smart tour, coordinates under /smart_tours/37406527/.
   * Their metadata (name) is always available at /discover_tours/<id>.
   * Regular tours (komoot.com/tour/123) use /tours/123/ for both.
   *
   * @param {string} rawId - The tour id, optionally prefixed with "e".
   * @param {"discover"|"tour"} [kind="discover"] - How to interpret a numeric id.
   * @param {string|null} [shareToken=null] - Share token of a private tour shared by link.
   * @returns {Object|null} A track reference, or null for unknown id formats.
   */
  function buildReferenceFromTourId(rawId, kind = "discover", shareToken = null) {
    const text = String(rawId).trim().toLowerCase();
    const match = text.match(/^(e?)(\d+)$/);
    if (!match) {
      return null;
    }

    const isEditorial = match[1] === "e";
    const tourId = match[2];
    const apiBase = `https://api.komoot.de/${API_VERSION}`;

    if (kind === "tour" && !isEditorial) {
      return {
        coordinatesUrl: withShareToken(`${apiBase}/tours/${tourId}/coordinates`, shareToken),
        metadataUrl: withShareToken(`${apiBase}/tours/${tourId}/`, shareToken),
        resourceName: "tours",
        tourId,
        name: "",
        pageUrl: location.href
      };
    }

    const resourceName = isEditorial ? "tours" : "smart_tours";
    return {
      coordinatesUrl: withShareToken(`${apiBase}/${resourceName}/${tourId}/coordinates`, shareToken),
      metadataUrl: withShareToken(`${apiBase}/discover_tours/${text}`, shareToken),
      resourceName,
      tourId,
      name: "",
      pageUrl: location.href
    };
  }

  /**
   * Remembers what a discover-tour response said about a tour, so that
   * focusing it later can reuse the exact coordinates link and name.
   * @param {string} discoverId - The discover id (e.g. "e984826729").
   * @param {Object} reference - The track reference built from the response.
   */
  function cacheDiscoveredTour(discoverId, reference) {
    const key = String(discoverId).toLowerCase();
    state.discoveredTours.delete(key);
    state.discoveredTours.set(key, reference);
    if (state.discoveredTours.size > MAX_DISCOVERED_CACHE) {
      state.discoveredTours.delete(state.discoveredTours.keys().next().value);
    }
  }

  /**
   * Fetches the tour metadata in the background to fill in a missing name,
   * so that history entries are readable. Runs at most once per track.
   * @param {Object} track - The registered track.
   */
  function ensureTrackName(track) {
    if (!track || track.name || !track.metadataUrl || state.pendingNameLookups.has(track.coordinatesUrl)) {
      return;
    }

    state.pendingNameLookups.add(track.coordinatesUrl);
    fetchJson(track.metadataUrl)
      .then((metadata) => {
        const name = typeof metadata?.name === "string" ? metadata.name.trim() : "";
        if (!name) {
          return;
        }

        const isActive = state.endpoints?.coordinatesUrl === track.coordinatesUrl;
        registerTrack({ ...track, name }, { makeActive: false });
        if (isActive) {
          setStatus(t("statusSelected", name), "success");
        }
      })
      .catch((error) => {
        logDebug("track:name-lookup-failed", {
          coordinatesUrl: track.coordinatesUrl,
          message: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        state.pendingNameLookups.delete(track.coordinatesUrl);
      });
  }

  /**
   * Returns a human-readable label for a track.
   * @param {Object} track - The track.
   * @returns {string} The track name, or a fallback built from its id.
   */
  function describeTrack(track) {
    if (track?.name) {
      return track.name;
    }

    return track?.tourId ? t("trackLabelWithId", track.tourId) : t("trackLabel");
  }

  /**
   * Returns the translated UI string for a message key (see src/_locales).
   * The language follows the browser UI language, falling back to English.
   * @param {string} key - The message name in messages.json.
   * @param {...*} substitutions - Values for $1..$9 in the message.
   * @returns {string} The localized text, or the key if it is missing.
   */
  function t(key, ...substitutions) {
    try {
      const message = extensionApi?.i18n?.getMessage(key, substitutions.map((value) => String(value)));
      if (message) {
        return message;
      }
    } catch (_error) {
      // Fall through to the key.
    }

    return key;
  }

  /**
   * Returns the browser UI language used for dates (e.g. "it", "en-US").
   * @returns {string|undefined} A BCP 47 language tag, or undefined for the default.
   */
  function getUiLanguage() {
    try {
      return extensionApi?.i18n?.getUILanguage?.() || undefined;
    } catch (_error) {
      return undefined;
    }
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
   * Creates the extension's single floating widget (if not already present):
   * a draggable header with title, status and collapse toggle, and a
   * collapsible body with the actions, the Saved/History tabs and their lists.
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
    state.stylesReady = new Promise((resolve) => {
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, STYLES_TIMEOUT_MS);
    });
    shadow.append(link);

    const widget = document.createElement("section");
    widget.id = WIDGET_ID;
    widget.setAttribute("aria-label", t("extName"));
    widget.dataset.collapsed = state.collapsed ? "true" : "false";
    widget.dataset.ready = "false";
    widget.style.visibility = "hidden";

    // Header: drag handle + collapse toggle.
    const header = document.createElement("div");
    header.id = HEADER_ID;
    header.title = t("headerHint");

    const grip = document.createElement("span");
    grip.className = "komoot-gpx-export-grip";
    grip.setAttribute("aria-hidden", "true");

    const heading = document.createElement("div");
    heading.className = "komoot-gpx-export-heading";

    const titleRow = document.createElement("div");
    titleRow.className = "komoot-gpx-export-title";
    titleRow.textContent = "Komoot GPX";

    const badge = document.createElement("span");
    badge.id = BADGE_ID;
    badge.title = t("badgeTitle");
    badge.hidden = true;
    titleRow.append(badge);

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = t("statusLooking");
    status.dataset.state = "idle";
    status.setAttribute("aria-live", "polite");

    heading.append(titleRow, status);

    const collapseButton = document.createElement("button");
    collapseButton.id = COLLAPSE_ID;
    collapseButton.type = "button";
    collapseButton.setAttribute("aria-controls", BODY_ID);

    header.append(grip, heading, collapseButton);
    header.addEventListener("click", () => {
      if (state.suppressHeaderClick) {
        state.suppressHeaderClick = false;
        return;
      }

      setCollapsed(!state.collapsed);
    });
    installDrag(widget, header);

    // Body: actions, tabs and lists.
    const body = document.createElement("div");
    body.id = BODY_ID;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = t("addTrace");
    button.title = t("addTraceTitle");
    button.addEventListener("click", handleAddTrace);

    const byIdButton = document.createElement("button");
    byIdButton.id = BY_ID_BUTTON_ID;
    byIdButton.type = "button";
    byIdButton.textContent = t("byIdButton");
    byIdButton.title = t("byIdTitle");
    byIdButton.addEventListener("click", () => {
      setModalOpen(true);
    });

    const actions = document.createElement("div");
    actions.className = "komoot-gpx-export-actions";
    actions.append(button, byIdButton);

    const tabs = document.createElement("div");
    tabs.className = "komoot-gpx-export-tabs";
    tabs.setAttribute("role", "tablist");

    const savedTab = document.createElement("button");
    savedTab.id = SAVED_TAB_ID;
    savedTab.type = "button";
    savedTab.className = "komoot-gpx-export-tab";
    savedTab.setAttribute("role", "tab");
    savedTab.setAttribute("aria-controls", SAVED_VIEW_ID);
    savedTab.addEventListener("click", () => {
      setActiveTab("saved");
    });

    const historyTab = document.createElement("button");
    historyTab.id = HISTORY_TAB_ID;
    historyTab.type = "button";
    historyTab.className = "komoot-gpx-export-tab";
    historyTab.setAttribute("role", "tab");
    historyTab.setAttribute("aria-controls", HISTORY_VIEW_ID);
    historyTab.addEventListener("click", () => {
      setActiveTab("history");
    });

    tabs.append(savedTab, historyTab);

    const empty = document.createElement("div");
    empty.id = EMPTY_ID;
    empty.className = "komoot-gpx-export-empty";
    empty.textContent = t("savedEmpty", t("addTrace"));

    const list = document.createElement("ul");
    list.id = TRACK_LIST_ID;
    list.className = "komoot-gpx-export-list";

    const savedFooter = document.createElement("div");
    savedFooter.className = "komoot-gpx-export-footer";

    const downloadAllButton = document.createElement("button");
    downloadAllButton.id = DOWNLOAD_ALL_ID;
    downloadAllButton.type = "button";
    downloadAllButton.textContent = t("downloadAll");
    downloadAllButton.addEventListener("click", handleDownloadAll);

    savedFooter.append(downloadAllButton);

    const savedView = document.createElement("div");
    savedView.id = SAVED_VIEW_ID;
    savedView.className = "komoot-gpx-export-view";
    savedView.setAttribute("role", "tabpanel");
    savedView.append(empty, list, savedFooter);

    const historyEmpty = document.createElement("div");
    historyEmpty.id = HISTORY_EMPTY_ID;
    historyEmpty.className = "komoot-gpx-export-empty";
    historyEmpty.textContent = t("historyEmpty");

    const historyList = document.createElement("ul");
    historyList.id = HISTORY_LIST_ID;
    historyList.className = "komoot-gpx-export-list";

    const historyFooter = document.createElement("div");
    historyFooter.className = "komoot-gpx-export-footer";

    const clearHistoryButton = document.createElement("button");
    clearHistoryButton.id = CLEAR_HISTORY_ID;
    clearHistoryButton.type = "button";
    clearHistoryButton.textContent = t("clearHistory");
    clearHistoryButton.addEventListener("click", handleClearHistory);

    historyFooter.append(clearHistoryButton);

    const historyView = document.createElement("div");
    historyView.id = HISTORY_VIEW_ID;
    historyView.className = "komoot-gpx-export-view";
    historyView.setAttribute("role", "tabpanel");
    historyView.append(historyEmpty, historyList, historyFooter);

    body.append(actions, tabs, savedView, historyView);
    widget.append(header, body);
    shadow.append(widget, buildByIdModal());

    window.addEventListener("resize", () => {
      applyWidgetPosition();
    });

    // Re-clamp whenever the widget's size changes (collapse, content, styles).
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        applyWidgetPosition();
      }).observe(widget);
    }

    setCollapsed(state.collapsed, { persist: false });
    setActiveTab(state.activeTab, { persist: false });
    renderTrackList();
    loadUiPrefs();
  }

  /**
   * Makes the widget draggable by its header with mouse, pen or touch.
   * Movements under DRAG_THRESHOLD_PX are treated as clicks (toggle).
   * @param {HTMLElement} widget - The floating widget.
   * @param {HTMLElement} handle - The element that starts a drag.
   */
  function installDrag(widget, handle) {
    let drag = null;

    // Stop the browser from starting text selection or a native drag-and-drop
    // (Chrome may pick an image of the page under the widget as drag source,
    // which cancels the pointer stream with "pointercancel").
    handle.addEventListener("mousedown", (event) => {
      if (event.button === 0) {
        event.preventDefault();
      }
    });
    handle.addEventListener("dragstart", (event) => {
      event.preventDefault();
    });
    window.addEventListener("dragstart", (event) => {
      if (drag) {
        event.preventDefault();
      }
    }, true);

    handle.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      state.suppressHeaderClick = false;
      const rect = widget.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        bottom: getViewportHeight() - rect.bottom,
        moved: false
      };

      try {
        handle.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Capture is best-effort; dragging still works while over the handle.
      }
    });

    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }

      drag.moved = true;
      widget.dataset.dragging = "true";
      event.preventDefault();
      state.uiPosition = { left: drag.left + dx, bottom: drag.bottom - dy };
      applyWidgetPosition();
    });

    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }

      if (drag.moved) {
        // Remember where the widget actually is (already clamped to the viewport).
        const rect = widget.getBoundingClientRect();
        state.uiPosition = { left: rect.left, bottom: getViewportHeight() - rect.bottom };
        // The click that follows pointerup must not toggle the widget.
        state.suppressHeaderClick = true;
        widget.dataset.dragging = "false";
        saveUiPrefs();
      }

      try {
        handle.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // Already released.
      }

      drag = null;
    };

    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  /**
   * Returns the current viewport size, excluding scrollbars.
   * @returns {number} The viewport width in CSS pixels.
   */
  function getViewportWidth() {
    return document.documentElement?.clientWidth || window.innerWidth;
  }

  /**
   * @returns {number} The viewport height in CSS pixels.
   */
  function getViewportHeight() {
    return window.innerHeight || document.documentElement?.clientHeight || 0;
  }

  /**
   * Positions the widget at the user's preferred spot (anchored bottom-left),
   * clamped so it always stays fully visible. Without a preferred spot the
   * CSS default (bottom-left corner, safe-area aware) is used.
   */
  function applyWidgetPosition() {
    const widget = state.shadowRoot?.getElementById(WIDGET_ID);
    if (!widget || !state.uiPosition) {
      return;
    }

    const rect = widget.getBoundingClientRect();
    const maxLeft = Math.max(WIDGET_MARGIN_PX, getViewportWidth() - rect.width - WIDGET_MARGIN_PX);
    const maxBottom = Math.max(WIDGET_MARGIN_PX, getViewportHeight() - rect.height - WIDGET_MARGIN_PX);
    const left = clamp(state.uiPosition.left, WIDGET_MARGIN_PX, maxLeft);
    const bottom = clamp(state.uiPosition.bottom, WIDGET_MARGIN_PX, maxBottom);

    widget.style.left = `${Math.round(left)}px`;
    widget.style.bottom = `${Math.round(bottom)}px`;
  }

  /**
   * Clamps a number into a range.
   * @param {number} value - The value.
   * @param {number} min - Lower bound.
   * @param {number} max - Upper bound.
   * @returns {number} The clamped value.
   */
  function clamp(value, min, max) {
    return Math.min(Math.max(Number(value) || 0, min), max);
  }

  /**
   * Expands or collapses the widget body.
   * @param {boolean} isCollapsed - Whether only the header should be visible.
   * @param {Object} [options]
   * @param {boolean} [options.persist=true] - Whether to remember the choice.
   */
  function setCollapsed(isCollapsed, options = {}) {
    state.collapsed = !!isCollapsed;
    const widget = state.shadowRoot?.getElementById(WIDGET_ID);
    const collapseButton = state.shadowRoot?.getElementById(COLLAPSE_ID);
    if (widget) {
      widget.dataset.collapsed = state.collapsed ? "true" : "false";
    }

    if (collapseButton) {
      collapseButton.setAttribute("aria-expanded", state.collapsed ? "false" : "true");
      collapseButton.setAttribute("aria-label", state.collapsed ? t("expandPanel") : t("collapsePanel"));
    }

    // The height changed: keep the widget inside the viewport.
    applyWidgetPosition();

    if (options.persist !== false) {
      saveUiPrefs();
    }
  }

  /**
   * Expands the widget (used after adding a track so the user sees it).
   * @param {boolean} isOpen - Whether the widget should be expanded.
   */
  function setPanelOpen(isOpen) {
    setCollapsed(!isOpen);
  }

  /**
   * Restores the collapsed state, position and tab saved in a previous visit.
   * The widget stays invisible until then to avoid a visible jump.
   */
  async function loadUiPrefs() {
    const widget = state.shadowRoot?.getElementById(WIDGET_ID);
    const storage = getStorageArea();

    try {
      if (storage) {
        const stored = await storage.get(UI_STORAGE_KEY);
        const prefs = stored?.[UI_STORAGE_KEY];
        if (prefs && typeof prefs === "object") {
          if (prefs.position && Number.isFinite(prefs.position.left) && Number.isFinite(prefs.position.bottom)) {
            state.uiPosition = { left: prefs.position.left, bottom: prefs.position.bottom };
          }

          if (prefs.activeTab === "saved" || prefs.activeTab === "history") {
            setActiveTab(prefs.activeTab, { persist: false });
          }

          setCollapsed(!!prefs.collapsed, { persist: false });
        }
      }
    } catch (error) {
      logWarn("ui:prefs-load-failed", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      // Position only once styles apply, otherwise the size is wrong.
      await state.stylesReady;
      applyWidgetPosition();
      if (widget) {
        widget.dataset.ready = "true";
        widget.style.removeProperty("visibility");
      }
    }
  }

  /**
   * Persists the widget's collapsed state, position and active tab.
   */
  function saveUiPrefs() {
    const storage = getStorageArea();
    if (!storage) {
      return;
    }

    const prefs = {
      collapsed: state.collapsed,
      activeTab: state.activeTab,
      position: state.uiPosition
    };

    try {
      Promise.resolve(storage.set({ [UI_STORAGE_KEY]: prefs })).catch((error) => {
        logWarn("ui:prefs-save-failed", { message: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      logWarn("ui:prefs-save-failed", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Builds the "Add track by ID" modal (hidden until opened).
   * @returns {HTMLElement} The modal overlay element.
   */
  function buildByIdModal() {
    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.dataset.open = "false";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        setModalOpen(false);
      }
    });

    // Keep keystrokes inside the modal so Komoot's own shortcuts don't fire while typing.
    for (const type of ["keydown", "keyup", "keypress"]) {
      overlay.addEventListener(type, (event) => {
        event.stopPropagation();
        if (type === "keydown" && event.key === "Escape") {
          setModalOpen(false);
        }
      });
    }

    const dialog = document.createElement("form");
    dialog.className = "komoot-gpx-export-modal-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", `${MODAL_ID}-title`);
    dialog.noValidate = true;
    dialog.addEventListener("submit", (event) => {
      event.preventDefault();
      handleAddById();
    });

    const title = document.createElement("h2");
    title.id = `${MODAL_ID}-title`;
    title.textContent = t("modalTitle");

    const hint = document.createElement("label");
    hint.htmlFor = MODAL_INPUT_ID;
    hint.className = "komoot-gpx-export-modal-hint";
    hint.textContent = t("modalHint");

    const input = document.createElement("input");
    input.id = MODAL_INPUT_ID;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "984826729";
    input.addEventListener("input", () => {
      setModalError("");
    });

    const error = document.createElement("div");
    error.id = MODAL_ERROR_ID;
    error.setAttribute("role", "alert");
    error.hidden = true;

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "komoot-gpx-export-modal-cancel";
    cancelButton.textContent = t("cancel");
    cancelButton.addEventListener("click", () => {
      setModalOpen(false);
    });

    const submitButton = document.createElement("button");
    submitButton.id = MODAL_SUBMIT_ID;
    submitButton.type = "submit";
    submitButton.textContent = t("add");

    const actions = document.createElement("div");
    actions.className = "komoot-gpx-export-modal-actions";
    actions.append(cancelButton, submitButton);

    dialog.append(title, hint, input, error, actions);
    overlay.append(dialog);
    return overlay;
  }

  /**
   * Opens or closes the "Add track by ID" modal.
   * @param {boolean} isOpen - Whether the modal should be visible.
   */
  function setModalOpen(isOpen) {
    const modal = state.shadowRoot?.getElementById(MODAL_ID);
    const input = state.shadowRoot?.getElementById(MODAL_INPUT_ID);
    if (!modal || !(input instanceof HTMLInputElement)) {
      return;
    }

    modal.dataset.open = isOpen ? "true" : "false";
    if (isOpen) {
      input.value = "";
      setModalError("");
      setModalBusy(false);
      setTimeout(() => input.focus(), 0);
    }
  }

  /**
   * Shows or clears the error message inside the modal.
   * @param {string} message - The error to show; empty to hide it.
   */
  function setModalError(message) {
    const error = state.shadowRoot?.getElementById(MODAL_ERROR_ID);
    if (!error) {
      return;
    }

    error.textContent = message;
    error.hidden = !message;
  }

  /**
   * Toggles the modal's loading state.
   * @param {boolean} isBusy - Whether a lookup is in progress.
   */
  function setModalBusy(isBusy) {
    const submit = state.shadowRoot?.getElementById(MODAL_SUBMIT_ID);
    const input = state.shadowRoot?.getElementById(MODAL_INPUT_ID);
    if (submit instanceof HTMLButtonElement) {
      submit.disabled = isBusy;
      submit.textContent = isBusy ? t("checking") : t("add");
    }

    if (input instanceof HTMLInputElement) {
      input.readOnly = isBusy;
    }
  }

  /**
   * Submit handler of the "Add track by ID" modal: validates the input,
   * checks that the tour exists and has coordinates, then adds it to the
   * saved list. Shows an error in the modal otherwise.
   */
  async function handleAddById() {
    const input = state.shadowRoot?.getElementById(MODAL_INPUT_ID);
    if (!(input instanceof HTMLInputElement) || input.readOnly) {
      return;
    }

    const candidates = parseTourIdInput(input.value);
    if (candidates.length === 0) {
      setModalError(t("errorInvalidId"));
      input.focus();
      return;
    }

    const references = candidates
      .map(({ rawId, kind, shareToken }) => buildReferenceFromTourId(rawId, kind, shareToken))
      .filter(Boolean);
    if (references.length === 0) {
      setModalError(t("errorUnsupportedId"));
      return;
    }

    setModalError("");
    setModalBusy(true);

    try {
      const { reference, name } = await resolveFirstAvailableTour(references);
      const result = registerTrack({ ...reference, name }, { makeActive: true, addToList: true, recordHistory: true });
      if (!result.track) {
        throw new Error(t("errorAddFailed"));
      }

      ensureTrackName(result.track);
      setModalOpen(false);
      setStatus(t(result.addedToList ? "statusAdded" : "statusAlreadyInList", describeTrack(result.track)), "success");
      setActiveTab("saved");
      setPanelOpen(true);
    } catch (error) {
      setModalBusy(false);
      setModalError(error instanceof Error ? error.message : t("errorLoadFailed"));
      input.focus();
    }
  }

  /**
   * Turns user input into the tour ids to try, in order:
   * - "e984826729" or ?focusedTour=…: a discover tour;
   * - ".../tour/984826729": a regular tour;
   * - a bare "984826729": ambiguous, so first a regular tour, then a smart tour.
   * Links of private tours keep their `share_token`.
   * @param {string} value - The raw input.
   * @returns {Array<{rawId: string, kind: "discover"|"tour", shareToken?: string|null}>} Candidates (empty if invalid).
   */
  function parseTourIdInput(value) {
    const text = String(value || "").trim();
    if (!text) {
      return [];
    }

    const idPattern = /^e?\d+$/i;
    if (idPattern.test(text)) {
      return /^e/i.test(text)
        ? [{ rawId: text, kind: "discover" }]
        : [{ rawId: text, kind: "tour" }, { rawId: text, kind: "discover" }];
    }

    try {
      const url = new URL(text);
      const shareToken = readShareToken(url);
      const focused = url.searchParams.get(FOCUSED_TOUR_PARAM);
      if (focused && idPattern.test(focused)) {
        return [{ rawId: focused, kind: "discover", shareToken }];
      }

      const tourMatch = url.pathname.match(/\/tours?\/(e?\d+)(?:[/?#]|$)/i);
      if (tourMatch) {
        return [{ rawId: tourMatch[1], kind: /^e/i.test(tourMatch[1]) ? "discover" : "tour", shareToken }];
      }

      const discoverMatch = url.pathname.match(/\/(?:smarttour|discover_tours)\/(e?\d+)(?:[/?#]|$)/i);
      if (discoverMatch) {
        return [{ rawId: discoverMatch[1], kind: "discover", shareToken }];
      }
    } catch (_error) {
      // Not a URL: fall through.
    }

    return [];
  }

  /**
   * Tries each candidate reference in order and returns the first one whose
   * track can be loaded. When none works, the most useful error is thrown
   * ("private" wins over "not found").
   * @param {Array<Object>} references - Candidate track references.
   * @returns {Promise<{reference: Object, name: string}>} The working reference and its name.
   */
  async function resolveFirstAvailableTour(references) {
    let bestError = null;
    for (const reference of references) {
      try {
        const name = await verifyTour(reference);
        return { reference, name };
      } catch (error) {
        const rank = { private: 3, network: 2, other: 1, notFound: 0 };
        if (!bestError || (rank[error?.kind] ?? 1) > (rank[bestError?.kind] ?? 1)) {
          bestError = error;
        }
      }
    }

    throw bestError || new Error(t("errorLoadFailed"));
  }

  /**
   * Creates an Error tagged with a category used to pick the best message.
   * @param {string} message - The user-facing message.
   * @param {"notFound"|"private"|"network"|"other"} kind - The error category.
   * @returns {Error} The tagged error.
   */
  function tourError(message, kind) {
    const error = new Error(message);
    error.kind = kind;
    return error;
  }

  /**
   * Checks that a tour exists and has a usable track, returning its name.
   * @param {Object} reference - Track reference built from the tour id.
   * @returns {Promise<string>} The tour name (empty if unknown).
   * @throws {Error} With a user-facing message when the tour cannot be used.
   */
  async function verifyTour(reference) {
    let coordinatesResponse;
    let metadataResponse;
    try {
      [coordinatesResponse, metadataResponse] = await Promise.all([
        fetch(reference.coordinatesUrl),
        fetch(reference.metadataUrl)
      ]);
    } catch (_error) {
      throw tourError(t("errorNetwork"), "network");
    }

    if (coordinatesResponse.status === 404) {
      throw tourError(t("errorNotFound", reference.tourId), "notFound");
    }

    if (coordinatesResponse.status === 401 || coordinatesResponse.status === 403) {
      throw tourError(t("errorPrivate", reference.tourId), "private");
    }

    if (!coordinatesResponse.ok) {
      throw tourError(t("errorKomootStatus", coordinatesResponse.status), "other");
    }

    let coordinates;
    try {
      coordinates = await coordinatesResponse.json();
    } catch (_error) {
      throw tourError(t("errorInvalidResponse"), "other");
    }

    if (!Array.isArray(coordinates?.items) || normalizeTrackPoints(coordinates.items).length < 2) {
      throw tourError(t("errorNoPoints", reference.tourId), "other");
    }

    if (!metadataResponse.ok) {
      return "";
    }

    try {
      const metadata = await metadataResponse.json();
      return typeof metadata?.name === "string" ? metadata.name.trim() : "";
    } catch (_error) {
      return "";
    }
  }

  /**
   * Switches the widget between the saved tracks and the history view.
   * @param {"saved"|"history"} tab - The tab to show.
   * @param {Object} [options]
   * @param {boolean} [options.persist=true] - Whether to remember the choice.
   */
  function setActiveTab(tab, options = {}) {
    state.activeTab = tab === "history" ? "history" : "saved";
    if (options.persist !== false) {
      saveUiPrefs();
    }

    const views = [
      [SAVED_TAB_ID, SAVED_VIEW_ID, "saved"],
      [HISTORY_TAB_ID, HISTORY_VIEW_ID, "history"]
    ];

    for (const [tabId, viewId, name] of views) {
      const isActive = state.activeTab === name;
      const tabButton = state.shadowRoot?.getElementById(tabId);
      const view = state.shadowRoot?.getElementById(viewId);
      if (tabButton) {
        tabButton.dataset.active = isActive ? "true" : "false";
        tabButton.setAttribute("aria-selected", isActive ? "true" : "false");
      }

      if (view) {
        view.hidden = !isActive;
      }
    }
  }

  /**
   * Attempts to discover tour endpoints from inline scripts on the page.
   * Updates the status message and active track accordingly.
   */
  function refreshDiscovery() {
    // The URL tells which tour is open (handled by watchFocusedTour); inline
    // page data is only a fallback for other tour pages, never for lists,
    // where it describes many tours at once.
    const endpoints = readPageTour() || isListPage() ? null : discoverTourEndpoints();

    if (endpoints) {
      const result = registerTrack(endpoints, { makeActive: true, recordHistory: true });
      ensureTrackName(result.track);
      setStatus(t("statusTourFound"), "success");
      setBusy(false);
      return;
    }

    if (state.endpoints) {
      setStatus(t("statusTrackDetected"), "success");
      setBusy(false);
      return;
    }

    setStatus(t("statusNoApiUrl"), "idle");
    setBusy(false);
  }

  /**
   * Click handler for the main "Add Trace" button. Discovers or uses
   * the currently active track endpoints and adds it to the saved list.
   */
  function handleAddTrace() {
    const endpoints = state.endpoints ?? (isListPage() ? null : discoverTourEndpoints());
    if (!endpoints) {
      setStatus(t("errorNoCoordinatesUrl"), "error");
      return;
    }

    const result = registerTrack(endpoints, { makeActive: true, addToList: true });
    if (!result.track) {
      setStatus(t("errorAddFailed"), "error");
      return;
    }

    const label = describeTrack(result.track);
    if (result.addedToList) {
      setStatus(t("statusAdded", label), "success");
    } else {
      setStatus(t("statusAlreadyInList", label), "success");
    }

    setPanelOpen(true);
  }

  /**
   * Handles downloading a specific track from the track panel by its coordinates URL.
   * @param {string} coordinatesUrl - The Komoot coordinates API URL identifying the track.
   */
  async function handleTrackDownload(coordinatesUrl) {
    const track = state.tracks.find((item) => item.coordinatesUrl === coordinatesUrl)
      || state.history.find((item) => item.coordinatesUrl === coordinatesUrl);
    if (!track) {
      setStatus(t("errorTrackGone"), "error");
      return;
    }

    try {
      setBusy(true);
      setStatus(t("statusPreparing", describeTrack(track)), "idle");
      registerTrack(track, { makeActive: true });
      await downloadTrack(track);
      setStatus(t("statusDownloaded", buildFileName(track.name || `komoot-tour-${track.tourId || "track"}`)), "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("errorExportFailed"), "error");
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
    let [coordinatesPayload, metadataPayload] = await Promise.all([
      fetchJson(reference.coordinatesUrl).catch((error) => ({ error })),
      reference.metadataUrl ? fetchJson(reference.metadataUrl).catch(() => null) : Promise.resolve(null)
    ]);

    // The API may refuse a tour the page itself could show (e.g. private
    // tours): fall back to the data Komoot embeds in the page HTML.
    if (!Array.isArray(coordinatesPayload?.items)) {
      const inlineTour = readInlineTour(reference.tourId);
      if (inlineTour) {
        logDebug("download:inline-fallback", { tourId: reference.tourId, points: inlineTour.items.length });
        coordinatesPayload = { items: inlineTour.items };
        metadataPayload = metadataPayload || { name: inlineTour.name };
      } else if (coordinatesPayload?.error) {
        throw coordinatesPayload.error;
      }
    }

    if (!Array.isArray(coordinatesPayload.items)) {
      throw new Error(t("errorInvalidResponse"));
    }

    const trackPoints = normalizeTrackPoints(coordinatesPayload.items);
    if (trackPoints.length < 2) {
      throw new Error(t("errorNotEnoughPoints"));
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
        logDebug("payload:json-invalid", { requestUrl });
        return;
      }
    }

    if (!data || typeof data !== "object") {
      logDebug("payload:invalid-shape", { requestUrl, type: typeof data });
      return;
    }

    const coordinatesHref = data?._links?.coordinates?.href;
    if (typeof coordinatesHref !== "string" || !coordinatesHref.trim()) {
      logDebug("payload:missing-coordinates-link", { requestUrl });
      return;
    }

    const parsed = parseCoordinatesUrl(coordinatesHref);
    const discoverId = extractDiscoverTourId(requestUrl);
    const tourId = parsed?.tourId || discoverId;
    const resourceName = parsed?.resourceName || "discover_tours";
    const coordinatesUrl = parsed?.coordinatesUrl || toAbsoluteUrl(coordinatesHref);
    const trackName = typeof data.name === "string" ? data.name.trim() : "";

    if (!coordinatesUrl) {
      logDebug("payload:coordinates-url-invalid", { requestUrl, coordinatesHref });
      return;
    }

    logDebug("payload:track-discovered", {
      requestUrl,
      coordinatesUrl,
      tourId,
      resourceName,
      trackName
    });

    const metadataUrl = discoverId
      ? `https://api.komoot.de/${API_VERSION}/discover_tours/${discoverId.toLowerCase()}`
      : (tourId ? `https://api.komoot.de/${API_VERSION}/${resourceName}/${tourId}/` : null);
    const reference = {
      coordinatesUrl,
      metadataUrl,
      resourceName,
      tourId,
      name: trackName,
      pageUrl: location.href
    };

    if (discoverId) {
      cacheDiscoveredTour(discoverId, reference);
    }

    // Komoot prefetches the tours of the list it shows: only the tour that is
    // actually open according to the URL becomes active and goes into the
    // history. On list pages with no open tour, responses are only cached.
    const pageTour = readPageTour();
    if (!pageTour || pageTour.kind !== "discover" || !discoverId || pageTour.rawId !== discoverId.toLowerCase()) {
      logDebug("payload:prefetch-cached", { discoverId, pageTour: pageTour?.rawId || null });
      return;
    }

    const result = registerTrack(reference, { makeActive: true, recordHistory: true });
    if (result.track) {
      logDebug("track:active-updated", { label: describeTrack(result.track), coordinatesUrl: result.track.coordinatesUrl });
      setStatus(t("statusSelected", describeTrack(result.track)), "success");
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
      const pathMatch = parsedUrl.pathname.match(new RegExp(`^/api/${API_VERSION}/discover_tours/(e?\\d+)/?$`, "i"));
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
   * @param {boolean} [options.recordHistory=false] - Whether this is a fresh detection that should be added to (or moved to the top of) the history.
   * @returns {{becameActive: boolean, addedToList: boolean, track: Object|null}} Whether the active track changed, whether it was added to the list, and the registered track.
   */
  function registerTrack(reference, options = {}) {
    if (!reference?.coordinatesUrl) {
      return { becameActive: false, addedToList: false, track: null };
    }

    const now = Date.now();
    const existingIndex = state.tracks.findIndex((item) => item.coordinatesUrl === reference.coordinatesUrl);
    const existing = existingIndex >= 0 ? state.tracks[existingIndex] : null;
    const known = existing || state.history.find((item) => item.coordinatesUrl === reference.coordinatesUrl) || null;

    const track = {
      coordinatesUrl: reference.coordinatesUrl,
      metadataUrl: reference.metadataUrl || known?.metadataUrl || null,
      resourceName: reference.resourceName || known?.resourceName || null,
      tourId: reference.tourId || known?.tourId || null,
      name: reference.name || known?.name || "",
      pageUrl: reference.pageUrl || known?.pageUrl || location.href,
      lastSeenAt: now
    };

    // Keep the saved list entry in sync (e.g. when a name gets resolved later).
    if (existing && !options.addToList) {
      const updated = { ...existing, ...track, lastSeenAt: existing.lastSeenAt };
      if (JSON.stringify(updated) !== JSON.stringify(existing)) {
        state.tracks[existingIndex] = updated;
        saveTracks();
      }
    }

    recordHistory(track, { bump: !!options.recordHistory });

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
      saveTracks();
    }

    let becameActive = false;
    if (options.makeActive !== false) {
      becameActive = state.endpoints?.coordinatesUrl !== track.coordinatesUrl;
      state.endpoints = track;
    } else if (state.endpoints?.coordinatesUrl === track.coordinatesUrl) {
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
    saveTracks();
    logDebug("track:removed", { coordinatesUrl, total: state.tracks.length });
    renderTrackList();
  }

  /**
   * Adds or updates a track in the history of detected tracks.
   * Existing entries are always refreshed with the newest data (e.g. a name
   * resolved later); new entries are only created on a fresh detection.
   * @param {Object} track - The registered track.
   * @param {Object} [options]
   * @param {boolean} [options.bump=false] - Whether this is a fresh detection: creates the entry or moves it to the top.
   */
  function recordHistory(track, options = {}) {
    const index = state.history.findIndex((item) => item.coordinatesUrl === track.coordinatesUrl);
    const previous = index >= 0 ? state.history[index] : null;

    if (!previous && !options.bump) {
      return;
    }

    const entry = {
      coordinatesUrl: track.coordinatesUrl,
      metadataUrl: track.metadataUrl || previous?.metadataUrl || null,
      resourceName: track.resourceName || previous?.resourceName || null,
      tourId: track.tourId || previous?.tourId || null,
      name: track.name || previous?.name || "",
      pageUrl: track.pageUrl || previous?.pageUrl || null,
      seenAt: options.bump ? Date.now() : (previous?.seenAt ?? Date.now())
    };

    if (previous && !options.bump && isSameHistoryEntry(previous, entry)) {
      return;
    }

    if (index >= 0) {
      state.history.splice(index, 1);
    }

    if (options.bump) {
      state.history.unshift(entry);
    } else {
      state.history.splice(index, 0, entry);
    }

    if (state.history.length > MAX_HISTORY) {
      state.history.length = MAX_HISTORY;
    }

    saveHistory();
  }

  /**
   * Compares the persisted fields of two history entries.
   * @param {Object} a - First entry.
   * @param {Object} b - Second entry.
   * @returns {boolean} True when nothing worth saving changed.
   */
  function isSameHistoryEntry(a, b) {
    return a.metadataUrl === b.metadataUrl
      && a.resourceName === b.resourceName
      && a.tourId === b.tourId
      && a.name === b.name
      && a.pageUrl === b.pageUrl;
  }

  /**
   * Removes a single entry from the history.
   * @param {string} coordinatesUrl - The Komoot coordinates API URL identifying the track.
   */
  function removeFromHistory(coordinatesUrl) {
    const index = state.history.findIndex((item) => item.coordinatesUrl === coordinatesUrl);
    if (index < 0) {
      return;
    }

    state.history.splice(index, 1);
    saveHistory();
    renderTrackList();
  }

  /**
   * Click handler for the "Clear history" button.
   */
  function handleClearHistory() {
    if (state.history.length === 0) {
      return;
    }

    if (!window.confirm(t("confirmClearHistory", state.history.length))) {
      return;
    }

    state.history = [];
    saveHistory();
    renderTrackList();
    setStatus(t("statusHistoryCleared"), "success");
  }

  /**
   * Returns the extension's local storage area, if available.
   * @returns {Object|null} The storage.local area, or null.
   */
  function getStorageArea() {
    return extensionApi?.storage?.local ?? null;
  }

  /**
   * Loads the persisted lists (history and saved tracks) and merges them with
   * anything added while loading. Also keeps them in sync across open Komoot
   * tabs.
   */
  async function loadPersistedLists() {
    const storage = getStorageArea();
    if (!storage) {
      logWarn("storage:unavailable");
      return;
    }

    // Sync with writes made by other Komoot tabs. Notifications of this tab's
    // own writes arrive asynchronously (possibly after newer changes) and are
    // ignored, otherwise they would roll the list back.
    extensionApi.storage.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      let changed = false;
      for (const [name, config] of Object.entries(PERSISTED_LISTS)) {
        const sync = state.persistence[name];
        if (!changes[config.key] || !sync.loaded) {
          continue;
        }

        const incoming = sanitizeList(changes[config.key].newValue, config.max);
        const json = JSON.stringify(incoming);
        if (sync.recentWrites.has(json) || json === JSON.stringify(state[name])) {
          continue;
        }

        state[name] = incoming;
        changed = true;
      }

      if (changed) {
        renderTrackList();
      }
    });

    const names = Object.keys(PERSISTED_LISTS);
    let stored = {};
    try {
      stored = (await storage.get(names.map((name) => PERSISTED_LISTS[name].key))) || {};
    } catch (error) {
      logWarn("storage:load-failed", { message: error instanceof Error ? error.message : String(error) });
    }

    for (const name of names) {
      const config = PERSISTED_LISTS[name];
      const sync = state.persistence[name];
      const persisted = sanitizeList(stored[config.key], config.max);
      const seen = new Set(state[name].map((item) => item.coordinatesUrl));
      const merged = [...state[name]];

      for (const entry of persisted) {
        if (!seen.has(entry.coordinatesUrl)) {
          seen.add(entry.coordinatesUrl);
          merged.push(entry);
        }
      }

      state[name] = merged.slice(0, config.max);
      sync.loaded = true;
      logDebug("storage:loaded", { list: name, persisted: persisted.length, total: state[name].length });

      // Persist what was added while loading, merged with the stored entries.
      if (sync.pending) {
        sync.pending = false;
        savePersistedList(name);
      }
    }

    // The active track may be a saved one that only now got its full data.
    renderTrackList();
  }

  /**
   * Persists one list ("history" or "tracks") to the extension's local storage.
   * @param {"history"|"tracks"} name - The list to save.
   */
  function savePersistedList(name) {
    const storage = getStorageArea();
    const config = PERSISTED_LISTS[name];
    const sync = state.persistence[name];
    if (!storage || !config) {
      return;
    }

    // Writing before the stored list is loaded would drop older entries.
    if (!sync.loaded) {
      sync.pending = true;
      return;
    }

    const json = JSON.stringify(state[name]);
    sync.recentWrites.add(json);
    if (sync.recentWrites.size > 20) {
      sync.recentWrites.delete(sync.recentWrites.values().next().value);
    }

    try {
      Promise.resolve(storage.set({ [config.key]: state[name] })).catch((error) => {
        logWarn("storage:save-failed", { list: name, message: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      logWarn("storage:save-failed", { list: name, message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Persists the history of detected tracks.
   */
  function saveHistory() {
    savePersistedList("history");
  }

  /**
   * Persists the saved tracks list.
   */
  function saveTracks() {
    savePersistedList("tracks");
  }

  /**
   * Validates persisted list data, dropping malformed entries.
   * @param {*} value - The raw stored value.
   * @param {number} max - Maximum number of entries to keep.
   * @returns {Array<Object>} A clean list.
   */
  function sanitizeList(value, max) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item) => item && typeof item.coordinatesUrl === "string" && item.coordinatesUrl)
      .slice(0, max);
  }

  /**
   * Downloads all tracks in the saved list sequentially.
   * Shows progress in the status bar and reports results.
   */
  async function handleDownloadAll() {
    if (state.tracks.length === 0) {
      setStatus(t("errorNothingToDownload"), "error");
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
        setStatus(t("statusDownloadingProgress", i + 1, total, label), "idle");

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
        setStatus(t("statusDownloadedCount", succeeded), "success");
      } else {
        setStatus(t("statusDownloadedPartial", succeeded, total, failed), "error");
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
   * Re-renders both panel lists (saved tracks and history) from the current
   * state, and updates the toggle and tab counters.
   */
  function renderTrackList() {
    const list = state.shadowRoot?.getElementById(TRACK_LIST_ID);
    const empty = state.shadowRoot?.getElementById(EMPTY_ID);
    const historyList = state.shadowRoot?.getElementById(HISTORY_LIST_ID);
    const historyEmpty = state.shadowRoot?.getElementById(HISTORY_EMPTY_ID);
    const badge = state.shadowRoot?.getElementById(BADGE_ID);
    const downloadAllButton = state.shadowRoot?.getElementById(DOWNLOAD_ALL_ID);
    const clearHistoryButton = state.shadowRoot?.getElementById(CLEAR_HISTORY_ID);
    const savedTab = state.shadowRoot?.getElementById(SAVED_TAB_ID);
    const historyTab = state.shadowRoot?.getElementById(HISTORY_TAB_ID);
    if (!(list instanceof HTMLUListElement) || !empty) {
      return;
    }

    if (badge) {
      badge.textContent = String(state.tracks.length);
      badge.hidden = state.tracks.length === 0;
    }

    if (savedTab) {
      savedTab.textContent = t("tabSaved", state.tracks.length);
    }

    if (historyTab) {
      historyTab.textContent = t("tabHistory", state.history.length);
    }

    if (downloadAllButton) {
      downloadAllButton.parentElement.hidden = state.tracks.length === 0;
    }

    if (clearHistoryButton) {
      clearHistoryButton.parentElement.hidden = state.history.length === 0;
    }

    fillList(list, empty, state.tracks, "saved");
    if (historyList instanceof HTMLUListElement && historyEmpty) {
      fillList(historyList, historyEmpty, state.history, "history");
    }
  }

  /**
   * Replaces the content of a panel list with one item per track.
   * @param {HTMLUListElement} list - The list element.
   * @param {HTMLElement} empty - The placeholder shown when there are no tracks.
   * @param {Array<Object>} tracks - The tracks to render.
   * @param {"saved"|"history"} mode - Which list is being rendered.
   */
  function fillList(list, empty, tracks, mode) {
    while (list.firstChild) {
      list.firstChild.remove();
    }

    empty.hidden = tracks.length > 0;
    list.hidden = tracks.length === 0;

    for (const track of tracks) {
      list.append(buildTrackItem(track, mode));
    }
  }

  /**
   * Builds a single list item for the saved list or the history.
   * @param {Object} track - The track to render.
   * @param {"saved"|"history"} mode - Which list the item belongs to.
   * @returns {HTMLLIElement} The list item.
   */
  function buildTrackItem(track, mode) {
    const item = document.createElement("li");
    item.className = "komoot-gpx-export-track-item";
    item.dataset.active = state.endpoints?.coordinatesUrl === track.coordinatesUrl ? "true" : "false";

    const title = document.createElement("button");
    title.type = "button";
    title.className = "komoot-gpx-export-track-title";
    title.textContent = track.name || `komoot-tour-${track.tourId || "track"}`;
    title.title = t("selectTrackTitle");
    title.addEventListener("click", () => {
      registerTrack(track, { makeActive: true });
      ensureTrackName(track);
      setStatus(t("statusSelected", describeTrack(track)), "success");
    });

    const meta = document.createElement("div");
    meta.className = "komoot-gpx-export-track-meta";
    const idLabel = track.tourId ? t("idLabel", track.tourId) : t("unknownId");
    meta.textContent = mode === "history" && track.seenAt ? `${idLabel} \u00b7 ${formatSeenAt(track.seenAt)}` : idLabel;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "komoot-gpx-export-track-remove";
    removeButton.textContent = "\u00d7";
    removeButton.title = mode === "history" ? t("removeFromHistory") : t("removeFromList");
    removeButton.addEventListener("click", () => {
      if (mode === "history") {
        removeFromHistory(track.coordinatesUrl);
      } else {
        removeTrack(track.coordinatesUrl);
      }
    });

    const actions = document.createElement("div");
    actions.className = "komoot-gpx-export-track-actions";

    if (mode === "history") {
      const isSaved = state.tracks.some((saved) => saved.coordinatesUrl === track.coordinatesUrl);
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "komoot-gpx-export-track-add";
      addButton.textContent = isSaved ? t("savedState") : t("add");
      addButton.disabled = isSaved;
      addButton.title = isSaved ? t("alreadySavedTitle") : t("addToSavedTitle");
      addButton.addEventListener("click", () => {
        const result = registerTrack(track, { makeActive: false, addToList: true });
        if (result.track) {
          setStatus(t("statusAdded", describeTrack(result.track)), "success");
        }
      });
      actions.append(addButton);
    }

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "komoot-gpx-export-track-download";
    downloadButton.textContent = t("download");
    downloadButton.addEventListener("click", () => {
      handleTrackDownload(track.coordinatesUrl);
    });
    actions.append(downloadButton);

    item.append(title, removeButton, meta, actions);
    return item;
  }

  /**
   * Formats a history timestamp as a short local date and time.
   * @param {number} timestamp - Milliseconds since epoch.
   * @returns {string} The formatted date.
   */
  function formatSeenAt(timestamp) {
    try {
      return new Date(timestamp).toLocaleString(getUiLanguage(), {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (_error) {
      return "";
    }
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

    // Only real tracks: highlights, for example, also expose /coordinates but
    // as a single point, which cannot become a GPX track.
    const trackResources = new Set(["tours", "smart_tours"]);
    const pattern = new RegExp(DISCOVERY_PATTERN.source, "gi");

    for (const source of sources) {
      const normalized = source.replace(/\\\//g, "/");
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(normalized)) && !trackResources.has(match[1].toLowerCase())) {
        // Skip non-track resources.
      }

      if (!match) {
        continue;
      }

      const shareToken = readPageTour()?.shareToken || null;
      const coordinatesUrl = withShareToken(match[0], shareToken);
      const resourceName = match[1];
      const tourId = match[2];

      return {
        coordinatesUrl,
        metadataUrl: withShareToken(`https://api.komoot.de/${API_VERSION}/${resourceName}/${tourId}/`, shareToken),
        resourceName,
        tourId,
        name: "",
        pageUrl: location.href
      };
    }

    return null;
  }

  /**
   * Reads a tour embedded in the page HTML by Komoot, through
   * `kmtBoot.setProps("<json>")`, at `page._embedded.tour`.
   * @param {string|null} tourId - The numeric tour id the data must belong to.
   * @returns {{items: Array<Object>, name: string}|null} The coordinates and name, or null.
   */
  function readInlineTour(tourId) {
    if (!tourId) {
      return null;
    }

    const marker = "kmtBoot.setProps(";
    for (const script of document.scripts) {
      const source = script.textContent || "";
      const start = source.indexOf(marker);
      if (start < 0) {
        continue;
      }

      const literal = readStringLiteral(source, start + marker.length);
      if (!literal) {
        continue;
      }

      try {
        const props = JSON.parse(JSON.parse(literal));
        const tour = props?.page?._embedded?.tour;
        const items = tour?._embedded?.coordinates?.items;
        if (String(tour?.id) === String(tourId) && Array.isArray(items)) {
          return { items, name: typeof tour.name === "string" ? tour.name.trim() : "" };
        }
      } catch (_error) {
        logDebug("inline-tour:parse-failed", { tourId });
      }
    }

    return null;
  }

  /**
   * Extracts a double-quoted string literal (quotes included) starting at
   * the given index, without a regex: the literal can be megabytes long.
   * @param {string} source - The script source.
   * @param {number} index - Index of the opening quote.
   * @returns {string|null} The literal, or null if there is none.
   */
  function readStringLiteral(source, index) {
    if (source[index] !== '"') {
      return null;
    }

    for (let i = index + 1; i < source.length; i += 1) {
      if (source[i] === "\\") {
        i += 1;
      } else if (source[i] === '"') {
        return source.slice(index, i + 1);
      }
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
      throw new Error(t("errorRequestFailed", response.status));
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
    button.textContent = isBusy ? t("downloading") : t("addTrace");
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
    status.title = text;
    status.dataset.state = stateName;
  }
})();
