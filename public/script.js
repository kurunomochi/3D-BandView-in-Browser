const state = { category: "全部", currentPage: 1, pageSize: 6, posts: [] };

const featuredEl = document.querySelector("#featured-post");
const filterEl = document.querySelector("#filter-row");
const gridEl = document.querySelector("#post-grid");
const paginationEl = document.querySelector("#pagination");
const avatarSlot = document.querySelector(".avatar-slot");
const avatarImage = document.querySelector("#avatar-image");

function iconRefresh() {
  if (window.lucide) window.lucide.createIcons();
}

const escapeHtml = Blog.escapeHtml;

function renderFeatured(post) {
  if (!post) {
    featuredEl.textContent = "还没有文章，新的记录即将抵达。";
    return;
  }
  featuredEl.innerHTML = `
    <div class="featured-content">
      <span class="featured-badge">PINNED WASTE / 01</span>
      <span class="post-date">${escapeHtml(post.date)} &nbsp;·&nbsp; ${escapeHtml(post.category)}</span>
      <h3>${escapeHtml(post.title)}</h3>
      <p>${escapeHtml(post.excerpt)}</p>
      <a class="read-link" href="article.html?id=${encodeURIComponent(post.id)}">查看这则文章 <i data-lucide="arrow-up-right"></i></a>
    </div>`;
  iconRefresh();
}

function renderFilters() {
  const categories = [
    "全部",
    ...new Set(state.posts.map((post) => post.category)),
  ];
  filterEl.innerHTML = categories
    .map(
      (category) => `
    <button class="filter-button ${state.category === category ? "is-active" : ""}" type="button" aria-pressed="${state.category === category}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
  `,
    )
    .join("");
  filterEl.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      state.currentPage = 1;
      renderFilters();
      renderPosts();
    });
  });
}

function renderPosts() {
  const matches = state.posts.filter(
    (post) => state.category === "全部" || post.category === state.category,
  );
  const start = (state.currentPage - 1) * state.pageSize;
  const visible = matches.slice(start, start + state.pageSize);
  gridEl.innerHTML = visible
    .map(
      (post) => `
    <article class="post-card">
      <div class="post-info"><span class="post-date">${escapeHtml(post.date)}</span><span class="post-category">${escapeHtml(post.category)}</span></div>
      <h3><a href="article.html?id=${encodeURIComponent(post.id)}">${escapeHtml(post.title)}</a></h3>
      <p class="post-card-excerpt">${escapeHtml(post.excerpt)}</p>
    </article>
  `,
    )
    .join("");
  renderPagination(matches.length);
  iconRefresh();
}

function renderPagination(totalPosts) {
  const totalPages = Math.max(1, Math.ceil(totalPosts / state.pageSize));
  state.currentPage = Math.min(state.currentPage, totalPages);
  paginationEl.innerHTML = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return `<button class="pagination-button ${page === state.currentPage ? "is-active" : ""}" type="button" aria-label="第 ${page} 页" aria-current="${page === state.currentPage ? "page" : "false"}" data-page="${page}">${page}</button>`;
  }).join("");
  paginationEl.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentPage = Number(button.dataset.page);
      renderPosts();
      document
        .querySelector("#articles")
        .scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

const menuToggle = document.querySelector("#menu-toggle");
const mobileMenu = document.querySelector("#mobile-menu");
menuToggle.addEventListener("click", () => {
  const isOpen = mobileMenu.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", isOpen);
  mobileMenu.setAttribute("aria-hidden", !isOpen);
});
mobileMenu.querySelectorAll("a").forEach((link) =>
  link.addEventListener("click", () => {
    mobileMenu.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
    mobileMenu.setAttribute("aria-hidden", "true");
  }),
);

avatarImage.addEventListener("load", () =>
  avatarSlot.classList.add("has-image"),
);
avatarImage.addEventListener("error", () =>
  avatarSlot.classList.remove("has-image"),
);
if (avatarImage.complete && avatarImage.naturalWidth > 0)
  avatarSlot.classList.add("has-image");

document.querySelector("#current-year").textContent = new Date().getFullYear();

async function init() {
  try {
    state.posts = await Blog.request("/api/posts");
    const featuredPost =
      state.posts.find((post) => post.id === "opening-note") || state.posts[0];
    renderFeatured(featuredPost);
    renderFilters();
    renderPosts();
  } catch (error) {
    featuredEl.textContent = error.message;
    gridEl.textContent = "暂时无法连接后端服务。";
  }
}

init();

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();
});
