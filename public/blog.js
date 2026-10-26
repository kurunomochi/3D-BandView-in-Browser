(() => {
  const { esc, select, card, ordered, dateKey } = Journal;
  const grid = document.querySelector("#post-list");
  const status = document.querySelector("#list-status");
  const pagination = document.querySelector("#list-pagination");
  const form = document.querySelector("#search-form");
  const search = document.querySelector("#post-search");
  const categories = document.querySelector("#post-category");
  const sort = document.querySelector("#post-sort");
  const saved = document.querySelector("#saved-only");
  const archive = document.body.dataset.page === "archive";
  let posts = [],
    ready = false;
  const params = () => new URLSearchParams(location.search);
  function readControls() {
    const p = params();
    search.value = p.get("q") || "";
    categories.value = p.get("category") || "";
    sort.value = p.get("sort") === "oldest" ? "oldest" : "newest";
    saved.checked = p.get("saved") === "1";
  }
  function navigate(page = 1) {
    const p = new URLSearchParams();
    if (search.value.trim()) p.set("q", search.value.trim());
    if (categories.value) p.set("category", categories.value);
    if (sort.value === "oldest") p.set("sort", "oldest");
    if (saved.checked) p.set("saved", "1");
    if (page > 1) p.set("page", page);
    history.pushState(null, "", location.pathname + (p.size ? `?${p}` : ""));
    render();
  }
  function render() {
    if (!ready) return;
    const result = select(posts, {
      query: search.value,
      category: categories.value,
      savedOnly: saved.checked,
      sort: sort.value,
      page: params().get("page"),
      pageSize: 8,
    });
    const { total, page, pages, items, matches } = result;
    if (params().has("page") && params().get("page") !== String(page)) {
      const p = params();
      if (page === 1) p.delete("page");
      else p.set("page", page);
      history.replaceState(
        null,
        "",
        location.pathname + (p.size ? `?${p}` : ""),
      );
    }
    status.textContent = archive
      ? `共 ${total} 篇记录 · 按年份整理`
      : total
        ? `第 ${page} / ${pages} 页 · 显示 ${(page - 1) * 8 + 1}–${Math.min(page * 8, total)} 篇，共 ${total} 篇`
        : "找到 0 篇文章";
    if (!total) {
      grid.innerHTML = `<div class="empty-state"><h2>${saved.checked ? "这里还没有收藏的文章" : posts.length ? "没有找到匹配的文章" : "新的记录还在路上"}</h2><p>${saved.checked ? "打开文章，点击「收藏文章」即可保存到当前浏览器。" : "试试其他关键词，或清除筛选查看全部文章。"}</p><button class="soft-button" type="button" data-reset>清除筛选</button></div>`;
    } else if (archive) {
      const years = [
        ...new Set(
          matches.map((p) => dateKey(p.date).slice(0, 4) || "日期待补充"),
        ),
      ];
      grid.innerHTML = years
        .map(
          (year) =>
            `<section class="archive-year"><h2>${esc(year)} <small>${matches.filter((p) => (dateKey(p.date).slice(0, 4) || "日期待补充") === year).length} 篇</small></h2>${matches
              .filter(
                (p) => (dateKey(p.date).slice(0, 4) || "日期待补充") === year,
              )
              .map(
                (p) =>
                  `<a class="archive-item" href="${esc(Journal.url(p.id))}"><time>${esc(p.date)}</time><strong>${esc(p.title)}</strong><span>${esc(p.category)} ↗</span></a>`,
              )
              .join("")}</section>`,
        )
        .join("");
    } else grid.innerHTML = items.map(card).join("");
    pagination.replaceChildren();
    if (!archive && pages > 1) {
      const wanted = [...new Set([1, page - 1, page, page + 1, pages])]
        .filter((n) => n >= 1 && n <= pages)
        .sort((a, b) => a - b);
      function button(label, n, disabled = false) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "soft-button";
        b.textContent = label;
        b.disabled = disabled;
        if (label === String(page)) b.setAttribute("aria-current", "page");
        b.addEventListener("click", () => {
          navigate(n);
          document.querySelector("#list-heading").focus();
        });
        pagination.append(b);
      }
      button("← 上一页", page - 1, page === 1);
      wanted.forEach((n, i) => {
        if (i && n - wanted[i - 1] > 1)
          pagination.append(document.createTextNode(" … "));
        button(String(n), n);
      });
      button("下一页 →", page + 1, page === pages);
    }
  }
  function reset() {
    search.value = "";
    categories.value = "";
    sort.value = "newest";
    saved.checked = false;
    navigate();
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    navigate();
  });
  [categories, sort, saved].forEach((el) =>
    el.addEventListener("change", () => navigate()),
  );
  document.querySelector("#clear-search").addEventListener("click", reset);
  grid.addEventListener("click", (e) => {
    if (e.target.closest("[data-reset]")) reset();
  });
  window.addEventListener("popstate", () => {
    readControls();
    render();
  });
  window.addEventListener("storage", () => render());
  async function load() {
    status.textContent = "正在加载文章…";
    grid.setAttribute("aria-busy", "true");
    try {
      posts = ordered(await Blog.request("/api/posts"));
      const values = [...new Set(posts.map((p) => p.category))];
      const requested = params().get("category");
      if (requested && !values.includes(requested)) values.push(requested);
      categories.innerHTML = `<option value="">全部分类</option>${values.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}`;
      ready = true;
      readControls();
      render();
    } catch {
      status.textContent = "文章暂时加载失败，请重试。";
      grid.innerHTML =
        '<div class="empty-state"><button type="button" class="soft-button" id="retry-posts">重新加载</button></div>';
      document.querySelector("#retry-posts").addEventListener("click", load);
    } finally {
      grid.setAttribute("aria-busy", "false");
    }
  }
  load();
})();
