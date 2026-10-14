import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prismaClient.ts";
import { config } from "../src/lib/config.ts";
import { recomputeProductRollup, recomputeProductRating, slugify } from "../src/lib/catalog.ts";

// ---------------------------------------------------------------------------
// Seed catalog
//
// Re-runnable: users/categories/products upsert on their natural unique keys, product
// images are replaced wholesale, variants upsert on sku, and orders/complaints are only
// created when the tables are empty. Safe to run against a live dev database.
// ---------------------------------------------------------------------------

interface SeedVariant {
  name: string;
  priceCents: number;
  stock: number;
  lowStockThreshold?: number;
}

interface SeedReview {
  rating: number;
  title: string;
  body: string;
}

interface SeedProduct {
  title: string;
  brief: string;
  description: string;
  category: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  // Whole-product markdown. recomputeProductRollup derives salePriceCents from this, so it must
  // be set before that call. Four products carry one, chosen to cover the cases the storefront
  // has to get right: a simple product, a variant product, an out-of-stock one, and a price
  // whose markdown lands exactly on half a minor unit (1850 at 15% = 1572.5) to pin the
  // half-up rounding in effectivePrice.
  discountPercent?: number;
  priceCents?: number;
  stock?: number;
  variants?: SeedVariant[];
  reviews?: SeedReview[];
}

const CATEGORIES: { name: string; slug: string; sortOrder: number }[] = [
  { name: "Coffee & Tea", slug: "coffee-tea", sortOrder: 1 },
  { name: "Outdoor", slug: "outdoor", sortOrder: 2 },
  { name: "Stationery", slug: "stationery", sortOrder: 3 },
  { name: "Kitchen", slug: "kitchen", sortOrder: 4 },
];

// Deliberately mixed stock so every admin state is represented: healthy, low stock
// (at or under threshold), and fully out of stock. Variants carry their own thresholds.
const PRODUCTS: SeedProduct[] = [
  // --- Coffee & Tea ---
  {
    title: "Single Origin Ethiopia Yirgacheffe",
    brief: "Washed heirloom beans, jasmine and stone fruit",
    description:
      "A washed Yirgacheffe from smallholder farms around Gedeb, dried on raised beds. Cupped at 88.5 points, it opens with jasmine and bergamot and settles into peach and black tea. Roasted to order and shipped within 48 hours of the roast, in a 250g valve bag.",
    category: "coffee-tea",
    priceCents: 1850,
    discountPercent: 15, // 1572.5 -> 1573: pins half-up rounding
    stock: 24,
    reviews: [
      { rating: 5, title: "Best filter coffee I have had", body: "Really clean cup, no bitterness at all. Jasmine is exactly right." },
      { rating: 4, title: "Lovely, slightly lighter than I like", body: "Excellent value. I brew it a touch stronger than suggested." },
      { rating: 5, title: "Fresh and consistent", body: "Third order. Never had a stale bag." },
    ],
  },
  {
    title: "Ceramic Pour Over V60",
    brief: "Cone dripper with a 60 degree single large hole",
    description:
      "A high-fired ceramic cone with a single large aperture, which encourages a slower drawdown and a clearer cup than the plastic spiral-ribbed originals. Fits standard #02 filters. Dishwasher safe, though hand washing will keep the glaze brighter for longer.",
    category: "coffee-tea",
    priceCents: 3200,
    discountPercent: 20,
    stock: 12,
    reviews: [
      { rating: 5, title: "Beats my plastic one", body: "Noticeably sweeter cup. The single hole does make it slower." },
      { rating: 4, title: "Great but heavy", body: "Beautifully made. It is a chunky piece of ceramic." },
    ],
  },
  {
    title: "Vietnamese Cold Brew Concentrate",
    brief: "Slow steeped 18 hours, makes eight drinks",
    description:
      "Coarse-ground robusta steeped for 18 hours at a 1:4 ratio, then strained twice. One part concentrate to three parts water or milk gives you about eight servings. Keep refrigerated after opening and finish within a week.",
    category: "coffee-tea",
    priceCents: 1450,
    stock: 0,
    discountPercent: 30, // discounted AND out of stock: proves the two filters intersect
  },
  {
    title: "Matcha Ceremonial Grade",
    brief: "First harvest stone-ground, 30g tin",
    description:
      "A first-harvest ceremonial grade from Uji, stone-ground to a fine leaf. Vibrant green, noticeably sweet, with no bitterness when whisked properly. Comes in a sealed 30g tin with a bamboo scoop.",
    category: "coffee-tea",
    priceCents: 2900,
    stock: 4,
    reviews: [{ rating: 5, title: "Proper ceremonial grade", body: "Colour and taste are both excellent. Not bitter at all." }],
  },
  {
    title: "Burr Coffee Grinder",
    brief: "38mm conical burrs, 24 click settings",
    description:
      "A hand grinder with 38mm conical steel burrs and 24 stepped settings, from espresso-fine to French press. Two-bearing design keeps the shaft steady under load. Includes a catch cup and a tool for burr adjustment.",
    category: "coffee-tea",
    priceCents: 12500,
    stock: 7,
  },

  // --- Outdoor ---
  {
    title: "Ultralight 2P Tent",
    brief: "1.4kg trail weight, two doors, two vestibules",
    description:
      "A freestanding two-person tent pitched at 1.4kg with two doors and two full-length vestibules for wet gear. 3000mm fly and a single-hung floor that is far easier to clean than a bathtub design. Pitches in about four minutes with the included alloy poles.",
    category: "outdoor",
    discountPercent: 25, // variant product: the picker must discount each variant
    variants: [
      { name: "Medium", priceCents: 18900, stock: 6 },
      { name: "Large", priceCents: 20900, stock: 0, lowStockThreshold: 3 },
    ],
    reviews: [{ rating: 4, title: "Genuinely light", body: "Held up well in a wet weekend in the dunes." }],
  },
  {
    title: "Titanium Cook Set",
    brief: "Pot, pan, lid and bowl nesting into 420g",
    description:
      "A four-piece cook set in grade 2 titanium that nests into itself at 420 grams total. Uncoated titanium develops a patina with use and is not ideal for acidic sauces, which is why the pot is sold unseasoned rather than pre-treated.",
    category: "outdoor",
    priceCents: 6400,
    stock: 18,
  },
  {
    title: "Packable Rain Jacket",
    brief: "20k/20k waterproof, packs into its own pocket",
    description:
      "A 2.5-layer shell rated 20,000mm waterproof and 20,000g breathability, with taped seams and pit zips. Packs into its own chest pocket down to the size of a 500ml bottle. Cuts a little close through the shoulders if you are layering heavily.",
    category: "outdoor",
    variants: [
      { name: "Medium", priceCents: 8900, stock: 9 },
      { name: "Large", priceCents: 8900, stock: 3, lowStockThreshold: 5 },
    ],
  },
  {
    title: "Stainless Water Bottle 1L",
    brief: "Double wall, twenty-four hours cold",
    description:
      "A double-wall vacuum bottle that holds temperature for a full day and keeps coffee hot for most of a working day. The 1L capacity is about right for a long day out. Powder-coated finish grips well when wet.",
    category: "outdoor",
    priceCents: 2200,
    stock: 40,
    reviews: [
      { rating: 5, title: "Exactly what I wanted", body: "Ice was still floating after a 20 hour ride." },
      { rating: 4, title: "Great bottle, wide mouth", body: "Easy to clean which was my main worry." },
    ],
  },
  {
    title: "Headlamp 400 Lumen",
    brief: "Rechargeable, red night mode, IPX6",
    description:
      "A 400 lumen headlamp with a red night-vision mode that will not wreck your dark adaptation. Charges over USB-C and runs about nine hours on high or forty on low. Rated IPX6, so heavy rain and spray are fine, immersion is not.",
    category: "outdoor",
    priceCents: 3400,
    stock: 0,
  },
  {
    title: "Folding Camp Chair",
    brief: "6kg capacity, 28cm packed",
    description:
      "An aluminium frame chair that collapses to 28cm and carries up to 6kg. Mesh side panels and a cup holder that is actually reachable when you are sitting down. Comes with a carry bag.",
    category: "outdoor",
    priceCents: 4800,
    stock: 15,
  },

  // --- Stationery ---
  {
    title: "Fountain Pen Brass",
    brief: "German-made nib, converter included",
    description:
      "A brass-bodied fountain pen with a steel nib and a proper converter rather than the usual disposable cartridge. Takes a medium or broad German nib. The brass develops a patina quickly and is grippier than it looks.",
    category: "stationery",
    variants: [
      { name: "Fine", priceCents: 8900, stock: 6 },
      { name: "Medium", priceCents: 8900, stock: 9 },
      { name: "Broad", priceCents: 9400, stock: 0 },
    ],
    reviews: [
      { rating: 5, title: "Lovely weight", body: "The medium nib is smooth out of the box." },
      { rating: 4, title: "Nice, needs a cleaning routine", body: "Beautiful pen. Budget some cartridge changes." },
    ],
  },
  {
    title: "Notebook A5 Dot Grid",
    brief: "192 pages of 100gsm paper, lies flat",
    description:
      "An A5 notebook with 192 pages of 100gsm cream paper, dot grid, rounded corners and a lay-flat binding stitched so the page does not fight you. Pen index and two ribbon markers.",
    category: "stationery",
    priceCents: 1400,
    stock: 60,
    reviews: [
      { rating: 5, title: "Paper is the point", body: "No feathering with a fountain pen. Cheap for the paper quality." },
      { rating: 4, title: "Good, dots are subtle", body: "Would buy again. Slightly stiff cover." },
    ],
  },
  {
    title: "Japanese Washi Tape Set",
    brief: "Ten patterns, printed with mineral inks",
    description:
      "Ten rolls of printed washi tape using mineral inks, chosen because they do not fade the way dye-based inks do. Roughly 3mm wide on a 5m roll, which is narrower than most decorative tapes.",
    category: "stationery",
    priceCents: 1800,
    stock: 25,
  },
  {
    title: "Archival Ink Black",
    brief: "Pigment black, waterproof and lightfast",
    description:
      "A pigmented fountain pen ink rated lightfast and waterproof once dry. Slightly grey against pure black paper, which is the tradeoff for using a real pigment rather than dye. Bottle is 50ml.",
    category: "stationery",
    priceCents: 1200,
    stock: 3,
  },
  {
    title: "Leather Notebook Cover",
    brief: "Vegetable tanned, fits A5 notebooks",
    description:
      "A vegetable-tanned leather cover made to fit A5 notebooks up to about 21mm thick. Four elastic loops, two pockets, and enough slack to close over a pen. Will darken considerably with sun and handling.",
    category: "stationery",
    priceCents: 5600,
    stock: 0,
  },
  {
    title: "Brass Paperweight Hex",
    brief: "Solid machined brass, 210g",
    description:
      "A solid machined hex nut weighing 210g, lacquer sealed so it does not stain paper. Heavy enough to keep a stack of loose sheets from migrating across a desk.",
    category: "stationery",
    priceCents: 2100,
    stock: 30,
  },

  // --- Kitchen ---
  {
    title: "Cast Iron Skillet 10 inch",
    brief: "Pre-seasoned, machine smooth cooking surface",
    description:
      "A 10 inch cast iron skillet, pre-seasoned with grapeseed oil and ready to cook on. The surface is machined smooth, so it is noticeably easier to season than a rougher sand-cast blank. Handle is phenolic resin and will get hot over a flame.",
    category: "kitchen",
    priceCents: 7900,
    stock: 11,
    reviews: [
      { rating: 5, title: "Smooth out of the box", body: "Took a proper seasoning the first night. Nothing stuck." },
      { rating: 5, title: "Heavy but worth it", body: "Beautifully even heat. This is the one." },
      { rating: 4, title: "Great pan, handle gets hot", body: "Use an oven mitt. Standard warning but real." },
    ],
  },
  {
    title: "Hand Thrown Ceramic Mug",
    brief: "280ml, reactive glaze, dishwasher safe",
    description:
      "A hand thrown 280ml mug with a reactive glaze, so no two are identical in colour. The wall is thicker at the base than the rim, which keeps it warm without the handle getting hot. Dishwasher and microwave safe.",
    category: "kitchen",
    variants: [
      { name: "Sand", priceCents: 2400, stock: 20 },
      { name: "Slate", priceCents: 2400, stock: 14 },
      { name: "Rust", priceCents: 2600, stock: 2, lowStockThreshold: 5 },
    ],
    reviews: [
      { rating: 5, title: "Glaze is gorgeous", body: "Slate one looks like it was made by a studio." },
      { rating: 4, title: "Lovely mug", body: "Handle is comfortable. They do vary a little in size." },
    ],
  },
  {
    title: "Olive Wood Spoon Set",
    brief: "Three utensils, oiled and food safe",
    description:
      "Three utensils cut from olive wood, finished with food-safe oil rather than lacquer, so they can be scrubbed and re-oiled as needed. Gentle on cast iron and non-stick coatings. Hand wash and dry standing up.",
    category: "kitchen",
    priceCents: 1900,
    stock: 35,
  },
  {
    title: "Espresso Machine Single Boiler",
    brief: "PID controlled, 58mm portafilter",
    description:
      "A single boiler machine with PID temperature control and a 58mm commercial portafilter. Boiler recovery is quick enough for back to back shots without waiting. Needs a decent burr grinder to actually make good coffee.",
    category: "kitchen",
    priceCents: 45000,
    stock: 2,
  },
  {
    title: "Linen Kitchen Towels",
    brief: "Set of four, gets softer with washing",
    description:
      "A set of four 100% linen towels, which start crisp and soften noticeably after a dozen washes. Better at drying than cotton and far less likely to breed odour. Expect about 5% shrinkage.",
    category: "kitchen",
    priceCents: 1700,
    stock: 0,
  },
  {
    title: "Cold Brew Carafe 1L",
    brief: "Borosilicate glass, stainless mesh filter",
    description:
      "A 1L borosilicate carafe with a stainless mesh core for cold brew, iced tea and loose leaf. The glass will not stain the way plastic does, and the whole thing goes in the dishwasher. Handle is rated for a full jug, not just a part filled one.",
    category: "kitchen",
    priceCents: 5900,
    stock: 8,
    reviews: [{ rating: 4, title: "Good carafe", body: "Filter is easy to remove and rinse." }],
  },
  {
    title: "Enamelled Dutch Oven",
    brief: "4 and 6 quart, oven safe to 260C",
    description:
      "A cast iron Dutch oven with a vitreous enamel finish, so it does not need seasoning and will not rust. Usable from a low oven all the way to a hot hob. The enamel chips if you drop it hard enough on stone.",
    category: "kitchen",
    variants: [
      { name: "4 quart", priceCents: 15900, stock: 5 },
      { name: "6 quart", priceCents: 17900, stock: 4, lowStockThreshold: 4 },
    ],
  },
];

// Not ACTIVE, so the public endpoints must never return these. Proves status filtering.
const NON_LISTED: SeedProduct[] = [
  {
    title: "Enamel Mug Set of Four",
    brief: "Four 300ml mugs, colour matched",
    description:
      "Four 300ml mugs with a colour matched enamel finish. Still photographing the set before it goes live.",
    category: "kitchen",
    status: "DRAFT",
    priceCents: 3400,
    stock: 16,
  },
  {
    title: "Titanium Cook Pot 900ml",
    brief: "Larger pot for solo trips",
    description:
      "A 900ml titanium pot sized for solo trips. Specification still being finalised, do not list yet.",
    category: "outdoor",
    status: "DRAFT",
    priceCents: 3900,
    stock: 0,
  },
  {
    title: "Discount Coffee Grinder (2023)",
    brief: "Discontinued, previous model",
    description:
      "The previous generation grinder, kept for parts and reference. Permanently retired.",
    category: "coffee-tea",
    status: "ARCHIVED",
    priceCents: 8900,
    stock: 2,
  },
];

const ADMINS = [
  { email: "admin@openseller.test", name: "Rowan Ellis", gender: "FEMALE" as const },
  { email: "ops@openseller.test", name: "Samir Haddad", gender: "MALE" as const },
];

// Eight customer accounts: enough distinct authors for plausible rating counts.
const CUSTOMERS = [
  { email: "sarah@openseller.test", name: "Sarah Johnson", gender: "FEMALE" as const },
  { email: "mike@openseller.test", name: "Mike Davis", gender: "MALE" as const },
  { email: "emma@openseller.test", name: "Emma Wilson", gender: "FEMALE" as const },
  { email: "jake@openseller.test", name: "Jake Thompson", gender: "MALE" as const },
  { email: "noor@openseller.test", name: "Noor Al-Farsi", gender: "FEMALE" as const },
  { email: "liam@openseller.test", name: "Liam Chen", gender: "MALE" as const },
  { email: "priya@openseller.test", name: "Priya Raman", gender: "FEMALE" as const },
  { email: "tomas@openseller.test", name: "Tomas Novak", gender: "MALE" as const },
];

const PASSWORD = "password123";

// ---------------------------------------------------------------------------
// Deterministic placeholder media
//
// Real photography is not available in a seed, so each product gets a generated gradient SVG.
// User uploads are restricted to raster types (see config.uploadMimeTypes) because SVG is an
// executable format; these are written directly by the seed, never through the upload path,
// and the static route serves them with a sandboxing CSP.
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hueFor(seed: string): number {
  return parseInt(crypto.createHash("sha1").update(seed).digest("hex").slice(0, 4), 16) % 360;
}

function placeholderImage(slug: string, title: string): string {
  const hue = hueFor(slug);
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  const caption = title.length > 32 ? `${title.slice(0, 31)}…` : title;
  const fileName = `seed-${slug}.svg`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 42% 74%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 45) % 360} 38% 42%)"/>
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <circle cx="640" cy="160" r="180" fill="rgba(255,255,255,0.10)"/>
  <circle cx="150" cy="680" r="230" fill="rgba(0,0,0,0.08)"/>
  <text x="400" y="378" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="230" font-weight="700" fill="rgba(255,255,255,0.92)" text-anchor="middle" dominant-baseline="central">${escapeXml(initials)}</text>
  <text x="400" y="580" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="34" font-weight="500" fill="rgba(255,255,255,0.88)" text-anchor="middle">${escapeXml(caption)}</text>
</svg>
`;

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadsDir, fileName), svg, "utf8");

  return `/uploads/${fileName}`;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function upsertUser(
  input: { email: string; name: string; gender: "MALE" | "FEMALE" },
  role: "ADMIN" | "USER",
) {
  const password = await bcrypt.hash(PASSWORD, 10);

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      password,
      emailVerified: true,
      profile: {
        update: { name: input.name, role, firstTime: false, nationality: "Emirati" },
      },
    },
    create: {
      email: input.email,
      password,
      emailVerified: true,
      profile: {
        create: {
          name: input.name,
          role,
          gender: input.gender,
          firstTime: false,
          nationality: "Emirati",
          phone: "+971-55-0100",
          dob: new Date("1995-06-15"),
        },
      },
    },
    include: { profile: true },
  });
}

async function main() {
  console.log("Seeding...");

  fs.mkdirSync(config.uploadsDir, { recursive: true });

  // --- people ---
  for (const admin of ADMINS) await upsertUser(admin, "ADMIN");
  const customers = [];
  for (const customer of CUSTOMERS) customers.push(await upsertUser(customer, "USER"));
  console.log(`  users: ${ADMINS.length} admins, ${customers.length} customers`);

  // --- categories ---
  const categoryBySlug = new Map<string, string>();
  for (const category of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, sortOrder: category.sortOrder },
      create: category,
    });
    categoryBySlug.set(category.slug, row.id);
  }
  console.log(`  categories: ${CATEGORIES.length}`);

  // --- products, variants, media, reviews ---
  const productIdsBySlug = new Map<string, string>();
  let productCount = 0;
  let variantCount = 0;

  for (const seed of [...PRODUCTS, ...NON_LISTED]) {
    const slug = slugify(seed.title);
    const categoryId = categoryBySlug.get(seed.category) ?? null;
    const status = seed.status ?? "ACTIVE";

    // A simple product is exactly one variant named "Default", so cart lines and order
    // items have a single shape whether or not a product offers choices.
    const variants: SeedVariant[] = seed.variants ?? [
      {
        name: "Default",
        priceCents: seed.priceCents ?? 0,
        stock: seed.stock ?? 0,
      },
    ];

    const product = await prisma.product.upsert({
      where: { slug },
      update: {
        title: seed.title,
        brief: seed.brief,
        description: seed.description,
        status,
        categoryId,
        // reset to 0 when unspecified, so removing a discount from the seed actually removes it
        discountPercent: seed.discountPercent ?? 0,
      },
      create: {
        slug,
        title: seed.title,
        brief: seed.brief,
        description: seed.description,
        status,
        categoryId,
        discountPercent: seed.discountPercent ?? 0,
      },
    });
    productIdsBySlug.set(slug, product.id);
    productCount += 1;

    for (const [index, variant] of variants.entries()) {
      await prisma.variant.upsert({
        where: { sku: `${slug.toUpperCase().replace(/-/g, "")}-${index + 1}` },
        update: {
          name: variant.name,
          priceCents: variant.priceCents,
          stock: variant.stock,
          lowStockThreshold: variant.lowStockThreshold ?? 5,
          position: index,
        },
        create: {
          productId: product.id,
          sku: `${slug.toUpperCase().replace(/-/g, "")}-${index + 1}`,
          name: variant.name,
          priceCents: variant.priceCents,
          stock: variant.stock,
          lowStockThreshold: variant.lowStockThreshold ?? 5,
          position: index,
        },
      });
      variantCount += 1;
    }

    // images are replaced wholesale rather than upserted: ProductImage has no natural key
    const imageUrl = placeholderImage(slug, seed.title);
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.create({
      data: { productId: product.id, url: imageUrl, alt: seed.title, position: 0 },
    });

    // the card fields cards read from
    await recomputeProductRollup(product.id, prisma);

    // spread review authorship across the seeded customers
    if (seed.reviews?.length) {
      for (const [index, review] of seed.reviews.entries()) {
        const author = customers[(productCount + index) % customers.length];
        // reviews belong to a Profile, not a User: the reviewer's account is a credential,
        // the Profile is the person attached to the purchase
        const authorProfileId = author.profile!.id;
        await prisma.review.upsert({
          where: { productId_profileId: { productId: product.id, profileId: authorProfileId } },
          update: { rating: review.rating, title: review.title, body: review.body },
          create: {
            productId: product.id,
            profileId: authorProfileId,
            rating: review.rating,
            title: review.title,
            body: review.body,
          },
        });
      }
      await recomputeProductRating(product.id, prisma);
    }
  }

  console.log(`  products: ${productCount} (${PRODUCTS.length} listed, ${NON_LISTED.length} draft/archived)`);
  console.log(`  variants: ${variantCount}`);

  // --- addresses, orders, complaints ---
  const ordersInDb = await prisma.order.count();
  if (ordersInDb === 0) {
    // One saved address per shopper, so every seeded order has a shipping snapshot.
    const addressTemplates = [
      { line1: "Villa 12, Al Wasl Road", line2: "Villa 12", city: "Dubai", region: "Dubai" },
      { line1: "Level 4, Emaar Business Park", line2: null, city: "Dubai", region: "Dubai" },
      { line1: "Tower 2, Marina Gate 3", line2: "Apt 1704", city: "Dubai", region: "Dubai" },
    ];

    const addresses = [];
    for (const [index, customer] of customers.entries()) {
      const template = addressTemplates[index % addressTemplates.length];
      const profileId = customer.profile!.id;
      await prisma.address.deleteMany({ where: { profileId } });
      addresses.push(
        await prisma.address.create({
          data: {
            profileId,
            label: index % 2 === 0 ? "Home" : "Office",
            recipientName: customer.profile!.name,
            line1: template.line1,
            line2: template.line2,
            city: template.city,
            region: template.region,
            postalCode: "00000",
            countryCode: "AE",
            phone: customer.profile!.phone,
            isDefault: true,
          },
        }),
      );
    }

    const listedProducts = PRODUCTS.filter((product) => (product.status ?? "ACTIVE") === "ACTIVE");

    // Spread orders across the last ten weeks so the admin revenue buckets (week / month /
    // all time) all have data on day one.
    const orderPlans: {
      customer: number;
      lineIndexes: number[];
      quantities: number[];
      status: "PAID" | "FULFILLED";
      createdAt: Date;
    }[] = [
      { customer: 0, lineIndexes: [0, 2], quantities: [2, 1], status: "FULFILLED", createdAt: daysAgo(62) },
      { customer: 1, lineIndexes: [3], quantities: [1], status: "FULFILLED", createdAt: daysAgo(48) },
      { customer: 2, lineIndexes: [5, 6], quantities: [1, 2], status: "FULFILLED", createdAt: daysAgo(39) },
      { customer: 3, lineIndexes: [11, 13], quantities: [2, 1], status: "FULFILLED", createdAt: daysAgo(31) },
      { customer: 4, lineIndexes: [17], quantities: [1], status: "FULFILLED", createdAt: daysAgo(24) },
      { customer: 5, lineIndexes: [0, 18], quantities: [1, 3], status: "PAID", createdAt: daysAgo(17) },
      { customer: 6, lineIndexes: [19], quantities: [2], status: "PAID", createdAt: daysAgo(11) },
      { customer: 7, lineIndexes: [7, 20], quantities: [1, 1], status: "PAID", createdAt: daysAgo(6) },
      { customer: 0, lineIndexes: [23], quantities: [1], status: "PAID", createdAt: daysAgo(2) },
    ];

    let firstPaidOrderId: string | null = null;
    let secondPaidOrderId: { orderId: string; profileId: string } | null = null;
    let complaintTarget: { orderId: string; profileId: string; orderItemId: string; title: string } | null = null;

    for (const plan of orderPlans) {
      const customer = customers[plan.customer];
      const customerProfileId = customer.profile!.id;
      const address = addresses[plan.customer]!;

      const items = plan.lineIndexes.map((lineIndex, itemIndex) => {
        const seed = listedProducts[lineIndex];
        const slug = slugify(seed.title);
        const productId = productIdsBySlug.get(slug)!;
        const variants = seed.variants ?? [
          { name: "Default", priceCents: seed.priceCents ?? 0, stock: seed.stock ?? 0 },
        ];
        // pick a variant that is actually purchasable
        const variant = variants.find((candidate) => candidate.stock > 0) ?? variants[0];
        const sku = `${slug.toUpperCase().replace(/-/g, "")}-${variants.indexOf(variant) + 1}`;
        return {
          productId,
          sku,
          title: seed.title,
          variantName: variant.name,
          unitPriceCents: variant.priceCents,
          quantity: plan.quantities[itemIndex],
          imageUrl: placeholderImage(slug, seed.title),
        };
      });

      const subtotalCents = items.reduce(
        (sum, item) => sum + item.unitPriceCents * item.quantity,
        0,
      );

      const order = await prisma.order.create({
        data: {
          profileId: customerProfileId,
          status: plan.status,
          payment: "PAID",
          currency: config.currency,
          subtotalCents,
          shippingCents: 0,
          taxCents: 0,
          totalCents: subtotalCents,
          createdAt: plan.createdAt,
          stripeCheckoutSessionId: `seed-session-${customerProfileId}-${plan.createdAt.getTime()}`,
          stripePaymentIntentId: `seed-pi-${customerProfileId}-${plan.createdAt.getTime()}`,
          shippingAddress: {
            recipientName: address.recipientName,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            region: address.region,
            postalCode: address.postalCode,
            countryCode: address.countryCode,
            phone: address.phone,
          },
          items: { create: items },
          events: {
            create: [
              { type: "payment.succeeded", note: "Payment captured", createdAt: plan.createdAt },
              ...(plan.status === "FULFILLED"
                ? [
                    {
                      type: "status.changed",
                      note: "Marked as fulfilled",
                      createdAt: new Date(plan.createdAt.getTime() - 3 * 24 * 60 * 60 * 1000),
                    },
                  ]
                : []),
            ],
          },
        },
        include: { items: true },
      });

      if (!firstPaidOrderId) firstPaidOrderId = order.id;
      if (!complaintTarget && plan.status === "FULFILLED") {
        complaintTarget = {
          orderId: order.id,
          profileId: customerProfileId,
          orderItemId: order.items[0].id,
          title: order.items[0].title,
        };
      } else if (!secondPaidOrderId && plan.status === "FULFILLED") {
        secondPaidOrderId = { orderId: order.id, profileId: customerProfileId };
      }
    }

    console.log(`  orders: ${orderPlans.length}`);

    // Two complaints so the admin inbox has something to triage in a later phase.
    if (complaintTarget && secondPaidOrderId) {
      await prisma.complaint.create({
        data: {
          orderId: complaintTarget.orderId,
          orderItemId: complaintTarget.orderItemId,
          profileId: complaintTarget.profileId,
          reason: "DAMAGED",
          details: `The ${complaintTarget.title} arrived with a dented corner on the tin. Photos sent by email, happy to return it for a replacement.`,
          status: "OPEN",
        },
      });
      await prisma.orderEvent.create({
        data: {
          orderId: complaintTarget.orderId,
          type: "complaint.opened",
          note: "Reported as damaged on arrival",
        },
      });

      await prisma.complaint.create({
        data: {
          orderId: secondPaidOrderId.orderId,
          profileId: secondPaidOrderId.profileId,
          reason: "LATE_DELIVERY",
          details:
            "Tracking had not updated for six days and nobody could tell me where the parcel was.",
          status: "ACKNOWLEDGED",
          resolution: "Chased with the courier, delivered two days later.",
          resolvedAt: daysAgo(40),
        },
      });
      console.log("  complaints: 2");
    }
  } else {
    console.log(`  orders: ${ordersInDb} already present, skipping`);
  }

  console.log("Seed complete.");
  console.log(`  admin login:  admin@openseller.test / ${PASSWORD}`);
  console.log(`  shopper login: sarah@openseller.test / ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
