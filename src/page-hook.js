(() => {
  const EVENT_TYPE = "komoot-gpx:page-network";
  const API_VERSION = "v007";
  const SOURCE = "komoot-gpx-page-hook";
  const DISCOVER_PATTERN = new RegExp(`/api/${API_VERSION}/discover_tours/([^/?#]+)(?:[/?#]|$)`, "i");

  if (window.__komootGpxPageHookInstalled) {
    return;
  }

  window.__komootGpxPageHookInstalled = true;

  /**
   * Resolves a relative or absolute URL string against the current page location.
   * @param {string} url - The URL to resolve.
   * @returns {string|null} The resolved absolute URL, or null on failure.
   */
  const toAbsoluteUrl = (url) => {
    if (typeof url !== "string" || !url.trim()) {
      return null;
    }

    try {
      return new URL(url, location.href).href;
    } catch (_error) {
      return null;
    }
  };

  /**
   * Extracts and normalizes the URL from a fetch/XHR request input.
   * @param {string|Request} requestInfo - A URL string or Request object.
   * @returns {string|null} The absolute URL, or null if extraction fails.
   */
  const extractRequestUrl = (requestInfo) => {
    try {
      if (typeof requestInfo === "string") {
        return toAbsoluteUrl(requestInfo);
      }

      if (requestInfo && typeof requestInfo.url === "string") {
        return toAbsoluteUrl(requestInfo.url);
      }
    } catch (_error) {
      return null;
    }

    return null;
  };

  /**
   * Checks whether a URL points to a Komoot discover-tour API endpoint.
   * @param {string} url - The URL to test.
   * @returns {boolean} True if the URL matches the discover-tour pattern.
   */
  const isDiscoverTourUrl = (url) => {
    const normalized = toAbsoluteUrl(url);
    if (!normalized) {
      return false;
    }

    try {
      const pathname = new URL(normalized).pathname;
      return new RegExp(`^/api/${API_VERSION}/discover_tours/[^/?#]+/?$`, "i").test(pathname) || DISCOVER_PATTERN.test(normalized);
    } catch (_error) {
      return DISCOVER_PATTERN.test(normalized);
    }
  };

  /**
   * Emits intercepted request data to the content script via postMessage.
   * @param {string} channel - The source of the interception (e.g., 'fetch', 'xhr-json').
   * @param {string} requestUrl - The absolute URL of the intercepted request.
   * @param {number} status - The HTTP response status code.
   * @param {string|Object} payload - The response body content.
   */
  const emit = (channel, requestUrl, status, payload) => {
    window.postMessage({
      type: EVENT_TYPE,
      source: SOURCE,
      channel,
      requestUrl,
      status,
      payload
    }, window.location.origin);
  };

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const requestUrl = extractRequestUrl(args[0]);
      const response = await originalFetch(...args);
      const responseUrl = requestUrl || response.url;

      if (isDiscoverTourUrl(responseUrl) && response.ok) {
        try {
          const text = await response.clone().text();
          if (text) {
            emit("fetch", responseUrl, response.status, text);
          }
        } catch (_error) {
        }
      }

      return response;
    };
  }

  if (window.XMLHttpRequest?.prototype?.open && window.XMLHttpRequest?.prototype?.send) {
    const xhrPrototype = window.XMLHttpRequest.prototype;
    const originalOpen = xhrPrototype.open;
    const originalSend = xhrPrototype.send;

    xhrPrototype.open = function patchedOpen(method, url, ...rest) {
      this.__komootGpxPageRequestUrl = extractRequestUrl(url);
      return originalOpen.call(this, method, url, ...rest);
    };

    xhrPrototype.send = function patchedSend(...args) {
      if (!this.__komootGpxPageListenerAttached) {
        this.__komootGpxPageListenerAttached = true;
        this.addEventListener("load", () => {
          const requestUrl = this.__komootGpxPageRequestUrl || this.responseURL;
          if (!isDiscoverTourUrl(requestUrl) || this.status < 200 || this.status >= 300) {
            return;
          }

          if (this.responseType === "json" && this.response) {
            emit("xhr-json", requestUrl, this.status, this.response);
            return;
          }

          if (typeof this.responseText === "string" && this.responseText) {
            emit("xhr-text", requestUrl, this.status, this.responseText);
          }
        });
      }

      return originalSend.call(this, ...args);
    };
  }
})();
