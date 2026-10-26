import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("public/common.js", "utf8");
test("video detection and markup validate URLs and keep images compatible", () => {
  const blog = setup();
  for (const url of ["/uploads/a.mp4", "https://example.com/a.MP4?key=1&v=2"])
    assert.equal(blog.isVideo(url), true);
  for (const url of [
    "javascript:a.mp4",
    "/uploads/../a.mp4",
    "https://example.com/a.png?x=.mp4",
    '/uploads/a.mp4"onerror="bad',
  ])
    assert.equal(blog.isVideo(url), false);
  assert.match(
    blog.mediaPreview("/uploads/a.png", "<title>"),
    /<img.*&lt;title&gt;/,
  );
  assert.match(
    blog.videoPlayer("/uploads/a.mp4", "<title>"),
    /controls playsinline preload="metadata"/,
  );
  assert.doesNotMatch(blog.videoPlayer("/uploads/a.mp4"), /autoplay/);
  assert.equal(blog.videoPlayer("javascript:a.mp4"), "");
});

test("upload validates type and limits before making a request", async () => {
  const blog = setup();
  let calls = 0;
  const client = {
    request: async () => {
      calls++;
      return { url: "/uploads/a.mp4" };
    },
  };
  await assert.rejects(
    blog.uploadMedia(client, { name: "a.png", size: 21 * 1024 * 1024 }),
    /20 MB/,
  );
  await assert.rejects(
    blog.uploadMedia(client, { name: "a.mp4", size: 101 * 1024 * 1024 }),
    /100 MB/,
  );
  await assert.rejects(blog.uploadMedia(client, { name: "a.html", size: 10 }));
  await assert.rejects(blog.uploadMedia(client, { name: "a.mp4", size: 0 }));
  assert.equal(calls, 0);
  await blog.uploadMedia(client, { name: "a.MP4", size: 25 * 1024 * 1024 });
  assert.equal(calls, 1);
});
function setup(fetch) {
  const storage = new Map();
  const context = {
    window: {},
    URL,
    Headers,
    AbortSignal,
    fetch,
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  };
  vm.runInNewContext(source, context);
  return context.window.Blog;
}

test("HTML and image URLs cannot inject active content", () => {
  const blog = setup();
  assert.equal(
    blog.escapeHtml('<img onerror="bad">&'),
    "&lt;img onerror=&quot;bad&quot;&gt;&amp;",
  );
  for (const value of [
    "javascript:alert(1)",
    "/uploads/../data",
    "/uploads/%2e%2e/data",
    "https://",
    "https://user:pass@example.com/a.png",
    "//evil.com/a.png",
  ])
    assert.equal(blog.imageUrl(value), "", value);
  for (const value of [
    "/assets/works/a.png",
    "/uploads/a.webp",
    "https://example.com/a.png",
  ])
    assert.equal(blog.imageUrl(value), value);
});
test("expired admin session is cleared on 401", async () => {
  let signedOut = 0;
  const blog = setup(
    async () => new Response('{"error":"需要管理员登录"}', { status: 401 }),
  );
  const client = blog.adminClient(() => signedOut++);
  client.setToken("expired");
  await assert.rejects(
    client.request("/api/auth/session"),
    (error) => error.status === 401,
  );
  assert.equal(client.hasToken(), false);
  assert.equal(signedOut, 1);
});
test("JSON and binary requests keep appropriate content types", async () => {
  const seen = [];
  const blog = setup(async (_, options) => {
    seen.push(options);
    return new Response(null, { status: 204 });
  });
  const client = blog.adminClient(() => {});
  client.setToken("valid");
  await client.request("/api/posts", { method: "POST", body: "{}" });
  await client.request("/api/uploads", {
    method: "POST",
    body: new Uint8Array([1, 2]),
  });
  assert.equal(seen[0].headers.get("Content-Type"), "application/json");
  assert.equal(seen[1].headers.get("Content-Type"), null);
  assert.equal(seen[1].headers.get("Authorization"), "Bearer valid");
});
