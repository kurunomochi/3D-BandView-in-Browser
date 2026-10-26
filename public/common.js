(() => {
  "use strict";
  const TOKEN_KEY = "blog-admin-token";
  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function imageUrl(value) {
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      /[\s\x00-\x1f\x7f\\<>"']/.test(value) ||
      value.includes("..")
    )
      return "";
    if (
      /^\/(assets|uploads)\/.+/.test(value) &&
      !value.includes("%") &&
      !value.endsWith("/")
    )
      return value;
    try {
      const url = new URL(value);
      if (
        value.startsWith("https://") &&
        url.protocol === "https:" &&
        !url.username &&
        !url.password
      )
        return value;
    } catch {
      /* Invalid image URLs are omitted. */
    }
    return "";
  }
  function isVideo(value) {
    return Boolean(imageUrl(value) && /\.mp4$/i.test(value.split(/[?#]/)[0]));
  }
  function mediaPreview(value, title = "") {
    const src = escapeHtml(imageUrl(value));
    if (!src) return "";
    const label = escapeHtml(title);
    return isVideo(value)
      ? `<span class="video-preview"><video src="${src}" muted playsinline preload="metadata" aria-label="${label}"></video><span class="video-badge">▶ 视频</span></span>`
      : `<img src="${src}" alt="${label}" loading="lazy" decoding="async">`;
  }
  function videoPlayer(value, title = "视频") {
    if (!isVideo(value)) return "";
    const src = escapeHtml(imageUrl(value));
    return `<figure class="video-figure"><video class="media-player" src="${src}" controls playsinline preload="metadata" aria-label="${escapeHtml(title)}"></video><figcaption>无法播放？<a href="${src}" target="_blank" rel="noopener">打开视频文件 ↗</a></figcaption></figure>`;
  }
  async function uploadMedia(client, file) {
    const video = /\.mp4$/i.test(file.name);
    if (!video && !/\.(png|jpe?g|webp)$/i.test(file.name))
      throw new Error("请选择 PNG、JPG、WebP 图片或 MP4 视频");
    const limit = video ? 100 : 20;
    if (!file.size || file.size > limit * 1024 * 1024)
      throw new Error(`${file.name}：文件不能为空，最大 ${limit} MB`);
    try {
      return await client.request("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
    } catch (error) {
      if (error.name === "TimeoutError")
        throw new Error("上传超时，请检查网络或压缩视频后重试");
      throw error;
    }
  }
  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      signal: options.signal || AbortSignal.timeout(60000),
    });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        body.error ||
          (response.status === 413
            ? "文件超过大小限制：图片最大 20 MB，MP4 视频最大 100 MB"
            : "请求失败，请稍后重试"),
      );
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function adminClient(onSignedOut) {
    return {
      hasToken: () => Boolean(sessionStorage.getItem(TOKEN_KEY)),
      setToken: (token) => sessionStorage.setItem(TOKEN_KEY, token),
      clearToken: () => sessionStorage.removeItem(TOKEN_KEY),
      async request(path, options = {}) {
        const headers = new Headers(options.headers);
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (token) headers.set("Authorization", "Bearer " + token);
        if (typeof options.body === "string" && !headers.has("Content-Type"))
          headers.set("Content-Type", "application/json");
        try {
          return await request(path, { ...options, headers });
        } catch (error) {
          if (error.status === 401) {
            sessionStorage.removeItem(TOKEN_KEY);
            onSignedOut();
          }
          throw error;
        }
      },
    };
  }
  window.Blog = Object.freeze({
    escapeHtml,
    imageUrl,
    isVideo,
    mediaPreview,
    videoPlayer,
    uploadMedia,
    request,
    adminClient,
  });
})();
