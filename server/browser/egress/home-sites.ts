// The sites that turn away connections from data centres. While the person lends their computer's internet connection,
// a bot's browser on My Cloud opens only these through it; every other site loads straight from My Cloud, which is much
// faster than a round trip through a home connection (with a Frankfurt Cloud and a Mac on a home connection in India,
// pages took 1.7 to 30 times as long through the Mac). The list lives on My Cloud alone, so a new site needs only a
// Cloud update.

/** Each name covers its subdomains too. */
export const HOME_SITES = [
  // Instagram answers a data centre with 429, from its login page on.
  "instagram.com", "instagr.am",
  // YouTube asks a data centre to "sign in to confirm you're not a bot". Its videos play only for the address that asked
  // for them (googlevideo.com), and its player's own check (jnn-pa.googleapis.com) is asked from the same place.
  "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com", "jnn-pa.googleapis.com",
  // Google refuses to sign in a browser in a data centre, and answers its searches with "unusual traffic": all of
  // google.com, so a Google account signed in from home keeps being used from home.
  "google.com",
] as const;

/** Google in each country, as sign-in and search reach it: google.de, google.co.in, google.com.br. */
const GOOGLE_COUNTRY = /(?:^|\.)google\.(?:co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/u;

/** Whether `name`, as a SOCKS request carries it, is one of the sites the person's own connection opens. */
export function opensFromHome(name: string): boolean {
  const host = name.trim().toLowerCase().replace(/\.+$/u, "");
  return HOME_SITES.some((site) => host === site || host.endsWith(`.${site}`)) || GOOGLE_COUNTRY.test(host);
}

/** Nordus: num servidor próprio com a internet de casa ligada, estes saem pela casa da pessoa (redes sociais, Google e
 * os domínios de imagem e vídeo de cada uma, para a página e a mídia virem do mesmo endereço). Editável em
 * `browserEngine.egress.home.sites`. */
export const NORDUS_HOME_SITES: readonly string[] = [
  "instagram.com", "instagr.am", "cdninstagram.com",
  "facebook.com", "fb.com", "fbcdn.net", "fbsbx.com", "messenger.com", "meta.com", "threads.net", "threads.com",
  "google.com", "gstatic.com", "googleusercontent.com", "googleapis.com", "youtube.com", "youtu.be", "youtube-nocookie.com",
  "googlevideo.com", "ytimg.com", "ggpht.com",
  "tiktok.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "ttwstatic.com", "byteoversea.com", "ibytedtos.com",
  "x.com", "twitter.com", "twimg.com", "t.co",
  "linkedin.com", "licdn.com", "lnkd.in",
];

const SITE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

/** Um nome da lista, já limpo: "https://www.Instagram.com/" vira "instagram.com"; o que não é domínio fica de fora. */
export function cleanHomeSite(entry: string): string | null {
  const host = entry.trim().toLowerCase().replace(/^[a-z]+:\/\//u, "").replace(/[/?#].*$/u, "").replace(/^\*\./u, "").replace(/^www\./u, "").replace(/\.+$/u, "");
  return SITE.test(host) ? host : null;
}

/** Quem sai pela casa: os nomes da lista (com seus subdomínios) e, com a lista padrão, o Google de cada país. */
export function homeSiteMatcher(sites: readonly string[] | undefined): (name: string) => boolean {
  const list = (sites ?? NORDUS_HOME_SITES).flatMap((site) => cleanHomeSite(site) ?? []);
  const countryGoogle = list.includes("google.com");
  return (name) => {
    const host = name.trim().toLowerCase().replace(/\.+$/u, "");
    return list.some((site) => host === site || host.endsWith(`.${site}`)) || (countryGoogle && GOOGLE_COUNTRY.test(host));
  };
}

/** Os domínios de cada serviço entram juntos: o login em instagram.com vale também para cdninstagram.com. */
const FAMILIES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["instagram.com", ["instagram.com", "instagr.am", "cdninstagram.com"]],
  ["facebook.com", ["facebook.com", "fb.com", "fbcdn.net", "fbsbx.com", "messenger.com", "meta.com", "threads.net", "threads.com"]],
  ["google.com", ["google.com", "gstatic.com", "googleusercontent.com", "googleapis.com", "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com", "ytimg.com", "ggpht.com"]],
  ["tiktok.com", ["tiktok.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "ttwstatic.com", "byteoversea.com", "ibytedtos.com"]],
  ["x.com", ["x.com", "twitter.com", "twimg.com", "t.co"]],
  ["linkedin.com", ["linkedin.com", "licdn.com", "lnkd.in"]],
];

/** O serviço a que `name` pertence, para guardar por robô e serviço de qual saída ele já usou: "www.instagram.com" e
 * "scontent.cdninstagram.com" dão "instagram.com"; um site fora dos grupos dá os dois últimos nomes (três em "com.br"). */
export function siteFamily(name: string): string {
  const host = name.trim().toLowerCase().replace(/\.+$/u, "");
  for (const [family, members] of FAMILIES) {
    if (members.some((member) => host === member || host.endsWith(`.${member}`))) return family;
  }
  if (GOOGLE_COUNTRY.test(host)) return "google.com";
  const labels = host.split(".");
  const second = labels[labels.length - 2];
  const cut = labels.length >= 3 && labels[labels.length - 1]!.length === 2 && second !== undefined && ["co", "com", "org", "net", "gov"].includes(second) ? 3 : 2;
  return labels.slice(-cut).join(".");
}

/** Com a internet de casa ligada, uma página de login de um site de casa aberta no navegador embutido é onde a pessoa
 * entra: o cartão abre ali ("browser"), não no computador do robô. Sem a internet de casa, `place` fica como veio. */
export function signInPlaceWithHome<P extends string>(
  place: P | null,
  home: { on: boolean; browserOn: boolean; sites?: readonly string[]; cardSite: string; pageHost: string | null },
): P | "browser" | null {
  if (!home.on || !home.browserOn || !home.pageHost || place === "browser") return place;
  if (!homeSiteMatcher(home.sites)(home.cardSite) || !homeSiteMatcher(home.sites)(home.pageHost)) return place;
  return siteFamily(home.pageHost) === siteFamily(home.cardSite) ? "browser" : place;
}
