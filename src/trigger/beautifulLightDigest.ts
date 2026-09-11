import { schedules } from "@trigger.dev/sdk";
import { XMLParser } from "fast-xml-parser";

const STEAM_URL = "https://store.steampowered.com/feeds/news/app/1313230/";
const YOUTUBE_URL =
  "https://www.youtube.com/feeds/videos.xml?channel_id=UC4BixatjNgR30tLJkCGb-Wg";
const GITHUB_REPO = "Malyssz/Test-rules-of-engagement";
const STATE_PATH = "state.json";
const NTFY_MESSAGE_LIMIT = 3800;

type Entry = { id: string; title: string; link: string; published: string };
type FeedResult =
  | { status: "ok"; newItems: Entry[]; allIds: string[] }
  | { status: "error"; error: string; newItems: Entry[] };
type State = {
  steam: { seen_ids: string[] };
  youtube: { seen_ids: string[] };
  last_run: string | null;
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "beautiful-light-news-tracker/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseSteamRss(xml: string): Entry[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .map((item: any): Entry => ({
      id: String(item.guid?.["#text"] ?? item.guid ?? item.link ?? ""),
      title: String(item.title ?? ""),
      link: String(item.link ?? ""),
      published: String(item.pubDate ?? ""),
    }))
    .filter((e) => e.id && e.title);
}

function parseYoutubeAtom(xml: string): Entry[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);
  const raw = doc?.feed?.entry;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return entries
    .map((entry: any): Entry => {
      const linkObj = Array.isArray(entry.link) ? entry.link[0] : entry.link;
      return {
        id: String(entry.id ?? ""),
        title: String(entry.title ?? ""),
        link: String(linkObj?.["@_href"] ?? ""),
        published: String(entry.published ?? ""),
      };
    })
    .filter((e) => e.id && e.title);
}

function filterNew(entries: Entry[], seenIds: string[]): Entry[] {
  const seen = new Set(seenIds);
  return entries.filter((e) => !seen.has(e.id));
}

async function fetchFeed(url: string, parse: (xml: string) => Entry[], seenIds: string[]): Promise<FeedResult> {
  try {
    const xml = await fetchText(url);
    const entries = parse(xml);
    return { status: "ok", newItems: filterNew(entries, seenIds), allIds: entries.map((e) => e.id) };
  } catch (err) {
    return { status: "error", error: String(err), newItems: [] };
  }
}

async function githubGetState(token: string): Promise<{ state: State | null; sha: string | null }> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${STATE_PATH}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return { state: null, sha: null };
  if (!res.ok) throw new Error(`GitHub GET state.json failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content: string; sha: string };
  const state = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8")) as State;
  return { state, sha: data.sha };
}

async function githubPutState(state: State, sha: string | null, token: string, message: string): Promise<void> {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(state, null, 2)).toString("base64"),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${STATE_PATH}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT state.json failed: ${res.status} ${await res.text()}`);
}

function buildDigest(dateStr: string, isFirstRun: boolean, steam: FeedResult, youtube: FeedResult): string {
  const lines: string[] = [`# Beautiful Light — Cotygodniowy digest (${dateStr})`, ""];

  if (isFirstRun) {
    lines.push(
      "_To pierwsze uruchomienie (baseline) — poniższe wpisy to bieżący stan feedów, nie ścisłe nowości._",
      ""
    );
  }

  const totalNew = steam.newItems.length + youtube.newItems.length;
  lines.push("## TL;DR");
  if (steam.status === "error" && youtube.status === "error") {
    lines.push(`Oba źródła były niedostępne w tym uruchomieniu.`);
  } else if (totalNew === 0) {
    lines.push("Brak nowych informacji w tym tygodniu.");
  } else {
    lines.push(`Znaleziono ${totalNew} nowych wpisów — sprawdź sekcje poniżej pod kątem daty bety/premiery.`);
  }
  lines.push("");

  lines.push("## Steam News");
  if (steam.status === "error") {
    lines.push(`Steam feed niedostępny w tym uruchomieniu: ${steam.error}`);
  } else if (steam.newItems.length === 0) {
    lines.push("Brak nowych wpisów.");
  } else {
    for (const item of steam.newItems) lines.push(`- [${item.title}](${item.link}) — ${item.published}`);
  }
  lines.push("");

  lines.push("## YouTube");
  if (youtube.status === "error") {
    lines.push(`YouTube feed niedostępny w tym uruchomieniu: ${youtube.error}`);
  } else if (youtube.newItems.length === 0) {
    lines.push("Brak nowych wpisów.");
  } else {
    for (const item of youtube.newItems) lines.push(`- [${item.title}](${item.link}) — ${item.published}`);
  }
  lines.push("", "---", "Źródła: Steam News RSS, YouTube RSS (Deep Worlds).");

  return lines.join("\n");
}

async function sendNtfy(topic: string, title: string, message: string): Promise<void> {
  // JSON publish endpoint (not header-based) so non-ASCII title/message (Polish
  // diacritics) don't hit the ByteString restriction on raw HTTP header values.
  const res = await fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      topic,
      title,
      message: message.slice(0, NTFY_MESSAGE_LIMIT),
    }),
  });
  if (!res.ok) throw new Error(`ntfy publish failed: ${res.status} ${await res.text()}`);
}

export const beautifulLightWeeklyDigest = schedules.task({
  id: "beautiful-light-weekly-digest",
  cron: "0 20 * * 3", // Wednesday 20:00 UTC = 22:00 Europe/Warsaw (CEST)
  run: async () => {
    const token = process.env.GITHUB_TOKEN;
    const ntfyTopic = process.env.NTFY_TOPIC;
    if (!token) throw new Error("Missing GITHUB_TOKEN env var");
    if (!ntfyTopic) throw new Error("Missing NTFY_TOPIC env var");

    const { state: existingState, sha } = await githubGetState(token);
    const isFirstRun = existingState === null;
    const state: State = existingState ?? { steam: { seen_ids: [] }, youtube: { seen_ids: [] }, last_run: null };

    const [steamResult, youtubeResult] = await Promise.all([
      fetchFeed(STEAM_URL, parseSteamRss, state.steam.seen_ids),
      fetchFeed(YOUTUBE_URL, parseYoutubeAtom, state.youtube.seen_ids),
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    const digest = buildDigest(dateStr, isFirstRun, steamResult, youtubeResult);

    if (steamResult.status === "ok") state.steam.seen_ids = steamResult.allIds;
    if (youtubeResult.status === "ok") state.youtube.seen_ids = youtubeResult.allIds;
    state.last_run = new Date().toISOString();

    await githubPutState(state, sha, token, `Update news tracker state ${dateStr}`);

    const totalNew = steamResult.newItems.length + youtubeResult.newItems.length;
    const title = totalNew > 0 ? `Beautiful Light: ${totalNew} nowych newsów!` : "Beautiful Light: brak nowości";
    await sendNtfy(ntfyTopic, title, digest);

    return {
      totalNew,
      isFirstRun,
      steamStatus: steamResult.status,
      youtubeStatus: youtubeResult.status,
    };
  },
});
