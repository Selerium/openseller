/**
 * Homepage contract: the draft/publish split, what the validator refuses, and the admin guard.
 *
 * These assertions exist because the homepage is the one write path whose failure is silent
 * — a rejected draft shows up as an editor that will not save, a draft that leaks into
 * /homepage shows up as an unfinished page in front of customers, and a publish that lands
 * early ships a half-built page. None of those have a server log line to catch them, so they
 * are pinned here instead.
 *
 * The suite ends by restoring whatever draft and published documents it found at the start.
 * A document that was never published cannot be unpublished (there is no endpoint that sets
 * `published` back to null), so on a fresh database the final state is "published an empty
 * page", which the storefront renders exactly like never-published.
 */
const A = "http://localhost/api";

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? ` -- ${extra}` : ""}`);
  }
};

async function call(path, { method = "GET", cookie, body, key } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (key) headers["Idempotency-Key"] = key;

  const res = await fetch(A + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }

  return {
    status: res.status,
    body: parsed,
    idempotency: res.headers.get("Idempotency-Status"),
    cookie: setCookie.map((c) => c.split(";")[0]).join("; "),
  };
}

const EMPTY = { version: 1, sections: [] };

/** Distinctive ids so a layout this suite wrote can be recognised wherever it turns up. */
function tree() {
  return {
    version: 1,
    sections: [
      {
        id: "sec-homepage01",
        padding: "lg",
        background: { kind: "solid", color: "#111827" },
        columns: [
          {
            id: "col-homepage01",
            elements: [
              { id: "el-homepage001", kind: "hero", fields: { heading: "Homepage suite" } },
            ],
          },
          { id: "col-homepage02", elements: [] },
        ],
      },
      {
        id: "sec-homepage02",
        padding: "none",
        background: { kind: "none" },
        columns: [{ id: "col-homepage03", elements: [] }],
      },
    ],
  };
}

const hasSection = (layout, id) =>
  Array.isArray(layout?.sections) && layout.sections.some((s) => s.id === id);

console.log("\n=== the public route ===");

const public0 = await call("/homepage");
ok("GET /homepage answers without a session", public0.status === 200, `got ${public0.status}`);
ok(
  "GET /homepage returns { layout, updatedAt }",
  public0.status === 200 && Object.hasOwn(public0.body.data, "layout"),
);
ok(
  "layout is either null or a version-1 tree",
  public0.body.data?.layout === null || public0.body.data?.layout?.version === 1,
);

console.log("\n=== the admin routes are guarded ===");

for (const [label, path, opts] of [
  ["GET", "/admin/homepage", {}],
  ["PUT", "/admin/homepage", { method: "PUT", body: { layout: EMPTY } }],
  ["publish", "/admin/homepage/publish", { method: "POST", body: {} }],
  ["discard", "/admin/homepage/discard-draft", { method: "POST", body: {} }],
]) {
  const r = await call(path, opts);
  ok(`admin ${label} 401 for a guest`, r.status === 401, `got ${r.status}`);
}

const shopper = await call("/login", {
  method: "POST",
  body: { email: "sarah@openseller.test", password: "password123" },
});
ok("shopper can log in", shopper.status === 200, `got ${shopper.status}`);
const shopperJar = shopper.cookie;
const shopperGets = await call("/admin/homepage", { cookie: shopperJar });
ok("admin GET 403 for a shopper", shopperGets.status === 403, `got ${shopperGets.status}`);
const shopperPuts = await call("/admin/homepage", {
  method: "PUT",
  cookie: shopperJar,
  body: { layout: EMPTY },
});
ok("admin PUT 403 for a shopper", shopperPuts.status === 403, `got ${shopperPuts.status}`);

console.log("\n=== admin login and the state envelope ===");

const login = await call("/login", {
  method: "POST",
  body: { email: "admin@openseller.test", password: "password123" },
});
ok("admin can log in", login.status === 200, `got ${login.status}`);
const jar = login.cookie;

const start = await call("/admin/homepage", { cookie: jar });
ok("admin GET 200", start.status === 200, `got ${start.status}`);
ok("state carries a draft", start.body.data?.draft?.version === 1);
ok("state carries published as a tree or null",
  start.body.data?.published === null || start.body.data?.published?.version === 1);
ok("state carries dirty", typeof start.body.data?.dirty === "boolean");
ok("state carries updatedAt", typeof start.body.data?.updatedAt === "string");

// On a database this feature has never been published to, discard has nothing to fall back
// to. It must refuse — quietly falling back to an empty page there would delete everything
// the admin has built under a button that promises to throw away a *draft*.
if (start.body.data?.published === null) {
  const refused = await call("/admin/homepage/discard-draft", { method: "POST", cookie: jar });
  ok("discard with nothing published is a 400", refused.status === 400, `got ${refused.status}`);
  ok("and it explains why", /published/i.test(refused.body.message ?? ""));
}

// What the storefront is showing right now, before this suite touches anything.
const before = await call("/homepage");

console.log("\n=== draft is not published ===");

const put = await call("/admin/homepage", {
  method: "PUT",
  cookie: jar,
  body: { layout: tree() },
});
ok("PUT accepts a valid tree", put.status === 200, `got ${put.status}: ${put.body.message}`);
ok("PUT echoes the saved draft", hasSection(put.body.data?.draft, "sec-homepage01"));
ok("PUT reports dirty", put.body.data?.dirty === true);

const mid = await call("/homepage");
ok(
  "the draft has not reached the storefront",
  hasSection(mid.body.data?.layout, "sec-homepage01") === false,
  `public layout: ${JSON.stringify(mid.body.data?.layout)?.slice(0, 120)}`,
);
ok(
  "the storefront still serves whatever it served before",
  JSON.stringify(mid.body.data?.layout) === JSON.stringify(before.body.data?.layout),
);

console.log("\n=== publish ===");

const published = await call("/admin/homepage/publish", { method: "POST", cookie: jar });
ok("publish 200", published.status === 200, `got ${published.status}: ${published.body.message}`);
ok("publish reports clean", published.body.data?.dirty === false);

const after = await call("/homepage");
ok(
  "the published tree is what the storefront serves",
  hasSection(after.body.data?.layout, "sec-homepage01"),
);
ok(
  "published element keeps its kind and fields",
  after.body.data?.layout?.sections?.[0]?.columns?.[0]?.elements?.[0]?.kind === "hero" &&
    after.body.data?.layout?.sections?.[0]?.columns?.[0]?.elements?.[0]?.fields?.heading ===
      "Homepage suite",
);
ok("equal columns survive the round trip", after.body.data?.layout?.sections?.[0]?.columns?.length === 2);

console.log("\n=== the validator refuses bad trees ===");

const badTrees = [
  [
    "unknown element kind",
    {
      version: 1,
      sections: [
        {
          id: "sec-bad00001",
          columns: [{ id: "col-bad00001", elements: [{ id: "el-bad000001", kind: "iframe", fields: {} }] }],
        },
      ],
    },
  ],
  ["wrong version", { version: 2, sections: [] }],
  ["section with no columns", { version: 1, sections: [{ id: "sec-bad00002", columns: [] }] }],
  [
    "five columns",
    {
      version: 1,
      sections: [
        {
          id: "sec-bad00003",
          columns: ["col-bad0000a", "col-bad0000b", "col-bad0000c", "col-bad0000d", "col-bad0000e"].map(
            (id) => ({ id, elements: [] }),
          ),
        },
      ],
    },
  ],
  [
    "padding outside the set",
    {
      version: 1,
      sections: [{ id: "sec-bad00004", padding: "xl", columns: [{ id: "col-bad00004", elements: [] }] }],
    },
  ],
  [
    "javascript: background image",
    {
      version: 1,
      sections: [
        {
          id: "sec-bad00005",
          background: { kind: "image", url: "javascript:alert(1)" },
          columns: [{ id: "col-bad00005", elements: [] }],
        },
      ],
    },
  ],
  [
    "background colour that is not a colour",
    {
      version: 1,
      sections: [
        {
          id: "sec-bad00006",
          background: { kind: "solid", color: "expression(alert(1))" },
          columns: [{ id: "col-bad00006", elements: [] }],
        },
      ],
    },
  ],
  ["id with spaces", { version: 1, sections: [{ id: "bad id", columns: [{ id: "col-bad00007", elements: [] }] }] }],
  [
    "too many elements in one column",
    {
      version: 1,
      sections: [
        {
          id: "sec-bad00008",
          columns: [
            {
              id: "col-bad00008",
              elements: Array.from({ length: 31 }, (_, i) => ({
                id: `el-toomany${String(i).padStart(2, "0")}`,
                kind: "heading",
                fields: {},
              })),
            },
          ],
        },
      ],
    },
  ],
  [
    "field nested past the depth limit",
    {
      version: 1,
      sections: [
        {
          id: "sec-bad00009",
          columns: [{ id: "col-bad00009", elements: [{ id: "el-deep000001", kind: "hero", fields: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } }] }],
        },
      ],
    },
  ],
];

for (const [label, layout] of badTrees) {
  const r = await call("/admin/homepage", { method: "PUT", cookie: jar, body: { layout } });
  ok(`${label} is a 400`, r.status === 400, `got ${r.status} (${r.body.message})`);
  ok(`${label} explains itself`, typeof r.body.message === "string" && r.body.message.length > 0);
}

const noLayout = await call("/admin/homepage", { method: "PUT", cookie: jar, body: {} });
ok("missing layout is a 400", noLayout.status === 400, `got ${noLayout.status}`);
ok("missing layout says so", /layout/i.test(noLayout.body.message ?? ""));

const unpublishedAfter = await call("/homepage");
ok(
  "a refused PUT leaves the published homepage untouched",
  hasSection(unpublishedAfter.body.data?.layout, "sec-homepage01"),
);

console.log("\n=== four columns are allowed, and equal ===");

const four = {
  version: 1,
  sections: [
    {
      id: "sec-fourcol001",
      columns: ["col-fourcol001", "col-fourcol002", "col-fourcol003", "col-fourcol004"].map((id, i) => ({
        id,
        elements: [{ id: `el-fourcol000${i + 1}`, kind: "heading", fields: { title: `Col ${i + 1}` } }],
      })),
    },
  ],
};
const fourPut = await call("/admin/homepage", { method: "PUT", cookie: jar, body: { layout: four } });
ok("four columns are accepted", fourPut.status === 200, `got ${fourPut.status}: ${fourPut.body.message}`);
ok("the four columns are all present", fourPut.body.data?.draft?.sections?.[0]?.columns?.length === 4);

console.log("\n=== idempotency ===");

const key = `homepage-test-${Date.now()}`;
const first = await call("/admin/homepage", { method: "PUT", cookie: jar, key, body: { layout: EMPTY } });
const second = await call("/admin/homepage", { method: "PUT", cookie: jar, key, body: { layout: EMPTY } });
ok("first PUT with a key succeeds", first.status === 200, `got ${first.status}`);
ok("replay of that key succeeds", second.status === 200, `got ${second.status}`);
ok("replay is marked as such", second.idempotency === "replayed", `header: ${second.idempotency}`);
ok(
  "the replay returns the first response, not a second write",
  JSON.stringify(second.body) === JSON.stringify(first.body),
);

console.log("\n=== discard ===");

// Something is published by this point (the publish section above), so discard has a document
// to restore the draft from.
const publishedBeforeDiscard = (await call("/admin/homepage", { cookie: jar })).body.data?.published;
await call("/admin/homepage", { method: "PUT", cookie: jar, body: { layout: tree() } });
const discarded = await call("/admin/homepage/discard-draft", { method: "POST", cookie: jar });
ok("discard 200 when something is published", discarded.status === 200, `got ${discarded.status}`);
ok(
  "discard puts the published tree back into the draft",
  JSON.stringify(discarded.body.data?.draft) === JSON.stringify(publishedBeforeDiscard),
);

console.log("\n=== restore ===");

// Put back what this suite found. Publish first, because publish copies draft over published
// and the original draft may be the only copy of an unfinished edit.
const restoreTo = start.body.data?.published ?? EMPTY;
await call("/admin/homepage", { method: "PUT", cookie: jar, body: { layout: restoreTo } });
await call("/admin/homepage/publish", { method: "POST", cookie: jar });
await call("/admin/homepage", { method: "PUT", cookie: jar, body: { layout: start.body.data?.draft } });

const restored = await call("/admin/homepage", { cookie: jar });
ok(
  "draft is back to what it was",
  JSON.stringify(restored.body.data?.draft) === JSON.stringify(start.body.data?.draft),
);
ok(
  "published is back to what it was (or, on a fresh database, published as empty)",
  start.body.data?.published === null
    ? restored.body.data?.published?.sections?.length === 0
    : JSON.stringify(restored.body.data?.published) === JSON.stringify(start.body.data?.published),
);

console.log(`\nhomepage: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
