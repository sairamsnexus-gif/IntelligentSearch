/**
 * SYNTHETIC TEST WORLD — every organisation, person, page and result here is
 * fictional and labelled SYNTHETIC in the UI. Used for demo mode (no services
 * or keys) and for tests. Real platform hostnames are never fetched in this
 * mode; "open source" renders the synthetic page locally.
 */

export interface SyntheticPage {
  url: string;
  status: number;
  html: string;
  /** robots.txt disallows this page for our crawler */
  robotsDisallow?: boolean;
  /** visible to synthetic search */
  indexed: boolean;
}

const page = (title: string, body: string, opts: { jsonld?: object; meta?: Record<string, string> } = {}) =>
  `<!doctype html><html><head><title>${title}</title>${Object.entries(opts.meta ?? {})
    .map(([k, v]) => `<meta ${k.startsWith("og:") || k.startsWith("article:") ? "property" : "name"}="${k}" content="${v}">`)
    .join("")}${opts.jsonld ? `<script type="application/ld+json">${JSON.stringify(opts.jsonld)}</script>` : ""}</head><body>${body}</body></html>`;

const G = "https://sivasma-garments.example";
const S = "https://littlelotus-montessori.example";

const garmentsNav = `<nav><a href="${G}/">Home</a> <a href="${G}/about">About us</a> <a href="${G}/team">Our team</a> <a href="${G}/contact">Contact</a> <a href="${G}/products">Products</a> <a href="${G}/privacy">Privacy</a></nav>`;
const schoolNav = `<nav><a href="${S}/">Home</a> <a href="${S}/leadership">Leadership</a> <a href="${S}/contact">Contact</a> <a href="${S}/admissions">Admissions</a></nav>`;

export const SYNTHETIC_PAGES: SyntheticPage[] = [
  // ---------------- Sivasma Garments (fictional) ----------------
  {
    url: `${G}/`,
    status: 200,
    indexed: true,
    html: page(
      "Sivasma Garments | Cotton garments, Chennai",
      `${garmentsNav}<h1>Sivasma Garments</h1><p>Quality cotton garments and school uniforms made in Chennai since 2014.</p>
       <p>Follow us: <a href="https://www.instagram.com/sivasmagarments">Instagram</a> · <a href="https://wa.me/914424345678">WhatsApp us</a></p>`,
      {
        meta: { description: "Sivasma Garments — cotton garments and uniforms, T. Nagar, Chennai.", "og:site_name": "Sivasma Garments" },
        jsonld: {
          "@context": "https://schema.org",
          "@type": "ClothingStore",
          name: "Sivasma Garments",
          url: `${G}/`,
          telephone: "+91 44 2434 5678",
          email: "info@sivasma-garments.example",
          foundingDate: "2014",
          address: { "@type": "PostalAddress", streetAddress: "12 Usman Road, T. Nagar", addressLocality: "Chennai", postalCode: "600017", addressCountry: "IN" },
          sameAs: ["https://www.instagram.com/sivasmagarments"],
        },
      },
    ),
  },
  {
    url: `${G}/about`,
    status: 200,
    indexed: true,
    html: page("About us | Sivasma Garments", `${garmentsNav}<h1>About us</h1><p>Sivasma Garments was co-founded by Siva Raman and Asma Siva in Chennai. We began in a small T. Nagar workshop and today supply cotton wear across Tamil Nadu.</p><p>Our sister concern <a href="https://sivasma-exports.example/">Sivasma Exports</a> handles overseas orders.</p>`),
  },
  {
    url: `${G}/team`,
    status: 200,
    indexed: false,
    html: page("Our team | Sivasma Garments", `${garmentsNav}<h1>Our team</h1><p>Siva Raman – Managing Director.</p><p>Asma Siva – Co-founder and design lead.</p>`),
  },
  {
    url: `${G}/contact`,
    status: 200,
    indexed: false,
    html: page(
      "Contact | Sivasma Garments",
      `${garmentsNav}<h1>Contact</h1><p>Address: 12 Usman Road, T. Nagar, Chennai 600017.</p><p>Phone: +91 44 2434 5678. Email: <a href="mailto:info@sivasma-garments.example">info@sivasma-garments.example</a></p><p><a href="https://wa.me/914424345678">WhatsApp Business</a></p>`,
    ),
  },
  { url: `${G}/products`, status: 200, indexed: false, html: page("Products | Sivasma Garments", `${garmentsNav}<p>Cotton kurtas, school uniforms and kidswear.</p>`) },
  {
    url: "https://sivasma-exports.example/",
    status: 200,
    indexed: false,
    html: page("Sivasma Exports | Garment exports from Chennai", `<h1>Sivasma Exports</h1><p>Sivasma Exports, a sister concern of Sivasma Garments, ships cotton garments to the Gulf. Managed by Siva Raman.</p><p>Office: 12 Usman Road, T. Nagar, Chennai 600017.</p>`, {
      jsonld: { "@context": "https://schema.org", "@type": "Organization", name: "Sivasma Exports", url: "https://sivasma-exports.example/", email: "exports@sivasma-exports.example" },
    }),
  },

  // ---------------- Little Lotus Montessori (fictional) ----------------
  {
    url: `${S}/`,
    status: 200,
    indexed: true,
    html: page("Little Lotus Montessori | Adyar, Chennai", `${schoolNav}<h1>Little Lotus Montessori</h1><p>A Montessori pre-school in Adyar, Chennai for children aged 2 to 6.</p><p><a href="https://www.instagram.com/littlelotuskids">Instagram</a></p>`, {
      meta: { "og:site_name": "Little Lotus Montessori" },
      jsonld: {
        "@context": "https://schema.org",
        "@type": "Preschool",
        name: "Little Lotus Montessori",
        url: `${S}/`,
        telephone: "+91 44 2441 9900",
        email: "office@littlelotus-montessori.example",
        address: { "@type": "PostalAddress", streetAddress: "4 Gandhi Nagar 2nd Main Road, Adyar", addressLocality: "Chennai", postalCode: "600020", addressCountry: "IN" },
      },
    }),
  },
  { url: `${S}/leadership`, status: 200, indexed: false, html: page("Leadership | Little Lotus Montessori", `${schoolNav}<h1>Leadership</h1><p>Founder &amp; Principal: Asma Siva. She trained at a Montessori teacher-training centre in Chennai.</p><p>Administrator: Meena Krishnan.</p>`) },
  { url: `${S}/contact`, status: 200, indexed: false, html: page("Contact | Little Lotus Montessori", `${schoolNav}<p>Address: 4 Gandhi Nagar 2nd Main Road, Adyar, Chennai 600020.</p><p>School office: +91 44 2441 9900 · office@littlelotus-montessori.example</p>`) },
  { url: `${S}/admissions`, status: 200, indexed: false, html: page("Admissions | Little Lotus Montessori", `${schoolNav}<p>Admissions for the 2026–27 academic year are open.</p>`) },

  // ---------------- Independent & copied coverage ----------------
  {
    url: "https://chennai-weekly.example/2025/09/montessori-schools-in-adyar",
    status: 200,
    indexed: true,
    html: page("Montessori schools in Adyar — Chennai Weekly", `<article><h1>Five Montessori schools in Adyar</h1><p>Little Lotus Montessori, founded by Asma Siva, focuses on practical-life activities.</p><p>The school is on Gandhi Nagar 2nd Main Road.</p></article>`, { meta: { "article:published_time": "2025-09-14T00:00:00Z" } }),
  },
  {
    url: "https://chennai-business-directory.example/listing/sivasma-garments",
    status: 200,
    indexed: true,
    html: page("Sivasma Garments – T. Nagar, Chennai | Business Directory", `<h1>Sivasma Garments</h1><p>Garment manufacturer. 12 Usman Road, T. Nagar, Chennai 600017. Established in 2012. Phone +91 44 2434 5678.</p><p><a href="${G}/">Official website</a></p>`),
  },
  ...["https://newswire-a.example/releases/sivasma-velachery", "https://chennai-business-news.example/sivasma-opens-velachery-showroom", "https://textile-today.example/news/sivasma-showroom"].map((url) => ({
    url,
    status: 200,
    indexed: true,
    html: page(
      "Sivasma Garments opens second showroom in Velachery",
      `<article><h1>Sivasma Garments opens second showroom in Velachery</h1><p>Chennai: Sivasma Garments today opened its second showroom in Velachery. "We are grateful to our customers," said Siva Raman, Managing Director of Sivasma Garments. The new store stocks cotton wear and school uniforms.</p></article>`,
      { meta: { "article:published_time": "2026-02-02T00:00:00Z" } },
    ),
  })),
  {
    url: "https://tamil-news.example/2026/01/montessori-adyar",
    status: 200,
    indexed: true,
    html: page("அடையாறு மாண்டிசோரி பள்ளி", `<article><p>சென்னை அடையாறில் உள்ள லிட்டில் லோட்டஸ் மாண்டிசோரி பள்ளியை அஸ்மா நடத்துகிறார்.</p></article>`),
  },

  // ---------------- Namesakes (conflicts) ----------------
  {
    url: "https://asmas-boutique.example/",
    status: 200,
    indexed: true,
    html: page("Asma's Boutique | Indiranagar, Bengaluru", `<h1>Asma's Boutique</h1><p>Designer clothing in Indiranagar, Bengaluru. Founded by Asma Begum in 2019.</p><p>Address: 100 Feet Road, Indiranagar, Bengaluru 560038.</p>`, {
      jsonld: { "@context": "https://schema.org", "@type": "ClothingStore", name: "Asma's Boutique", telephone: "+91 80 4111 2222", address: { "@type": "PostalAddress", addressLocality: "Bengaluru", postalCode: "560038" } },
    }),
  },
  {
    url: "https://siva-textiles.example/",
    status: 200,
    indexed: true,
    html: page("Siva Textiles | Coimbatore", `<h1>Siva Textiles</h1><p>Yarn and textiles from Coimbatore since 1998. Proprietor: Siva Kumar.</p>`),
  },

  // ---------------- Access failures ----------------
  { url: "https://www.instagram.com/sivasmagarments", status: 200, indexed: true, robotsDisallow: true, html: page("Sivasma Garments (@sivasmagarments) • Instagram", "<p>Login to see more.</p>") },
  { url: "https://www.instagram.com/littlelotuskids", status: 200, indexed: false, robotsDisallow: true, html: page("Little Lotus (@littlelotuskids) • Instagram", "<p>Login</p>") },
  { url: "https://old-chennai-directory.example/sivasma", status: 404, indexed: true, html: page("Not found", "<p>404</p>") },
];

export function syntheticPage(url: string): SyntheticPage | undefined {
  const norm = (u: string) => u.replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
  return SYNTHETIC_PAGES.find((p) => norm(p.url) === norm(url));
}

/** Maigret (simulated): username → profiles that exist. */
export const SYNTHETIC_USERNAMES: Record<string, { site: string; url: string }[]> = {
  sivasmagarments: [
    { site: "Instagram", url: "https://www.instagram.com/sivasmagarments" },
    { site: "YouTube", url: "https://www.youtube.com/@sivasmagarments" },
  ],
  littlelotuskids: [{ site: "Instagram", url: "https://www.instagram.com/littlelotuskids" }],
};

/** SpiderFoot (simulated): domain → events. `fail` simulates an engine failure. */
export const SYNTHETIC_SPIDERFOOT: Record<string, { fail?: string; events: { type: string; data: string; module: string }[] }> = {
  "sivasma-garments.example": {
    events: [
      { type: "COMPANY_NAME", data: "Sivasma Garments Private Limited", module: "sfp_company" },
      { type: "SOCIAL_MEDIA", data: "Instagram: <SFURL>https://www.instagram.com/sivasmagarments</SFURL>", module: "sfp_social" },
      { type: "AFFILIATE_INTERNET_NAME", data: "sivasma-exports.example", module: "sfp_spider" },
      { type: "LINKED_URL_EXTERNAL", data: "https://chennai-business-directory.example/listing/sivasma-garments", module: "sfp_spider" },
      { type: "DOMAIN_REGISTRAR", data: "Example Registrar Ltd", module: "sfp_whois" },
    ],
  },
  "littlelotus-montessori.example": { fail: "SpiderFoot scan ERROR-FAILED: module sfp_spider aborted (simulated failure)", events: [] },
};
