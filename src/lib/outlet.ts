import type { OutletProfile, OutletReferencePoint } from "../types";

export const OUTLET_PLACEMENT_DISCLAIMER =
  "Placement synthesizes publicly available assessments of the outlet's overall record (media-research organizations, academic surveys, and public reference material). It describes the outlet, not this article, and is context for reading — not Ellipsis's verdict on truth or trustworthiness.";

interface OutletRecord {
  name: string;
  hosts: string[];
  headquarters: string;
  country: string;
  ownership: string;
  funding: string;
  founded: string;
  medium: string;
  factuality: number;
  affiliation: number;
  note?: string;
  reference?: boolean;
}

// factuality: 0-100 record of factual reporting per public assessments (higher = stronger).
// affiliation: -100 (left) to 100 (right), 0 = centrist, per the same public assessments.
const OUTLETS: OutletRecord[] = [
  { name: "Reuters", hosts: ["reuters.com"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "Thomson Reuters (public company)", funding: "Subscriptions and media licensing", founded: "1851", medium: "Wire service", factuality: 92, affiliation: 0, reference: true },
  { name: "Associated Press", hosts: ["apnews.com", "ap.org"], headquarters: "New York City, United States", country: "United States", ownership: "Nonprofit cooperative of member newsrooms", funding: "Member fees and content licensing", founded: "1846", medium: "Wire service", factuality: 92, affiliation: -4, reference: true },
  { name: "Agence France-Presse", hosts: ["afp.com"], headquarters: "Paris, France", country: "France", ownership: "Autonomous public corporation", funding: "Media licensing and French state subscriptions", founded: "1835", medium: "Wire service", factuality: 90, affiliation: 0 },
  { name: "BBC News", hosts: ["bbc.com", "bbc.co.uk"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "Public corporation (BBC)", funding: "UK licence fee and commercial arms", founded: "1922", medium: "Public broadcaster", factuality: 85, affiliation: -8, reference: true },
  { name: "NPR", hosts: ["npr.org"], headquarters: "Washington, D.C., United States", country: "United States", ownership: "Nonprofit media organization", funding: "Member-station fees, sponsorship, and grants", founded: "1970", medium: "Public radio", factuality: 84, affiliation: -20, reference: true },
  { name: "PBS NewsHour", hosts: ["pbs.org"], headquarters: "Arlington, Virginia, United States", country: "United States", ownership: "Public broadcaster (WETA/PBS)", funding: "Viewer donations, grants, and corporate sponsorship", founded: "1975", medium: "Public TV", factuality: 86, affiliation: -10 },
  { name: "The New York Times", hosts: ["nytimes.com"], headquarters: "New York City, United States", country: "United States", ownership: "The New York Times Company (public, Sulzberger family control)", funding: "Subscriptions and advertising", founded: "1851", medium: "Newspaper", factuality: 82, affiliation: -25, reference: true },
  { name: "The Washington Post", hosts: ["washingtonpost.com"], headquarters: "Washington, D.C., United States", country: "United States", ownership: "Nash Holdings (Jeff Bezos)", funding: "Subscriptions and advertising", founded: "1877", medium: "Newspaper", factuality: 80, affiliation: -24, reference: true },
  { name: "The Wall Street Journal", hosts: ["wsj.com"], headquarters: "New York City, United States", country: "United States", ownership: "News Corp (Murdoch family control)", funding: "Subscriptions and advertising", founded: "1889", medium: "Newspaper", factuality: 85, affiliation: 12, note: "News reporting rates near center; the opinion section is assessed as distinctly right-leaning.", reference: true },
  { name: "The Guardian", hosts: ["theguardian.com"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "Guardian Media Group (Scott Trust)", funding: "Reader contributions, subscriptions, and advertising", founded: "1821", medium: "Newspaper", factuality: 78, affiliation: -30, reference: true },
  { name: "Financial Times", hosts: ["ft.com"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "Nikkei Inc.", funding: "Subscriptions and advertising", founded: "1888", medium: "Newspaper", factuality: 86, affiliation: 4 },
  { name: "The Economist", hosts: ["economist.com"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "The Economist Group (private)", funding: "Subscriptions and advertising", founded: "1843", medium: "Magazine", factuality: 84, affiliation: 5, reference: true },
  { name: "Bloomberg", hosts: ["bloomberg.com"], headquarters: "New York City, United States", country: "United States", ownership: "Bloomberg L.P. (private, Michael Bloomberg)", funding: "Terminal subscriptions, media subscriptions, and advertising", founded: "1990", medium: "Financial news service", factuality: 85, affiliation: -6 },
  { name: "Axios", hosts: ["axios.com"], headquarters: "Arlington, Virginia, United States", country: "United States", ownership: "Cox Enterprises", funding: "Advertising, sponsored newsletters, and subscriptions", founded: "2016", medium: "Digital", factuality: 80, affiliation: -8 },
  { name: "Politico", hosts: ["politico.com", "politico.eu"], headquarters: "Arlington, Virginia, United States", country: "United States", ownership: "Axel Springer SE", funding: "Advertising and professional subscriptions", founded: "2007", medium: "Digital and print", factuality: 79, affiliation: -8 },
  { name: "The Hill", hosts: ["thehill.com"], headquarters: "Washington, D.C., United States", country: "United States", ownership: "Nexstar Media Group", funding: "Advertising", founded: "1994", medium: "Digital and print", factuality: 76, affiliation: 0 },
  { name: "USA Today", hosts: ["usatoday.com"], headquarters: "McLean, Virginia, United States", country: "United States", ownership: "Gannett (public company)", funding: "Advertising and subscriptions", founded: "1982", medium: "Newspaper", factuality: 78, affiliation: -10 },
  { name: "ABC News", hosts: ["abcnews.go.com", "abcnews.com"], headquarters: "New York City, United States", country: "United States", ownership: "The Walt Disney Company", funding: "Advertising", founded: "1945", medium: "TV network", factuality: 78, affiliation: -14 },
  { name: "CBS News", hosts: ["cbsnews.com"], headquarters: "New York City, United States", country: "United States", ownership: "Paramount", funding: "Advertising", founded: "1927", medium: "TV network", factuality: 78, affiliation: -14 },
  { name: "NBC News", hosts: ["nbcnews.com"], headquarters: "New York City, United States", country: "United States", ownership: "NBCUniversal (Comcast)", funding: "Advertising", founded: "1940", medium: "TV network", factuality: 78, affiliation: -17 },
  { name: "CNN", hosts: ["cnn.com"], headquarters: "Atlanta, United States", country: "United States", ownership: "Warner Bros. Discovery", funding: "Advertising and carriage fees", founded: "1980", medium: "Cable news", factuality: 72, affiliation: -25, reference: true },
  { name: "CNBC", hosts: ["cnbc.com"], headquarters: "Englewood Cliffs, New Jersey, United States", country: "United States", ownership: "NBCUniversal (Comcast)", funding: "Advertising and carriage fees", founded: "1989", medium: "Cable business news", factuality: 78, affiliation: 0 },
  { name: "MSNBC", hosts: ["msnbc.com"], headquarters: "New York City, United States", country: "United States", ownership: "Versant (spun off from Comcast in 2025)", funding: "Advertising and carriage fees", founded: "1996", medium: "Cable news", factuality: 60, affiliation: -45, reference: true },
  { name: "Fox News", hosts: ["foxnews.com", "foxbusiness.com"], headquarters: "New York City, United States", country: "United States", ownership: "Fox Corporation (Murdoch family control)", funding: "Advertising and carriage fees", founded: "1996", medium: "Cable news", factuality: 55, affiliation: 45, reference: true },
  { name: "New York Post", hosts: ["nypost.com"], headquarters: "New York City, United States", country: "United States", ownership: "News Corp (Murdoch family control)", funding: "Advertising and subscriptions", founded: "1801", medium: "Tabloid newspaper", factuality: 55, affiliation: 35, reference: true },
  { name: "The Daily Wire", hosts: ["dailywire.com"], headquarters: "Nashville, Tennessee, United States", country: "United States", ownership: "Private (co-founded by Ben Shapiro and Jeremy Boreing)", funding: "Subscriptions and advertising", founded: "2015", medium: "Digital", factuality: 50, affiliation: 55, reference: true },
  { name: "Breitbart News", hosts: ["breitbart.com"], headquarters: "Los Angeles, United States", country: "United States", ownership: "Privately held (Mercer family investment)", funding: "Advertising", founded: "2007", medium: "Digital", factuality: 35, affiliation: 65, reference: true },
  { name: "The Federalist", hosts: ["thefederalist.com"], headquarters: "Washington, D.C., United States", country: "United States", ownership: "Private (FDRLST Media)", funding: "Advertising and donations", founded: "2013", medium: "Digital", factuality: 42, affiliation: 60 },
  { name: "Newsmax", hosts: ["newsmax.com"], headquarters: "Boca Raton, Florida, United States", country: "United States", ownership: "Newsmax Media (Christopher Ruddy)", funding: "Advertising and subscriptions", founded: "1998", medium: "Cable and digital", factuality: 40, affiliation: 60, reference: true },
  { name: "One America News", hosts: ["oann.com"], headquarters: "San Diego, United States", country: "United States", ownership: "Herring Networks (private)", funding: "Carriage fees and advertising", founded: "2013", medium: "Cable news", factuality: 30, affiliation: 70 },
  { name: "The Blaze", hosts: ["theblaze.com"], headquarters: "Irving, Texas, United States", country: "United States", ownership: "Blaze Media (private)", funding: "Subscriptions and advertising", founded: "2011", medium: "Digital and streaming", factuality: 45, affiliation: 60 },
  { name: "Washington Examiner", hosts: ["washingtonexaminer.com"], headquarters: "Washington, D.C., United States", country: "United States", ownership: "Clarity Media Group (Philip Anschutz)", funding: "Advertising and subscriptions", founded: "2005", medium: "Digital and magazine", factuality: 58, affiliation: 45 },
  { name: "The Washington Times", hosts: ["washingtontimes.com"], headquarters: "Washington, D.C., United States", country: "United States", ownership: "Operations Holdings (Unification Church affiliation)", funding: "Advertising and subsidy", founded: "1982", medium: "Newspaper", factuality: 55, affiliation: 45 },
  { name: "National Review", hosts: ["nationalreview.com"], headquarters: "New York City, United States", country: "United States", ownership: "National Review Institute (nonprofit)", funding: "Subscriptions, donations, and advertising", founded: "1955", medium: "Magazine", factuality: 62, affiliation: 45, reference: true },
  { name: "Reason", hosts: ["reason.com"], headquarters: "Los Angeles, United States", country: "United States", ownership: "Reason Foundation (nonprofit)", funding: "Donations and subscriptions", founded: "1968", medium: "Magazine and digital", factuality: 68, affiliation: 30, note: "Libertarian outlook: assessed right-of-center on economics while diverging from conservative positions on social and civil-liberties issues." },
  { name: "The Epoch Times", hosts: ["theepochtimes.com"], headquarters: "New York City, United States", country: "United States", ownership: "Epoch Media Group (associated with the Falun Gong movement)", funding: "Subscriptions, advertising, and donations", founded: "2000", medium: "Newspaper and digital", factuality: 35, affiliation: 55, reference: true },
  { name: "HuffPost", hosts: ["huffpost.com", "huffingtonpost.com"], headquarters: "New York City, United States", country: "United States", ownership: "BuzzFeed, Inc.", funding: "Advertising", founded: "2005", medium: "Digital", factuality: 62, affiliation: -40, reference: true },
  { name: "Vox", hosts: ["vox.com"], headquarters: "Washington, D.C., United States", country: "United States", ownership: "Vox Media", funding: "Advertising and reader contributions", founded: "2014", medium: "Digital", factuality: 74, affiliation: -30, reference: true },
  { name: "Slate", hosts: ["slate.com"], headquarters: "New York City, United States", country: "United States", ownership: "The Slate Group (Graham Holdings)", funding: "Advertising and memberships", founded: "1996", medium: "Digital", factuality: 68, affiliation: -35 },
  { name: "The Atlantic", hosts: ["theatlantic.com"], headquarters: "Washington, D.C., United States", country: "United States", ownership: "Emerson Collective (majority, Laurene Powell Jobs)", funding: "Subscriptions and advertising", founded: "1857", medium: "Magazine", factuality: 80, affiliation: -22, reference: true },
  { name: "The New Yorker", hosts: ["newyorker.com"], headquarters: "New York City, United States", country: "United States", ownership: "Condé Nast (Advance Publications)", funding: "Subscriptions and advertising", founded: "1925", medium: "Magazine", factuality: 80, affiliation: -30 },
  { name: "Time", hosts: ["time.com"], headquarters: "New York City, United States", country: "United States", ownership: "Private (Marc and Lynne Benioff)", funding: "Advertising and subscriptions", founded: "1923", medium: "Magazine", factuality: 78, affiliation: -14 },
  { name: "Newsweek", hosts: ["newsweek.com"], headquarters: "New York City, United States", country: "United States", ownership: "Newsweek Publishing (private)", funding: "Advertising and subscriptions", founded: "1933", medium: "Digital and magazine", factuality: 65, affiliation: 4 },
  { name: "Mother Jones", hosts: ["motherjones.com"], headquarters: "San Francisco, United States", country: "United States", ownership: "Foundation for National Progress (nonprofit)", funding: "Reader donations and subscriptions", founded: "1976", medium: "Magazine and digital", factuality: 68, affiliation: -45, reference: true },
  { name: "The Nation", hosts: ["thenation.com"], headquarters: "New York City, United States", country: "United States", ownership: "The Nation Company (private)", funding: "Subscriptions and donations", founded: "1865", medium: "Magazine", factuality: 65, affiliation: -50 },
  { name: "Jacobin", hosts: ["jacobin.com", "jacobinmag.com"], headquarters: "New York City, United States", country: "United States", ownership: "Private (Bhaskar Sunkara)", funding: "Subscriptions and donations", founded: "2010", medium: "Magazine and digital", factuality: 60, affiliation: -65, reference: true },
  { name: "Daily Kos", hosts: ["dailykos.com"], headquarters: "Oakland, California, United States", country: "United States", ownership: "Kos Media (private)", funding: "Advertising and donations", founded: "2002", medium: "Digital community blog", factuality: 45, affiliation: -65 },
  { name: "Salon", hosts: ["salon.com"], headquarters: "New York City, United States", country: "United States", ownership: "Salon Media Group", funding: "Advertising", founded: "1995", medium: "Digital", factuality: 55, affiliation: -50 },
  { name: "The Intercept", hosts: ["theintercept.com"], headquarters: "New York City, United States", country: "United States", ownership: "First Look Institute (nonprofit, founded with Pierre Omidyar funding)", funding: "Donations", founded: "2014", medium: "Digital", factuality: 62, affiliation: -50 },
  { name: "ProPublica", hosts: ["propublica.org"], headquarters: "New York City, United States", country: "United States", ownership: "Nonprofit newsroom", funding: "Philanthropic donations", founded: "2007", medium: "Investigative digital newsroom", factuality: 85, affiliation: -12, reference: true },
  { name: "Business Insider", hosts: ["businessinsider.com"], headquarters: "New York City, United States", country: "United States", ownership: "Axel Springer SE", funding: "Advertising and subscriptions", founded: "2007", medium: "Digital", factuality: 68, affiliation: -15 },
  { name: "Forbes", hosts: ["forbes.com"], headquarters: "Jersey City, New Jersey, United States", country: "United States", ownership: "Integrated Whale Media (majority)", funding: "Advertising and licensing", founded: "1917", medium: "Magazine and digital", factuality: 70, affiliation: 8, note: "Staff reporting rates higher than the large outside-contributor network publishing under the same brand." },
  { name: "Semafor", hosts: ["semafor.com"], headquarters: "New York City, United States", country: "United States", ownership: "Private (Ben Smith and Justin Smith)", funding: "Advertising and events", founded: "2022", medium: "Digital", factuality: 78, affiliation: -5 },
  { name: "NewsNation", hosts: ["newsnationnow.com"], headquarters: "Chicago, United States", country: "United States", ownership: "Nexstar Media Group", funding: "Advertising and carriage fees", founded: "2020", medium: "Cable news", factuality: 72, affiliation: 3 },
  { name: "The Christian Science Monitor", hosts: ["csmonitor.com"], headquarters: "Boston, United States", country: "United States", ownership: "The First Church of Christ, Scientist", funding: "Subscriptions and church endowment", founded: "1908", medium: "Digital and weekly print", factuality: 82, affiliation: 0 },
  { name: "Al Jazeera", hosts: ["aljazeera.com"], headquarters: "Doha, Qatar", country: "Qatar", ownership: "Al Jazeera Media Network (Qatari state-funded)", funding: "Qatari government funding", founded: "1996", medium: "Broadcaster and digital", factuality: 72, affiliation: -15, note: "State-funded: assessments note reliable field reporting alongside limited critical coverage of Qatar and its regional interests." },
  { name: "RT", hosts: ["rt.com"], headquarters: "Moscow, Russia", country: "Russia", ownership: "ANO TV-Novosti (Russian state)", funding: "Russian government funding", founded: "2005", medium: "State broadcaster and digital", factuality: 15, affiliation: 20, note: "Assessed as a Russian state propaganda channel; placement on a left-right axis is less meaningful than its pro-Kremlin orientation." },
  { name: "Xinhua", hosts: ["news.cn", "xinhuanet.com"], headquarters: "Beijing, China", country: "China", ownership: "Chinese state news agency", funding: "Chinese government funding", founded: "1931", medium: "State wire service", factuality: 30, affiliation: 10, note: "Official state agency of the Chinese government; assessments treat its political coverage as state messaging rather than independent journalism." },
  { name: "Deutsche Welle", hosts: ["dw.com"], headquarters: "Bonn, Germany", country: "Germany", ownership: "German public international broadcaster", funding: "German federal tax funding", founded: "1953", medium: "Public broadcaster", factuality: 82, affiliation: -5 },
  { name: "France 24", hosts: ["france24.com"], headquarters: "Issy-les-Moulineaux, France", country: "France", ownership: "France Médias Monde (French public)", funding: "French public funding", founded: "2006", medium: "Public broadcaster", factuality: 80, affiliation: -5 },
  { name: "CBC News", hosts: ["cbc.ca"], headquarters: "Toronto, Canada", country: "Canada", ownership: "Canadian Broadcasting Corporation (public)", funding: "Canadian public funding and advertising", founded: "1936", medium: "Public broadcaster", factuality: 80, affiliation: -12 },
  { name: "The Globe and Mail", hosts: ["theglobeandmail.com"], headquarters: "Toronto, Canada", country: "Canada", ownership: "The Woodbridge Company", funding: "Subscriptions and advertising", founded: "1844", medium: "Newspaper", factuality: 80, affiliation: -4 },
  { name: "The Telegraph", hosts: ["telegraph.co.uk"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "Telegraph Media Group", funding: "Subscriptions and advertising", founded: "1855", medium: "Newspaper", factuality: 70, affiliation: 30 },
  { name: "Daily Mail", hosts: ["dailymail.co.uk"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "DMGT (Rothermere family control)", funding: "Advertising", founded: "1896", medium: "Tabloid newspaper", factuality: 45, affiliation: 35 },
  { name: "The Sun", hosts: ["thesun.co.uk"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "News UK (News Corp)", funding: "Advertising", founded: "1964", medium: "Tabloid newspaper", factuality: 40, affiliation: 30 },
  { name: "The Independent", hosts: ["independent.co.uk", "the-independent.com"], headquarters: "London, United Kingdom", country: "United Kingdom", ownership: "Independent Digital News & Media (Lebedev holding)", funding: "Advertising and subscriptions", founded: "1986", medium: "Digital", factuality: 70, affiliation: -25 },
  { name: "The Hindu", hosts: ["thehindu.com"], headquarters: "Chennai, India", country: "India", ownership: "The Hindu Group (Kasturi & Sons)", funding: "Subscriptions and advertising", founded: "1878", medium: "Newspaper", factuality: 78, affiliation: -10 },
  { name: "South China Morning Post", hosts: ["scmp.com"], headquarters: "Hong Kong", country: "China (Hong Kong SAR)", ownership: "Alibaba Group", funding: "Subscriptions and advertising", founded: "1903", medium: "Newspaper", factuality: 65, affiliation: 5, note: "Assessments note professional reporting with a tilt toward Beijing-friendly framing on mainland-China politics since the Alibaba acquisition." },
  { name: "The Jerusalem Post", hosts: ["jpost.com"], headquarters: "Jerusalem", country: "Israel", ownership: "Jerusalem Post Group (private)", funding: "Advertising and subscriptions", founded: "1932", medium: "Newspaper", factuality: 65, affiliation: 15 },
  { name: "Haaretz", hosts: ["haaretz.com"], headquarters: "Tel Aviv, Israel", country: "Israel", ownership: "Schocken family and minority investors", funding: "Subscriptions and advertising", founded: "1918", medium: "Newspaper", factuality: 72, affiliation: -30 },
  { name: "ABC News (Australia)", hosts: ["abc.net.au"], headquarters: "Sydney, Australia", country: "Australia", ownership: "Australian Broadcasting Corporation (public)", funding: "Australian public funding", founded: "1932", medium: "Public broadcaster", factuality: 82, affiliation: -8 },
  { name: "The Sydney Morning Herald", hosts: ["smh.com.au"], headquarters: "Sydney, Australia", country: "Australia", ownership: "Nine Entertainment", funding: "Subscriptions and advertising", founded: "1831", medium: "Newspaper", factuality: 76, affiliation: -10 }
];

const STRIPPED_SUBDOMAINS = /^(?:www|m|mobile|amp|edition|beta|es|en|es-us|news|live)\./;

export function normalizeOutletHost(urlOrHost: string): string {
  const value = String(urlOrHost || "").trim();
  if (!value) return "";
  let host = value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      host = new URL(value).hostname;
    } catch {
      return "";
    }
  }
  host = host.toLowerCase().replace(/\.$/, "");
  while (STRIPPED_SUBDOMAINS.test(host)) host = host.replace(STRIPPED_SUBDOMAINS, "");
  return host;
}

function matchRecord(host: string): OutletRecord | undefined {
  if (!host) return undefined;
  return OUTLETS.find((record) => record.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)));
}

export function lookupBundledOutlet(urlOrHost: string): OutletProfile | undefined {
  const host = normalizeOutletHost(urlOrHost);
  const record = matchRecord(host);
  if (!record) return undefined;
  return {
    host: record.hosts[0],
    name: record.name,
    origin: "bundled-dataset",
    headquarters: record.headquarters,
    country: record.country,
    ownership: record.ownership,
    funding: record.funding,
    founded: record.founded,
    medium: record.medium,
    placement: {
      factuality: record.factuality,
      affiliation: record.affiliation,
      note: record.note || OUTLET_PLACEMENT_DISCLAIMER
    },
    citations: [],
    generatedAt: new Date().toISOString()
  };
}

export function referenceOutlets(excludeHost = ""): OutletReferencePoint[] {
  const excluded = normalizeOutletHost(excludeHost);
  const excludedRecord = matchRecord(excluded);
  return OUTLETS
    .filter((record) => record.reference && record !== excludedRecord)
    .map((record) => ({
      name: record.name,
      host: record.hosts[0],
      factuality: record.factuality,
      affiliation: record.affiliation
    }));
}

export function factualityLabel(value: number) {
  if (value >= 85) return "Very strong factual record";
  if (value >= 72) return "Strong factual record";
  if (value >= 58) return "Mixed-to-solid factual record";
  if (value >= 42) return "Mixed factual record";
  if (value >= 28) return "Weak factual record";
  return "Very weak factual record";
}

export function affiliationLabel(value: number) {
  if (value <= -55) return "Left";
  if (value <= -30) return "Leans left";
  if (value <= -12) return "Center-left";
  if (value < 12) return "Center";
  if (value < 30) return "Center-right";
  if (value < 55) return "Leans right";
  return "Right";
}

export function clampPlacement(profile: OutletProfile): OutletProfile {
  if (!profile.placement) return profile;
  return {
    ...profile,
    placement: {
      ...profile.placement,
      factuality: Math.min(100, Math.max(0, Math.round(profile.placement.factuality))),
      affiliation: Math.min(100, Math.max(-100, Math.round(profile.placement.affiliation)))
    }
  };
}
