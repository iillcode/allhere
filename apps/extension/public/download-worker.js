(() => {
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
      if (job.state === "queued" && typeof job.browserId !== "number" && Date.now() - job.createdAt > 30_000) {
        Object.assign(job, { state: "failed", error: "The browser did not start this download. Try again." });
        changed = true;
        continue;
      }
      if (typeof job.browserId !== "number") continue;
      const [download] = await chrome.downloads.search({ id: job.browserId });
      const state = !download ? "failed" : download.state === "complete" ? "complete" : download.state === "interrupted" ? "failed" : "downloading";
      const patch = { state, received: download?.bytesReceived || 0, total: Math.max(0, download?.totalBytes || 0),
        filename: download?.filename?.split(/[\\/]/).pop() || job.filename,
        error: state === "failed" ? `Download interrupted: ${(download?.error || "check your connection").replaceAll("_", " ").toLowerCase()}.` : undefined };
      if (Object.entries(patch).some(([key, value]) => job[key] !== value)) { Object.assign(job, patch); changed = true; }
    }
    if (changed) await write(jobs);
    return jobs;
  });
  const validateMedia = async (url, kind) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { headers: { Range: "bytes=0-511" }, credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
      if (!response.ok) { await response.body?.cancel(); throw Error(`The media host returned HTTP ${response.status}. Scan the page for a fresh address.`); }
      const mime = response.headers.get("content-type") || "";
      const reader = response.body?.getReader();
      const head = reader ? (await reader.read()).value : new Uint8Array(await response.arrayBuffer());
      await reader?.cancel();
      const text = new TextDecoder().decode(head?.slice(0, 512));
      if (!head?.length || /text\/html|dash\+xml|mpegurl/i.test(mime) || /^\s*(?:<!doctype|<html|#EXTM3U|<\?xml)/i.test(text)) throw Error("This address contains a player or playlist, rather than a complete media file.");
      const formats = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv", "video/x-msvideo": "avi" };
      return formats[mime.split(";")[0].toLowerCase()] || (text.startsWith("fLaC") ? "flac" : text.startsWith("OggS") ? "ogg" : undefined);
    } finally { clearTimeout(timer); }
  };
  const begin = async job => {
    try {
      if (!await chrome.permissions.contains({ permissions: ["downloads"] })) throw Error("Reload Allhere on the browser's extensions page to enable downloads.");
      const origins = /^https?:/.test(job.url) ? [`${new URL(job.url).protocol}//${new URL(job.url).hostname}/*`] : [];
      if (origins.length && !await chrome.permissions.contains({ origins })) {
        await update(job.id, { state: "failed", permissionOrigins: origins, error: "Allhere needs website access to download this media. Allow access below, then retry." });
        return;
      }
      if (/\.(m3u8|mpd)(?:[?#]|$)/i.test(job.url)) {
        throw Error("This is a stream playlist. Only direct media files can be downloaded here.");
      }
      if (job.kind === "audio" || job.kind === "video") {
        const extension = await validateMedia(job.url, job.kind);
        if (extension && (!/\.[a-z0-9]{1,12}$/i.test(job.filename) || /\.(?:audio|video|bin)$/i.test(job.filename))) job.filename = job.filename.replace(/\.[^.]+$/, "") + `.${extension}`;
      }
      await serial(async () => {
        const jobs = await read();
        const current = jobs.find(entry => entry.id === job.id);
        if (!current || !active(current)) return;
        // For remote files, Chrome uses Content-Disposition and the URL to preserve
        // the source filename. Blob downloads need the name supplied by Allhere.
        const browserId = await chrome.downloads.download({ url: job.url, ...(!/^https?:/.test(job.url) ? { filename: job.filename } : {}), conflictAction: "uniquify", saveAs: false });
        Object.assign(current, { browserId, state: "downloading", filename: job.filename });
        await write(jobs);
      });
    } catch (error) { await update(job.id, { state: "failed", error: error.message || "Download failed. Scan the source page and try again." }); }
  };
  const start = async (input, fromPanel = false) => {
    if (!input || typeof input.url !== "string") throw Error("Choose a file address to download.");
    const url = safeUrl(input.url);
    if (youtubePage(url)) throw Error("YouTube downloads are not supported. You can preview the video or copy its URL.");
    const filename = String(input.filename || "allhere-download").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0, 180);
    const job = { id: crypto.randomUUID(), title: String(input.title || filename).slice(0, 300), url,
      filename, state: fromPanel ? "queued" : "preparing", received: 0, total: 0, createdAt: Date.now(), kind: input.kind };
    await serial(async () => { const jobs = await read(); jobs.unshift(job); await write(jobs); });
    if (fromPanel) return job;
    // Keep the response channel open until the browser download has started.
    await begin(job);
    return (await read()).find(entry => entry.id === job.id);
  };
  const cancel = id => serial(async () => {
    const jobs = await read();
    const job = jobs.find(entry => entry.id === id);
    if (job && active(job)) {
      if (typeof job.browserId === "number") await chrome.downloads.cancel(job.browserId).catch(() => {});
      job.state = "cancelled";
      await write(jobs);
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return;
    if (!message?.type?.startsWith("allhere.download.")) return;
    const action = message.type.slice("allhere.download.".length);
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
    if (retired.length) await write(jobs.filter(job => !retired.includes(job)));
    const cache = await chrome.storage.session.get(null);
    const keys = Object.keys(cache).filter(key => key.startsWith("allhere.media."));
    if (keys.length) await chrome.storage.session.remove(keys);
  });
})();
