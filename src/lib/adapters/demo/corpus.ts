/**
 * DEMO DATA — entirely fictional people and documents.
 *
 * Every person here is invented. URLs look like real platform URLs so that the
 * identity-resolution logic (profile parsing, cross-links) is exercised
 * realistically, but the UI never links out to them in demo mode: "Open
 * source" renders the fake snapshot at /demo-source instead.
 *
 * `versions[i]` is the document text after i completed monitoring scans
 * (index clamps to the last entry). `null` means the page is gone (HTTP 404).
 */
import type { QueryChannel, SourceType } from "@/lib/core/types";

export interface DemoDoc {
  id: string;
  persona: string;
  url: string;
  title: string;
  versions: (string | null)[];
  channels: QueryChannel[];
  sourceType: SourceType;
  sourcePlatform: string;
  name?: string;
  username?: string;
  publishedAt?: string;
  /** Hidden from search until this many monitoring scans have completed. */
  availableFrom?: number;
}

export const DEMO_PERSONAS: Record<string, string> = {
  P1: "Rajesh Kumar — Project Manager, TCS Chennai (ex-Infosys), ~40",
  P2: "Rajesh Kumar — Project Manager, TCS Chennai (ex-HCLTech), ~31",
  P3: "Rajesh Kumar — Senior Software Engineer, TCS Chennai",
  P4: "Rajesh Kumar — Project Manager, TCS Bengaluru (ex-Wipro)",
  P5: "Rajesh Kumar — Project Manager, Cognizant Chennai",
  P6: "Rajesh Kumar — Data Analyst, HCLTech Delhi",
  P7: "Rajesh K Kumar — Freelance photographer, Chennai",
};

const W: QueryChannel[] = ["web"];

export const DEMO_DOCS: DemoDoc[] = [
  // ---------------- P1 — the demo "target" ------------------------------
  {
    id: "p1-linkedin",
    persona: "P1",
    url: "https://www.linkedin.com/in/rajeshkumar-pm-chennai",
    title: "Rajesh Kumar – Project Manager – TCS | LinkedIn",
    versions: [
      "Rajesh Kumar. Project Manager at TCS. Chennai, Tamil Nadu, India. 500+ connections. About: Leads agile delivery for banking and insurance programmes. Previously at Infosys (2010–2016) as Technical Lead. Speaker, Agile India 2025. GitHub: github.com/rajeshkumar78",
      "Rajesh Kumar. Senior Project Manager at TCS. Chennai, Tamil Nadu, India. 500+ connections. About: Leads agile delivery for banking and insurance programmes. Previously at Infosys (2010–2016) as Technical Lead. Speaker, Agile India 2025. GitHub: github.com/rajeshkumar78",
    ],
    channels: W,
    sourceType: "profile",
    sourcePlatform: "linkedin",
    name: "Rajesh Kumar",
  },
  {
    id: "p1-github",
    persona: "P1",
    url: "https://github.com/rajeshkumar78",
    title: "Rajesh Kumar (rajeshkumar78) · GitHub",
    versions: [
      "Rajesh Kumar rajeshkumar78. Project Manager at TCS · Chennai. Scripts for sprint reporting and Jira dashboards. linkedin.com/in/rajeshkumar-pm-chennai. Popular repositories: sprint-burndown-tools, raid-log-templates.",
    ],
    channels: ["web", "github"],
    sourceType: "profile",
    sourcePlatform: "github",
    name: "Rajesh Kumar",
    username: "rajeshkumar78",
  },
  {
    id: "p1-youtube",
    persona: "P1",
    url: "https://www.youtube.com/@agiletalks-rajesh",
    title: "Agile Talks with Rajesh Kumar · YouTube",
    versions: [
      "Agile Talks with Rajesh Kumar. Chennai-based Project Manager at TCS sharing agile delivery lessons, sprint rituals and stakeholder management. 2.1K subscribers. linkedin.com/in/rajeshkumar-pm-chennai",
    ],
    channels: ["web", "youtube"],
    sourceType: "profile",
    sourcePlatform: "youtube",
    name: "Rajesh Kumar",
  },
  {
    id: "p1-blog",
    persona: "P1",
    url: "https://rajeshkumar78.blogspot.com/2023/05/sprint-retrospectives-that-work.html",
    title: "Sprint retrospectives that work — Rajesh Kumar",
    versions: [
      "Sprint retrospectives that work. By Rajesh Kumar, Project Manager at TCS, Chennai. Notes from ten years of running retros, first at Infosys and now at TCS. Code samples: github.com/rajeshkumar78",
      null,
    ],
    channels: W,
    sourceType: "article",
    sourcePlatform: "web",
    name: "Rajesh Kumar",
    publishedAt: "2023-05-14T00:00:00.000Z",
  },
  {
    id: "p1-news-award",
    persona: "P1",
    url: "https://chennaitechnews.example.com/2026/03/tcs-chennai-delivery-excellence-award",
    title: "TCS Chennai team wins delivery excellence award",
    versions: [
      "A TCS delivery team in Chennai received the annual delivery excellence award. The programme was led by the 40-year-old Project Manager Rajesh Kumar, who joined TCS from Infosys in 2016.",
    ],
    channels: ["web", "news"],
    sourceType: "article",
    sourcePlatform: "news",
    publishedAt: "2026-03-02T00:00:00.000Z",
  },
  {
    id: "p1-instagram",
    persona: "P1",
    url: "https://www.instagram.com/rajeshkumar78",
    title: "Rajesh Kumar (@rajeshkumar78) • Instagram photos and videos",
    versions: ["Rajesh Kumar @rajeshkumar78 Instagram. Chennai. Weekend treks, filter coffee and the occasional sprint board. 312 posts."],
    channels: W,
    sourceType: "profile",
    sourcePlatform: "instagram",
    name: "Rajesh Kumar",
    username: "rajeshkumar78",
  },
  {
    id: "p1-medium",
    persona: "P1",
    url: "https://medium.com/@rajeshkumar78",
    title: "rajeshkumar78 on Medium",
    versions: ["Username rajeshkumar78 exists on Medium."],
    channels: ["username"],
    sourceType: "profile",
    sourcePlatform: "medium",
    username: "rajeshkumar78",
  },
  {
    id: "p1-news-summit",
    persona: "P1",
    url: "https://chennaitechnews.example.com/2026/09/ai-in-project-delivery-summit",
    title: "AI in project delivery: TCS's Rajesh Kumar at Chennai summit",
    versions: [
      "At the Chennai Delivery Summit, Senior Project Manager Rajesh Kumar of TCS spoke on using AI assistants for RAID logs and sprint forecasting. Profile: linkedin.com/in/rajeshkumar-pm-chennai",
    ],
    channels: ["web", "news"],
    sourceType: "article",
    sourcePlatform: "news",
    publishedAt: "2026-09-22T00:00:00.000Z",
    availableFrom: 1,
  },

  // ---------------- Shared / ambiguous ------------------------------------
  {
    id: "shared-conference",
    persona: "P1|P2",
    url: "https://agileindia.example.org/2025/speakers",
    title: "Agile India 2025 — Speakers",
    versions: ["Agile India 2025 speakers include Rajesh Kumar, Project Manager, TCS, Chennai — spoke at Agile India 2025 on scaling scrum across vendor teams."],
    channels: ["web", "images"],
    sourceType: "web",
    sourcePlatform: "web",
  },
  {
    id: "shared-pdf",
    persona: "none",
    url: "https://tcs-alumni.example.org/newsletters/2024-q4.pdf",
    title: "Quarterly newsletter (PDF)",
    versions: ["Newsletter Q4 2024. Congratulations to Rajesh Kumar (TCS) on completing PMP certification."],
    channels: W,
    sourceType: "document",
    sourcePlatform: "web",
  },

  // ---------------- P2 ----------------------------------------------------
  {
    id: "p2-linkedin",
    persona: "P2",
    url: "https://www.linkedin.com/in/rajesh-kumar-tcs-projects",
    title: "Rajesh Kumar – Project Manager at TCS | LinkedIn",
    versions: ["Rajesh Kumar. Project Manager at TCS. Chennai, Tamil Nadu, India. Retail and supply-chain transformation. Previously worked at HCLTech (2016–2021)."],
    channels: W,
    sourceType: "profile",
    sourcePlatform: "linkedin",
    name: "Rajesh Kumar",
  },
  {
    id: "p2-blog",
    persona: "P2",
    url: "https://rajeshwrites.example.net/about",
    title: "About — Rajesh Kumar",
    versions: ["Hi, I'm Rajesh Kumar, a 31-year-old Project Manager at TCS in Chennai. I write about retail tech. Find me on LinkedIn: linkedin.com/in/rajesh-kumar-tcs-projects"],
    channels: W,
    sourceType: "web",
    sourcePlatform: "web",
    name: "Rajesh Kumar",
  },

  // ---------------- P3 ----------------------------------------------------
  {
    id: "p3-linkedin",
    persona: "P3",
    url: "https://www.linkedin.com/in/rajesh-kumar-sse-tcs",
    title: "Rajesh Kumar – Senior Software Engineer – TCS | LinkedIn",
    versions: ["Rajesh Kumar. Senior Software Engineer at TCS. Chennai, Tamil Nadu, India. Java, Spring Boot, Kafka. Instagram: instagram.com/rk_chennai_clicks"],
    channels: W,
    sourceType: "profile",
    sourcePlatform: "linkedin",
    name: "Rajesh Kumar",
  },
  {
    id: "p3-instagram",
    persona: "P3",
    url: "https://www.instagram.com/rk_chennai_clicks",
    title: "Rajesh Kumar (@rk_chennai_clicks) • Instagram",
    versions: ["Rajesh Kumar @rk_chennai_clicks Instagram. Chennai street photography. Software engineer by day."],
    channels: W,
    sourceType: "profile",
    sourcePlatform: "instagram",
    name: "Rajesh Kumar",
    username: "rk_chennai_clicks",
  },

  // ---------------- P4 ----------------------------------------------------
  {
    id: "p4-linkedin",
    persona: "P4",
    url: "https://www.linkedin.com/in/rajeshkumar-blr-pm",
    title: "Rajesh Kumar – Project Manager – TCS Bengaluru | LinkedIn",
    versions: ["Rajesh Kumar. Project Manager at TCS. Bengaluru, Karnataka, India. Telecom OSS/BSS programmes. Previously at Wipro."],
    channels: W,
    sourceType: "profile",
    sourcePlatform: "linkedin",
    name: "Rajesh Kumar",
  },

  // ---------------- P5 ----------------------------------------------------
  {
    id: "p5-linkedin",
    persona: "P5",
    url: "https://www.linkedin.com/in/rajesh-kumar-cts",
    title: "Rajesh Kumar – Project Manager – Cognizant | LinkedIn",
    versions: ["Rajesh Kumar. Project Manager at Cognizant. Chennai, Tamil Nadu, India. Healthcare claims platforms."],
    channels: W,
    sourceType: "profile",
    sourcePlatform: "linkedin",
    name: "Rajesh Kumar",
  },

  // ---------------- P6 ----------------------------------------------------
  {
    id: "p6-github",
    persona: "P6",
    url: "https://github.com/rkumar-data",
    title: "Rajesh Kumar (rkumar-data) · GitHub",
    versions: ["Rajesh Kumar rkumar-data. Data Analyst at HCLTech · Delhi, India. Pandas notebooks and Power BI templates."],
    channels: ["web", "github"],
    sourceType: "profile",
    sourcePlatform: "github",
    name: "Rajesh Kumar",
    username: "rkumar-data",
  },
  {
    id: "p6-reddit",
    persona: "P6",
    url: "https://www.reddit.com/r/dataengineering/comments/demo123/moving_from_excel_to_python",
    title: "Moving from Excel to Python at HCLTech — r/dataengineering",
    versions: ["Posted by u/rkumar_data. I'm Rajesh Kumar, a Data Analyst at HCLTech in Delhi. Tips for moving reporting from Excel to Python?"],
    channels: ["web", "reddit"],
    sourceType: "post",
    sourcePlatform: "reddit",
  },

  // ---------------- P7 ----------------------------------------------------
  {
    id: "p7-site",
    persona: "P7",
    url: "https://rkkframes.example.com",
    title: "Rajesh K Kumar Photography — Chennai",
    versions: ["Rajesh K Kumar. Freelance Photographer based in Chennai, India. Weddings and portraits. Instagram: instagram.com/rkk_frames"],
    channels: ["web", "images"],
    sourceType: "web",
    sourcePlatform: "web",
    name: "Rajesh K Kumar",
  },
];

export function docVersion(doc: DemoDoc, epoch: number): string | null {
  return doc.versions[Math.min(Math.max(epoch, 0), doc.versions.length - 1)];
}

export function findDemoDoc(url: string): DemoDoc | undefined {
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase();
  return DEMO_DOCS.find((d) => norm(d.url) === norm(url));
}
