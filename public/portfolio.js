const $ = (s) => document.querySelector(s);
const { escapeHtml } = Blog;
let works = [],
  category = "全部";
$("#year").textContent = new Date().getFullYear();
function filters() {
  $("#filters").innerHTML = ["全部", ...new Set(works.map((w) => w.category))]
    .map(
      (c) =>
        `<button type="button" aria-pressed="${category === c}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`,
    )
    .join("");
  $("#filters")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          category = b.dataset.category;
          filters();
          render();
        }),
    );
}
function render() {
  const query = $("#search").value.trim().toLowerCase();
  const visible = works.filter(
    (w) =>
      (category === "全部" || w.category === category) &&
      [w.title, w.description, w.category]
        .join(" ")
        .toLowerCase()
        .includes(query),
  );
  $("#status").textContent = visible.length ? "" : "暂时没有匹配的作品。";
  $("#grid").innerHTML = visible
    .map(
      (w) =>
        `<article class="work-card"><a class="thumb" href="/work.html?id=${encodeURIComponent(w.id)}">${Blog.mediaPreview(w.cover, w.title)}</a><div class="card-meta"><div><h3><a href="/work.html?id=${encodeURIComponent(w.id)}">${escapeHtml(w.title)}</a></h3><p>${escapeHtml(w.category)} &nbsp; / &nbsp; ${escapeHtml(w.software)}</p></div><a class="card-arrow" href="/work.html?id=${encodeURIComponent(w.id)}" aria-label="查看${escapeHtml(w.title)}">↗</a></div></article>`,
    )
    .join("");
}
async function init() {
  try {
    works = await Blog.request("/api/works");
    $("#work-count").textContent = String(works.length).padStart(2, "0");
    const hero = works.find((w) => w.featured) || works[0];
    $("#featured").innerHTML = hero
      ? `<a class="hero-image" href="/work.html?id=${encodeURIComponent(hero.id)}">${Blog.mediaPreview(hero.cover, hero.title)}<span class="hero-label">SELECTED WORK / 精选作品</span><span class="hero-open" aria-hidden="true">↗</span></a><div class="hero-caption"><div><h2>${escapeHtml(hero.title)}</h2><p>${escapeHtml(hero.category)} &nbsp; / &nbsp; ${escapeHtml(hero.software)}</p></div><span class="serial">01 — ${String(works.length).padStart(2, "0")}</span></div>`
      : '<div class="empty">新的作品即将抵达。</div>';
    filters();
    render();
  } catch (error) {
    $("#featured").textContent = error.message;
    $("#status").textContent = "暂时无法连接画廊，刷新页面可重试。";
  }
}
$("#search").addEventListener("input", render);
init();
