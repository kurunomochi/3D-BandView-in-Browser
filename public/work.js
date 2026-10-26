const { escapeHtml: esc, imageUrl: safe } = Blog;
const dialog = document.querySelector("#lightbox");
document.querySelector("#close-lightbox").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});
async function init() {
  const root = document.querySelector("#detail");
  try {
    const id = new URLSearchParams(location.search).get("id");
    if (!id) throw new Error("未指定作品");
    const w = await Blog.request("/api/works/" + encodeURIComponent(id));
    document.title = w.title + " · kurumochi";
    const photo = (url, lazy = false) =>
      Blog.isVideo(url)
        ? Blog.videoPlayer(url, w.title)
        : `<button class="zoom-button" type="button" aria-label="放大查看：${esc(w.title)}" data-image="${esc(safe(url))}"><img class="detail-image" src="${esc(safe(url))}" alt="${esc(w.title)}" ${lazy ? 'loading="lazy"' : ""}></button>`;
    root.innerHTML = `<section class="detail-top"><a class="back" href="/portfolio.html#works">← 所有作品</a><div class="detail-head"><div><p class="eyebrow">A BLENDER EXPLORATION</p><h1>${esc(w.title)}</h1></div><dl class="detail-meta"><div><dt>CATEGORY / 分类</dt><dd>${esc(w.category)}</dd></div><div><dt>TOOL / 工具</dt><dd>${esc(w.software)}</dd></div><div><dt>DATE / 日期</dt><dd>${esc(w.date)}</dd></div></dl></div></section>${photo(w.cover)}<section class="detail-copy"><p class="eyebrow">ABOUT THE WORK / 关于作品</p><p>${esc(w.description)}</p></section><section class="detail-gallery" aria-label="更多作品图片和视频">${[
      ...new Set(w.images),
    ]
      .filter((url) => url !== w.cover)
      .map((url) => photo(url, true))
      .join("")}</section>`;
    if (w.model) {
      const section = document.createElement("section");
      root.querySelector(".detail-top").after(section);
      import("/model-viewer.js?v=20261025-3d")
        .then(({ mountModelViewer }) => mountModelViewer(section, w.model))
        .catch(() => {
          section.textContent = "3D 查看器加载失败，请刷新重试。";
        });
    }
    root.querySelectorAll("[data-image]").forEach(
      (button) =>
        (button.onclick = () => {
          const img = document.querySelector("#lightbox-image");
          img.src = button.dataset.image;
          img.alt = w.title;
          dialog.showModal();
        }),
    );
  } catch (e) {
    root.innerHTML = `<div class="error-box"><h1>${esc(e.message)}</h1><a class="text-link" href="/portfolio.html">返回作品集 ↗</a></div>`;
  }
}
init();
