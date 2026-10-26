import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const common = await readFile("public/common.js", "utf8");
const source = await readFile("public/journal.js", "utf8");
test("video blocks accept safe MP4 URLs, preserve unsafe text and code examples", () => {
  const j = setup();
  assert.equal(j.blocks(["[video](/uploads/a.mp4)"])[0].type, "video");
  assert.equal(j.blocks(["[video](javascript:a.mp4)"])[0].type, "p");
  assert.equal(j.blocks(['[video](/uploads/a.mp4"onerror="bad)'])[0].type, "p");
  assert.equal(
    j.blocks(["```", "[video](/uploads/a.mp4)", "```"])[0].type,
    "code",
  );
});
function setup(initial = "[]", denied = false) {
  const storage = new Map([["journal-saved", initial]]);
  const context = {
    window: { dispatchEvent() {} },
    URL,
    Event,
    localStorage: {
      getItem: (key) => {
        if (denied) throw Error("blocked");
        return storage.get(key);
      },
      setItem: (key, value) => {
        if (denied) throw Error("blocked");
        storage.set(key, value);
      },
    },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  };
  vm.runInNewContext(common, context);
  context.Blog = context.window.Blog;
  vm.runInNewContext(source, context);
  return context.window.Journal;
}
const posts = Array.from({ length: 19 }, (_, i) => ({
  id: String(i),
  title: `笔记 ${i}`,
  date: `2026.10.${i + 1}`,
  category: i % 2 ? "Rust" : "Blender",
  excerpt: "学习记录",
  content: [i === 3 ? "独有关键词 Future" : "练习正文"],
}));
test("search combines full text, category and saved filters", () => {
  const j = setup('["3","4"]');
  const result = j.select(posts, {
    query: "独有关键词 future",
    category: "Rust",
    savedOnly: true,
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, "3");
  assert.equal(j.select(posts, { query: "不存在" }).total, 0);
});
test("dates sort numerically and stale/out-of-range pagination is clamped before slicing", () => {
  const j = setup();
  assert.equal(j.select(posts).items[0].id, "18");
  assert.equal(j.select(posts, { sort: "oldest" }).items[0].id, "0");
  const last = j.select(posts, { page: 999 });
  assert.equal(last.page, 3);
  assert.equal(last.items.length, 3);
  assert.equal(j.select(posts, { page: -1 }).page, 1);
  assert.equal(j.select(posts, { page: "bad" }).page, 1);
  assert.equal(j.dateKey("2026-2-3"), "2026-02-03");
});
test("saved articles persist, toggle off, and corrupt or unavailable storage does not break browsing", () => {
  const j = setup();
  assert.equal(j.toggleSaved("1"), true);
  assert.equal(j.select(posts, { savedOnly: true }).total, 1);
  assert.equal(j.toggleSaved("1"), false);
  assert.equal(j.readSaved().length, 0);
  for (const initial of ["null", "{}", "bad"])
    assert.equal(setup(initial).readSaved().length, 0);
  assert.equal(setup("[]", true).select(posts).total, 19);
  assert.throws(() => setup("[]", true).toggleSaved("1"));
});
test("rendered cards escape titles, categories and IDs", () => {
  const html = setup().card({
    ...posts[0],
    id: 'a" onclick="bad',
    title: "<img src=x onerror=alert(1)>",
    category: '"><script>bad</script>',
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes(' onclick="'));
});
test("article block parser supports headings, lists, fences and unclosed fences without executing HTML", () => {
  const result = setup().blocks([
    "# 标题",
    "- 项目",
    "1. 步骤",
    "> 引用",
    "```rust",
    "let x = 1;",
    "```",
    "<script>bad</script>",
  ]);
  assert.equal(
    result.map((b) => b.type).join(","),
    "h2,ul,ol,blockquote,code,p",
  );
  assert.ok(result[4].text.includes("let x = 1;"));
  assert.equal(result[5].text, "<script>bad</script>");
  assert.equal(setup().blocks(["```", "unfinished"])[0].type, "code");
});
