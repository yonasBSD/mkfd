import * as cheerio from "cheerio";
import RSS from "rss";
import CSSTarget from "../models/csstarget.model";
import { CSSTargetFields } from "../models/csstarget.model";
import { RSSFeedOptions, RSSItemOptions } from "../models/rss-feed.model";
import { ApiMapping } from "../models/api-mapping.model";
import {
  processDates,
  processLinks,
  processWords,
  get,
  resolveDrillChain,
} from "./data-handler.utility";
import ApiConfig from "./../models/apiconfig.model";

export async function buildRSS(res: any, feedConfig: any): Promise<string> {
  const apiConfig: ApiConfig = feedConfig.config;
  const article = feedConfig.article as CSSTargetFields;
  const reverse: boolean = feedConfig.reverse || false;
  const strict: boolean = feedConfig.strict || false;
  const advanced: boolean = apiConfig.advanced || false;
  const $ = cheerio.load(res);
  const elements = $(article.iterator.selector).toArray();

  if (article && article.iterator?.selector) {
    var input = await Promise.all(
      elements.map(async (el) => {
        const itemData: RSSItemOptions = {
          title: processWords(
            await extractField($, el, article.title, advanced),
            article.title?.titleCase,
            article.title?.stripHtml
          ),
          description: processWords(
            await extractField($, el, article.description, advanced),
            article.description?.titleCase,
            article.description?.stripHtml
          ),
          url: processLinksAbsolute(
            await extractField($, el, article.link, advanced, false, true),
            article.link?.stripHtml,
            article.link?.isRelative,
            article.link?.baseUrl
          ),
          author: processWords(
            await extractField($, el, article.author, advanced),
            article.author?.titleCase,
            article.author?.stripHtml
          ),
          date: processDates(
            await extractField($, el, article.date, advanced),
            article.date?.stripHtml,
            article.date?.dateFormat
          ),
          enclosure: await processEnclosure($, el, article.enclosure, advanced, article.enclosure?.baseUrl || apiConfig?.baseUrl || feedConfig?.feedUrl || ''),
          content: processWords(
            await extractField($, el, article.content, advanced),
            article.content?.titleCase,
            article.content?.stripHtml
          ),
          content_encoded: processWords(
            await extractField($, el, article.contentEncoded, advanced),
            article.contentEncoded?.titleCase,
            article.contentEncoded?.stripHtml
          ),
          summary: processWords(
            await extractField($, el, article.summary, advanced),
            article.summary?.titleCase,
            article.summary?.stripHtml
          ),
          guid: await extractField($, el, article.guid, advanced),
          categories: (await extractField($, el, article.categories, advanced))?.split(',').map(c => c.trim()).filter(Boolean),
          contributors: (await extractField($, el, article.contributors, advanced))?.split(',').map(c => c.trim()).filter(Boolean),
          lat: parseFloat(await extractField($, el, article.lat, advanced) || '0'),
          long: parseFloat(await extractField($, el, article.long, advanced) || '0'),
        };

        if (article.source) {
          itemData.source = {
            url: await extractField($, el, article.source.url, advanced),
            title: await extractField($, el, article.source.title, advanced)
          };
        }
        if (itemData.guid === undefined || itemData.guid === ''){
          itemData.guid = Bun.hash(JSON.stringify(itemData)).toString();
        }

        return itemData;
      })
    );

    if (strict) {
      input = filterStrictly(input);
    }

    if (reverse) {
      input.reverse();
    }

    const feedOptions: RSSFeedOptions = {
      title: await extractField($, null, article.feedTitle, advanced) || apiConfig?.title || $("title")?.first().text()?.trim() || 'Untitled Feed',
      site_url: apiConfig.baseUrl || '',
      description: await extractField($, null, article.feedDescription, advanced) || $('meta[property="og:description"]').first().attr("content") || $('meta[name="description"]').first().attr("content") || '',
      generator: "Generated by mkfd",
      language: await extractField($, null, article.feedLanguage, advanced) || $('html').first().attr('lang') || undefined,
      copyright: await extractField($, null, article.feedCopyright, advanced),
      managingEditor: await extractField($, null, article.feedManagingEditor, advanced),
      webMaster: await extractField($, null, article.feedWebMaster, advanced),
      categories: (await extractField($, null, article.feedCategories, advanced))?.split(',').map(c => c.trim()).filter(Boolean),
      ttl: parseInt(await extractField($, null, article.feedTtl, advanced) || '60'), // Default to 60 minutes
      rating: await extractField($, null, article.feedRating, advanced),
      skipDays: (await extractField($, null, article.feedSkipDays, advanced))?.split(',').map(d => d.trim()).filter(Boolean),
      skipHours: (await extractField($, null, article.feedSkipHours, advanced))?.split(',').map(h => parseInt(h.trim())).filter(h => !isNaN(h) && h >=0 && h <=23 ),
      pubDate: new Date(),
      lastBuildDate: new Date(),
    };

    if (article.feedImage) {
      const imageUrl = await extractField($, null, article.feedImage.url, advanced);
      if(imageUrl){
        feedOptions.image = {
          url: imageUrl,
          title: await extractField($, null, article.feedImage.title, advanced) || feedOptions.title,
          link: await extractField($, null, article.feedImage.link, advanced) || feedOptions.site_url,
          width: parseInt(await extractField($, null, article.feedImage.width, advanced) || '0'),
          height: parseInt(await extractField($, null, article.feedImage.height, advanced) || '0'),
          description: await extractField($, null, article.feedImage.description, advanced)
        };
      }
    }

    const feed = new RSS(feedOptions);

    for (const item of input) {
      feed.item(item);
    }

    return feed.xml({ indent: true });
  }
  // Fallback if article or iterator is not defined
  return new RSS({ title: apiConfig?.title || 'Error: Feed not configured correctly', site_url: apiConfig.baseUrl || '' }).xml({ indent: true });
}

export function buildRSSFromApiData(apiData: any, feedConfig: any): string {
  const mapping = feedConfig.apiMapping as ApiMapping;
  const config = feedConfig.config as ApiConfig;

  const feedOptions: RSSFeedOptions = {
    title: get(apiData, mapping.feedTitle, "") || config.title || "API RSS Feed",
    site_url: config.baseUrl || '',
    feed_url: config.baseUrl + (config.route || ""),
    description: get(apiData, mapping.feedDescription, "RSS feed generated from API data"),
    generator: "Generated by mkfd",
    language: get(apiData, mapping.feedLanguage, ""),
    copyright: get(apiData, mapping.feedCopyright, ""),
    managingEditor: get(apiData, mapping.feedManagingEditor, ""),
    webMaster: get(apiData, mapping.feedWebMaster, ""),
    categories: get(apiData, mapping.feedCategories, "").split(',').filter(Boolean).map((c: string) => c.trim()),
    ttl: parseInt(get(apiData, mapping.feedTtl, "60") || '60'),
    rating: get(apiData, mapping.feedRating, ""),
    skipDays: get(apiData, mapping.feedSkipDays, "").split(',').filter(Boolean).map((d: string) => d.trim()),
    skipHours: get(apiData, mapping.feedSkipHours, "").split(',').filter(Boolean).map((h: string) => parseInt(h.trim())).filter((h: number) => !isNaN(h) && h >=0 && h <=23),
    pubDate: new Date(get(apiData, mapping.feedPubDate, "") || Date.now()),
    lastBuildDate: new Date(get(apiData, mapping.feedLastBuildDate, "") || Date.now())
  };

  if (mapping.feedImage && get(apiData, mapping.feedImage.url, "")) {
    feedOptions.image = {
      url: get(apiData, mapping.feedImage.url, ""),
      title: get(apiData, mapping.feedImage.title, "") || feedOptions.title,
      link: get(apiData, mapping.feedImage.link, "") || feedOptions.site_url,
      width: parseInt(get(apiData, mapping.feedImage.width, "0") || '0'),
      height: parseInt(get(apiData, mapping.feedImage.height, "0") || '0'),
      description: get(apiData, mapping.feedImage.description, "")
    };
  }

  const feed = new RSS(feedOptions);

  const itemsPath = mapping.items || "";
  var items = get(apiData, itemsPath, []);

  if (feedConfig.strict) {
    items = filterStrictly(items);
  }

  if (feedConfig.reverse) {
    items.reverse();
  }

  items.forEach((item: any) => {
    const itemData: RSSItemOptions = {
      title: get(item, mapping.title, ""),
      description: get(item, mapping.description, ""),
      url: get(item, mapping.link, ""),
      author: get(item, mapping.author, ""),
      date: get(item, mapping.date, "") || new Date(),
      content: get(item, mapping.content, ""),
      content_encoded: get(item, mapping.contentEncoded, ""),
      summary: get(item, mapping.summary, ""),
      guid: get(item, mapping.guid, undefined),
      guid_isPermaLink: mapping.guidIsPermaLink ? get(item, mapping.guidIsPermaLink, "false").toLowerCase() === "true" : undefined,
      categories: get(item, mapping.categories, "").split(',').filter(Boolean).map((c:string) => c.trim()),
      contributors: get(item, mapping.contributors, "").split(',').filter(Boolean).map((c:string) => c.trim()),
      lat: parseFloat(get(item, mapping.lat, "0") || '0'),
      long: parseFloat(get(item, mapping.long, "0") || '0'),
    };
    if (itemData.guid === undefined || itemData.guid === ''){
      itemData.guid = Bun.hash(JSON.stringify(itemData)).toString();
    }

    if (mapping.enclosure && get(item, mapping.enclosure.url, "")) {
      itemData.enclosure = {
        url: get(item, mapping.enclosure.url, ""),
        size: parseInt(get(item, mapping.enclosure.size, "0") || '0'),
        type: get(item, mapping.enclosure.type, "application/octet-stream")
      };
    }

    if (mapping.source) {
      itemData.source = {
        url: get(item, mapping.source.url, ""),
        title: get(item, mapping.source.title, "")
      };
    }

    if (mapping.customElements) {
      itemData.custom_elements = Object.entries(mapping.customElements).map(([key, path]) => ({
        [key]: get(item, path, "")
      }));
    }

    feed.item(itemData);
  });

  return feed.xml({ indent: true });
}

async function processEnclosure(
  $: cheerio.Root,
  el: cheerio.Element | null,
  enclosureTarget: CSSTarget | undefined,
  advanced: boolean,
  baseUrl: string
): Promise<RSSItemOptions['enclosure'] | undefined> {
  if (!enclosureTarget || !el) return undefined;

  const rawUrl = await extractField($, el, enclosureTarget, advanced, true, false);
  let isEnclosureRelative = enclosureTarget.isRelative;
  let enclosureBaseUrl = enclosureTarget.baseUrl;
  if (isEnclosureRelative === undefined && !enclosureBaseUrl) {
    isEnclosureRelative = rawUrl && isRelativeUrl(rawUrl);
    enclosureBaseUrl = isEnclosureRelative ? extractRootUrl(baseUrl) : undefined;
  }
  const url = processLinksAbsolute(
    rawUrl,
    enclosureTarget.stripHtml,
    isEnclosureRelative,
    enclosureBaseUrl
  );

  if (!url) return undefined;

  const enclosure: RSSItemOptions['enclosure'] = {
    url: url.startsWith("//") ? "http:" + url : url,
    size: 0,
    type: "application/octet-stream"
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    const response = await fetch(enclosure.url, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > 2 * 1024 * 1024) {
        console.warn('Enclosure too large, skipping:', enclosure.url);
        return undefined;
      }
      const contentType = response.headers.get("content-type");
      enclosure.size = parseInt(contentLength || "0");
      enclosure.type = contentType || "application/octet-stream";
    }
  } catch (err) {
    console.error("Failed to fetch enclosure:", enclosure.url, err);
  }

  return enclosure;
}

function getNonNullProps(item: any): Set<string> {
  const nonNull = new Set<string>();
  for (const [key, val] of Object.entries(item)) {
    if (key === "enclosure") {
      const eUrl = (val as any)?.url;
      if (eUrl !== null && eUrl !== undefined && eUrl !== "") {
        nonNull.add("enclosure");
      }
    } else if (val !== null && val !== undefined && val !== "") {
      nonNull.add(key);
    }
  }
  return nonNull;
}

function filterStrictly(items: any[]): any[] {
  if (!items || items.length === 0) return [];
  const itemPropsSets = items.map((item) => getNonNullProps(item));
  if (itemPropsSets.length === 0) return [];

  const maxSize = Math.max(...itemPropsSets.map((s) => s.size), 0);
  if (maxSize === 0 && items.length > 0) return items; // All items are empty, return them all
  
  const topIndices = itemPropsSets
    .map((propsSet, i) => (propsSet.size === maxSize ? i : -1))
    .filter((i) => i !== -1);
  
  if (topIndices.length === 0) return []; // No items have the max number of properties

  let intersect: Set<string> = new Set(itemPropsSets[topIndices[0]] ?? []);
  for (let i = 1; i < topIndices.length; i++) {
    const s = itemPropsSets[topIndices[i]];
    const temp = new Set<string>();
    intersect.forEach(prop => {
      if (s.has(prop)) {
        temp.add(prop);
      }
    });
    intersect = temp;
  }
  const requiredProps = intersect;
  if (requiredProps.size === 0 && items.length > 0 && maxSize > 0) {
    // If intersection is empty but there were items with properties, it implies no common ground at the max level.
    // This state might be undesired. Depending on strictness, could return items with maxSize or empty.
    // For now, let's return items that have the maxSize of properties.
    return items.filter((_,idx) => itemPropsSets[idx].size === maxSize);
  }

  return items.filter((_, idx) => {
    const itemSet = itemPropsSets[idx];
    for (const prop of requiredProps) {
      if (!itemSet.has(prop)) {
        return false;
      }
    }
    return true;
  });
}

async function extractField(
  $: cheerio.Root,
  el: cheerio.Element | null, 
  field: CSSTarget | undefined, 
  advanced: boolean = false,
  forEnclosure: boolean = false,
  forLink: boolean = false
): Promise<string> {
  if (!field || !field.selector) return ""; 
  const context = el ? $(el) : $;

  if (field.drillChain?.length) {
    const startHtml = el ? $.html(el) : $.html(); 
    const mappedDrillChain = field.drillChain.map(step => ({
      selector: step.selector,
      attribute: step.attribute || "",
      isRelative: step.isRelative === undefined ? false : step.isRelative,
      baseUrl: step.baseUrl || "",
      stripHtml: step.stripHtml === undefined ? false : step.stripHtml,
    }));
    return await resolveDrillChain(startHtml, mappedDrillChain, advanced, forLink || forEnclosure);
  }

  const target: cheerio.Cheerio = el ? (context as cheerio.Cheerio).find(field.selector) : $(field.selector);

  if (field.attribute) {
    const rawAttr = target.first().attr(field.attribute);
    if (rawAttr) return rawAttr.trim();
  }

  let rawText = field.stripHtml ? target.first().text() : target.first().html();
  rawText = rawText?.trim() || "";

  if (/^https?:\/\//i.test(rawText)) {
    return rawText;
  }

  if (!forEnclosure && !forLink) {
    return rawText;
  }
  
  // For links and enclosures, try to find a URL more explicitly if rawText isn't one
  if (forLink || forEnclosure) {
    const foundUrl = discoverUrl($, target.first() as cheerio.Cheerio);
    if (foundUrl) return foundUrl.trim();
  }

  return rawText; // Return rawText if no specific URL found for link/enclosure, or if it's a non-URL field
}

export function looksLikeUrl(str: string): boolean {
  if (!str) return false;
  return /^https?:\/\//i.test(str) || str.startsWith("//");
}

export function discoverUrl($: cheerio.Root, target: cheerio.Cheerio): string {
  if (!target.length) return ""; 
  
  let urlToTest;

  // 1. Direct attributes (most reliable for explicit links/media)
  urlToTest = target.attr("href") || target.attr("src");
  if (urlToTest && looksLikeUrl(urlToTest)) return decodeURIComponent(urlToTest.split(/[,\s]+/)[0].trim());

  urlToTest = target.attr("data-src");
  if (urlToTest && looksLikeUrl(urlToTest)) return decodeURIComponent(urlToTest.split(/[,\s]+/)[0].trim());

  urlToTest = target.attr("srcset");
  if (urlToTest && looksLikeUrl(urlToTest.split(/[,\s]+/)[0])) return decodeURIComponent(urlToTest.split(/[,\s]+/)[0].trim());

  // 2. Schema.org / LD+JSON
  const ldScript = target.find('script[type="application/ld+json"]').first().html();
  if (ldScript) {
    try {
      const data = JSON.parse(ldScript);
      urlToTest = data?.contentUrl || data?.thumbnailUrl || (Array.isArray(data?.image) ? data.image[0]?.url || data.image[0] : data?.image?.url || data?.image);
      if (urlToTest && looksLikeUrl(urlToTest) && looksLikeMedia(urlToTest)) return decodeURIComponent(urlToTest.trim());
    } catch { /* ignore bad JSON */ }
  }

  // 3. OpenGraph meta tags (usually in <head>, but let's check if target is <html> or <body>)
  let searchContext: cheerio.Cheerio = target;
  if(target.is('html') || target.is('body')){
    searchContext = $.root(); // search globally using root
  }
  urlToTest = searchContext.find('meta[property="og:image"]').attr('content') || searchContext.find('meta[property="og:video"]').attr('content') || searchContext.find('meta[property="og:audio"]').attr('content');
  if (urlToTest && looksLikeUrl(urlToTest) && looksLikeMedia(urlToTest)) return decodeURIComponent(urlToTest.trim());

  // 4. Inline style background-image
  const inlineStyle = target.attr("style");
  if (inlineStyle) {
    const styleMatch = inlineStyle.match(/background(?:-image)?:\s*url\(['"]?(.*?)['"]?\)/i);
    if (styleMatch?.[1] && looksLikeUrl(styleMatch[1]) && looksLikeMedia(styleMatch[1])) return decodeURIComponent(styleMatch[1].trim());
  }

  // 5. Nested <img>, <video>, <audio> src attributes
  const nestedMedia = target.find("img, video, audio");
  for (let i = 0; i < nestedMedia.length; i++) {
    urlToTest = $(nestedMedia[i]).attr("src");
    if (urlToTest && looksLikeUrl(urlToTest) && looksLikeMedia(urlToTest)) return decodeURIComponent(urlToTest.trim());
  }
  
  // 6. Nested <a> href for links
  const nestedLink = target.find("a");
   for (let i = 0; i < nestedLink.length; i++) {
    urlToTest = $(nestedLink[i]).attr("href");
    if (urlToTest && looksLikeUrl(urlToTest)) return decodeURIComponent(urlToTest.trim());
  }

  // 7. Fallback: Any plausible URL in outerHTML (less reliable)
  const html = $.html(target);
  if (html) {
    urlToTest = nextUsefulAbs(html);
    if (urlToTest && looksLikeMedia(urlToTest)) return decodeURIComponent(urlToTest.trim()); // Prioritize media-like URLs from HTML
    if (urlToTest) return decodeURIComponent(urlToTest.trim()); // Or any URL if that's all
  }
  
  return "";
}

const ABS_URL_RE = /https?:\/\/[^\s"'<>]+/ig;
const BORING   = /^https?:\/\/(?:schema\.org|www\.w3\.org)\b/i;

function nextUsefulAbs(html: string): string {
  let m: RegExpExecArray | null;
  ABS_URL_RE.lastIndex = 0; // Reset regex state
  while ((m = ABS_URL_RE.exec(html))) {
    const u = decodeURIComponent(m[0].trim());
    if (!BORING.test(u)) return u; // Return first non-boring absolute URL
  }
  return "";
}

function looksLikeMedia(url: string): boolean {
  if(!url) return false;
  return /\.(jpeg|jpg|png|gif|webp|bmp|svg|mp4|m4v|mov|webm|m3u8|mp3|aac|ogg|wav)(\?|$)/i
    .test(url.split('?')[0]);
}

// Add a simple HTML tag stripper if not present
function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

// Updated function to avoid import conflict
export function processLinksAbsolute(
  value: string,
  stripHtml: boolean,
  isRelative?: boolean,
  baseUrl?: string
): string {
  let url = value?.trim() || "";
  if (stripHtml && url) {
    url = stripHtmlTags(url);
  }
  if (isRelative && url && !/^https?:\/\//i.test(url) && baseUrl) {
    url = baseUrl.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
  }
  return url;
}

function isRelativeUrl(url: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url) || url.startsWith("//");
}

function extractRootUrl(baseUrl: string): string | undefined {
  if (!baseUrl) return undefined;
  const parts = baseUrl.split('/');
  return parts[0] + '/' + parts[1] + '/' + parts[2];
}