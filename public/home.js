(() => {
  if (location.hash === "#articles") {
    location.replace("/blog/");
    return;
  }
  const { esc, ordered, card } = Journal;
  async function posts() {
    const el = document.querySelector("#recent-posts");
    try {
      const items = ordered(await Blog.request("/api/posts"));
      document.querySelector("#post-count").textContent =
        `${items.length} 篇文章`;
      el.innerHTML = items.length
        ? items.slice(0, 3).map(card).join("")
        : '<p class="empty-state">第一篇记录还在路上。</p>';
    } catch {
      el.innerHTML =
        '<p>文章暂时加载失败。<a class="text-link" href="/blog/">前往文章页重试 →</a></p>';
    }
  }
  async function works() {
    const el = document.querySelector("#recent-works");
    try {
      const items = await Blog.request("/api/works");
      document.querySelector("#work-count").textContent =
        `${items.length} 件作品`;
      el.innerHTML = items.length
        ? items
            .slice(0, 3)
            .map(
              (w) =>
                `<a class="home-work" href="/work.html?id=${esc(encodeURIComponent(w.id))}">${Blog.imageUrl(w.cover) ? Blog.mediaPreview(w.cover, w.title) : '<div class="work-placeholder">BLENDER</div>'}<div><span>${esc(w.category)}</span><h3>${esc(w.title)} ↗</h3></div></a>`,
            )
            .join("")
        : '<p class="empty-state">新作品正在制作中。</p>';
    } catch {
      el.innerHTML =
        '<p>作品暂时加载失败。<a class="text-link" href="/portfolio.html">前往作品集重试 →</a></p>';
    }
  }
  const avatar = document.querySelector("#avatar-image");
  const mark = () =>
    avatar
      .closest(".avatar-slot")
      .classList.toggle("has-image", avatar.naturalWidth > 0);
  avatar.addEventListener("load", mark);
  avatar.addEventListener("error", mark);
  mark();
  posts();
  works();
})();
