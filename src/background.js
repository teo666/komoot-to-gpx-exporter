(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;

  if (!extensionApi?.runtime?.onMessage) {
    return;
  }

  extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "komoot-gpx:download") {
      return false;
    }

    /**
     * Internal async function to perform the download and handle errors.
     * @returns {Promise<{ok: boolean, downloadId?: number, error?: string}>}
     */
    const performDownload = async () => {
      if (!message.filename || !message.url) {
        throw new Error("Missing download payload.");
      }

      if (!extensionApi.downloads?.download) {
        throw new Error("Downloads API is unavailable.");
      }

      const downloadId = await downloadCompat({
        url: message.url,
        filename: message.filename,
        saveAs: false,
        conflictAction: "uniquify"
      });

      return { ok: true, downloadId };
    };

    if (typeof sendResponse === "function") {
      performDownload()
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    return performDownload();
  });

  /**
   * Cross-browser compatible wrapper for chrome.downloads.download.
   * Handles both callback-style and promise-style runtime APIs.
   * @param {Object} options - Download options for the browser.
   * @returns {Promise<number>} The download identifier.
   */
  function downloadCompat(options) {
    return new Promise((resolve, reject) => {
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
        const maybePromise = extensionApi.downloads.download(options, (downloadId) => {
          const runtimeError = globalThis.chrome?.runtime?.lastError;
          if (runtimeError) {
            onReject(new Error(runtimeError.message));
            return;
          }

          onResolve(downloadId);
        });

        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(onResolve).catch(onReject);
        }
      } catch (error) {
        onReject(error);
      }
    });
  }
})();
