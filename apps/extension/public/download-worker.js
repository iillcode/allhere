(() => {
  // Keep persisted jobs and their pending alarm across the Stashwell upgrade.
  const KEY = "allhere.downloads.v1";
  const ALARM = "allhere.downloads.refresh";
  const active = job => ["preparing", "queued", "downloading", "processing", "saving"].includes(job.state);
  const youtubePage = value => {
    try {
      const url = new URL(value);
      return url.hostname === "youtu.be" || (/^(?:www\.|m\.)?youtube(?:-nocookie)?\.com$/.test(url.hostname) && (url.pathname === "/watch" || /^\/(?:embed|shorts|live)\//.test(url.pathname)));
    } catch { return false; }
  };
  let queue = Promise.resolve();
  const serial = fn => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; };
  const read = async () => (await chrome.storage.local.get(KEY))[KEY] || [];
  const isMedia = job => job.kind === "audio" || job.kind === "video";
  const mediaDocumentUrl = chrome.runtime.getURL("media.html");
  const mediaDocumentOpen = async () => chrome.runtime.getContexts
    ? (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [mediaDocumentUrl] })).length > 0
    : (await self.clients.matchAll({ includeUncontrolled: true })).some(client => client.url === mediaDocumentUrl);
  const releaseMedia = id => chrome.runtime.sendMessage({ type: "stashwell.media.release", id }).catch(() => {});
  const closeMediaIfIdle = async jobs => {
    if (!jobs.some(job => active(job) && isMedia(job) && (job.state === "preparing" || job.mediaBlob)) && await mediaDocumentOpen()) {
      await chrome.offscreen.closeDocument();
    }
  };
  const write = async jobs => {
    // Retain every active job, even when more than thirty downloads have been started.
    const recent = jobs.filter(job => !active(job)).slice(0, 30);
    await chrome.storage.local.set({ [KEY]: jobs.filter(job => active(job) || recent.includes(job)) });
    if (jobs.some(active)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    else await chrome.alarms.clear(ALARM);
  };
  const safeUrl = value => {
    const url = new URL(value);
    if ((!/^https?:$/.test(url.protocol) && !value.startsWith(`blob:chrome-extension://${chrome.runtime.id}/`)) || url.username || url.password) throw Error("Use a direct HTTP or HTTPS file address.");
    return url.href;
  };
  const update = (id, patch) => serial(async () => {
    const jobs = await read();
    const job = jobs.find(entry => entry.id === id);
    if (!job || !active(job)) return;
    Object.assign(job, patch);
    await write(jobs);
    return true;
  });
  const refresh = () => serial(async () => {
    const jobs = await read();
    let changed = false;
    for (const job of jobs) {
      if (!active(job)) continue;
      if (typeof job.browserId !== "number" && ((job.state === "queued" && Date.now() - job.createdAt > 30_000) ||
        (job.state === "preparing" && Date.now() - job.createdAt > 150_000))) {
        Object.assign(job, { state: "failed", error: "The browser did not finish preparing this download. Try again." });
        if (isMedia(job)) await releaseMedia(job.id);
        changed = true;
        continue;
      }
      if (typeof job.browserId !== "number") continue;
      const [download] = await chrome.downloads.search({ id: job.browserId });
      // Chrome fetches large direct files itself. A signed link may expire or return a different response by then.
      if (download && job.videoResponse) {
        const { bytes, mime } = job.videoResponse;
        const actualType = (download.mime || "").split(";")[0].toLowerCase();
        const changedType = actualType !== mime && /^(?:text\/|application\/(?:json|xml|dash\+xml|(?:vnd\.apple\.|x-)mpegurl))/.test(actualType);
        const changedSize = bytes > 0 && download.state === "complete" && download.bytesReceived !== bytes;
        if (changedType || changedSize) {
          if (download.state === "in_progress") await chrome.downloads.cancel(download.id).catch(() => {});
          else if (download.state === "complete") await chrome.downloads.removeFile(download.id).catch(() => {});
          Object.assign(job, { state: "failed", error: "The host changed the file during download. Scan the source page for a fresh link." });
          changed = true;
          continue;
        }
      }
      const state = !download ? "failed" : download.state === "complete" ? "complete" : download.state === "interrupted" ? "failed" : "downloading";
      const patch = { state, received: download?.bytesReceived || 0, total: Math.max(0, download?.totalBytes || 0),
        filename: download?.filename?.split(/[\\/]/).pop() || job.filename,
        error: state === "failed" ? `Download interrupted: ${(download?.error || "check your connection").replaceAll("_", " ").toLowerCase()}.` : undefined };
      if (Object.entries(patch).some(([key, value]) => job[key] !== value)) { Object.assign(job, patch); changed = true; }
      if (job.mediaBlob && !active(job)) { await releaseMedia(job.id); delete job.mediaBlob; }
    }
    if (changed) { await write(jobs); await closeMediaIfIdle(jobs); }
    return jobs;
  });
  const prepareMedia = async (job, variantUrls, mimeType) => {
    await serial(async () => {
      if (!await mediaDocumentOpen()) await chrome.offscreen.createDocument({ url: "media.html", reasons: ["BLOBS"],
        justification: "Verify media files and assemble on-demand video segments into a downloadable file." });
    });
    const result = await chrome.runtime.sendMessage({ type: "stashwell.media.prepare", id: job.id, kind: job.kind, url: job.url, variantUrls, mimeType });
    if (!result?.ok) throw Error(result?.error || "The media could not be prepared. Reload the extension and try again.");
    return result;
  };
  const findExtension = async url => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await fetch(url, { method: "HEAD", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
      if (!response.ok) return;
      const disposition = response.headers.get("content-disposition") || "";
      const suggested = disposition.match(/(?:^|;)\s*filename\*?\s*=\s*"?([^";]+)/i)?.[1]?.trim();
      const extension = suggested?.match(/\.([a-z\d]{1,12})$/i)?.[1].toLowerCase();
      const formats = { "application/pdf": "pdf", "application/zip": "zip", "application/json": "json",
        "text/plain": "txt", "text/csv": "csv", "text/css": "css", "application/javascript": "js" };
      return extension || formats[response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()];
    } catch { /* Let the browser name a file whose type could not be verified. */ }
    finally { clearTimeout(timer); }
  };
  const begin = async (job, input) => {
    let media;
    try {
      if (!await chrome.permissions.contains({ permissions: ["downloads"] })) throw Error("Reload Stashwell on the browser's extensions page to enable downloads.");
      const remote = /^https?:/.test(job.url);
      if (remote) {
        const site = new URL(job.url);
        if (!await chrome.permissions.contains({ origins: [`${site.protocol}//${site.hostname}/*`] })) {
          throw Error("Choose Download and allow access to the file's website.");
        }
      }
      const unknownExtension = !/\.[a-z0-9]{1,12}$/i.test(job.filename) || /\.(?:audio|video|bin|dat|download)$/i.test(job.filename);
      if (remote && isMedia(job)) {
        const variants = [];
        for (const candidate of new Set(input.variantUrls || [])) {
          const url = new URL(safeUrl(candidate));
          if (/^https?:$/.test(url.protocol) && !youtubePage(url.href) && await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) variants.push(url.href);
        }
        media = await prepareMedia(job, variants, input.mimeType);
      }
      const extension = media?.extension || (remote && job.nameFromItem && unknownExtension ? await findExtension(job.url) : undefined);
      if (extension && (media || job.nameFromItem || unknownExtension)) {
        job.filename = job.filename.replace(/\.[a-z0-9]{1,12}$/i, "") + `.${extension}`;
      }
      await serial(async () => {
        const jobs = await read();
        const current = jobs.find(entry => entry.id === job.id);
        if (!current || !active(current)) { if (media) await releaseMedia(job.id); return; }
        const useItemName = !!media || !remote || (job.nameFromItem && (!!extension || !unknownExtension));
        const browserId = await chrome.downloads.download({ url: media?.url || job.url, ...(useItemName ? { filename: job.filename } : {}), conflictAction: "uniquify", saveAs: false });
        Object.assign(current, { browserId, state: "downloading", filename: job.filename,
          ...(media?.url.startsWith("blob:") ? { mediaBlob: true }
            : media && job.kind === "video" ? { videoResponse: { bytes: media.expectedBytes, mime: media.responseMime } } : {}) });
        await write(jobs);
      });
    } catch (error) {
      if (media) await releaseMedia(job.id);
      await update(job.id, { state: "failed", error: error.message || "Download failed. Scan the source page and try again." });
    } finally { if (isMedia(job)) await serial(async () => closeMediaIfIdle(await read())); }
  };
  const start = async (input, fromPanel = false) => {
    if (!input || typeof input.url !== "string") throw Error("Choose a file address to download.");
    const url = safeUrl(input.url);
    if (youtubePage(url)) throw Error("YouTube downloads are not supported. Copy the URL to open the video on YouTube.");
    const filename = String(input.filename || "stashwell-download").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0, 180);
    const job = { id: crypto.randomUUID(), title: String(input.title || filename).slice(0, 300), url,
      filename, state: fromPanel ? "queued" : "preparing", received: 0, total: 0, createdAt: Date.now(), kind: input.kind,
      nameFromItem: input.nameFromItem === true };
    await serial(async () => { const jobs = await read(); jobs.unshift(job); await write(jobs); });
    if (fromPanel) return job;
    // Keep the response channel open until the browser download has started.
    await begin(job, input);
    return (await read()).find(entry => entry.id === job.id);
  };
  const cancel = id => serial(async () => {
    const jobs = await read();
    const job = jobs.find(entry => entry.id === id);
    if (job && active(job)) {
      if (typeof job.browserId === "number") await chrome.downloads.cancel(job.browserId).catch(() => {});
      job.state = "cancelled";
      if (isMedia(job)) { await releaseMedia(job.id); delete job.mediaBlob; }
      await write(jobs);
      await closeMediaIfIdle(jobs);
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return;
    if (!message?.type?.startsWith("stashwell.download.")) return;
    const action = message.type.slice("stashwell.download.".length);
    const run = action === "start" ? start(message.input) : action === "register" ? start(message.input, true) : action === "refresh" ? refresh() : action === "cancel" ? cancel(message.id)
      : action === "show" ? chrome.downloads.show(message.browserId)
      : action === "dismiss" ? serial(async () => write((await read()).filter(job => job.id !== message.id || active(job)))) : Promise.reject(Error("Unknown download action."));
    void Promise.resolve(run).then(result => reply({ ok: true, result }), error => reply({ ok: false, error: error.message }));
    return true;
  });
  chrome.downloads.onChanged.addListener(delta => { if (delta.state || delta.error || delta.totalBytes) void refresh(); });
  chrome.downloads.onCreated.addListener(item => {
    if (!item.url?.startsWith(`blob:chrome-extension://${chrome.runtime.id}/`)) return;
    void serial(async () => {
      const jobs = await read();
      const job = jobs.find(entry => entry.url === item.url && entry.state === "queued");
      if (!job) return;
      Object.assign(job, { browserId: item.id, state: "downloading" });
      await write(jobs);
    });
  });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void refresh(); });
  chrome.runtime.onStartup.addListener(() => { void refresh(); });
  // Remove unfinished jobs left behind by the retired YouTube downloader.
  void serial(async () => {
    const jobs = await read();
    const retired = jobs.filter(job => youtubePage(job.url) && job.state !== "complete");
    for (const job of retired) {
      if (active(job) && typeof job.browserId === "number") await chrome.downloads.cancel(job.browserId).catch(() => {});
    }
    const accessFailures = jobs.filter(job => job.permissionOrigins?.length);
    for (const job of accessFailures) {
      delete job.permissionOrigins;
      job.error = "Try downloading the resource again.";
    }
    if (retired.length || accessFailures.length) await write(jobs.filter(job => !retired.includes(job)));
    const cache = await chrome.storage.session.get(null);
    const keys = Object.keys(cache).filter(key => key.startsWith("stashwell.media."));
    if (keys.length) await chrome.storage.session.remove(keys);
  });
})();
