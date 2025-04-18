import * as cheerio from "cheerio";
import RSS from "rss";
import CSSTarget from "../models/csstarget.model";
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
  const article = feedConfig.article as {
    iterator: CSSTarget;
    title?: CSSTarget;
    description?: CSSTarget;
    author?: CSSTarget;
    link?: CSSTarget;
    date?: CSSTarget;
    enclosure?: CSSTarget;
  };
  const reverse: boolean = feedConfig.reverse || false;
  const strict: boolean = feedConfig.strict || false;
  const advanced: boolean = apiConfig.advanced || false;
  const $ = cheerio.load(res);
  const elements = $(article.iterator.selector).toArray();

  if (article) {
    var input = await Promise.all(
      elements.map(async (el, i) => {
        const itemData = {
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
          url: processLinks(
            await extractField($, el, article.link, advanced, false, true),
            article.link?.stripHtml,
            article.link?.relativeLink,
            article.link?.rootUrl
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
          enclosure: {
            url: processLinks(
              await extractField($, el, article.enclosure, advanced, true),
              article.enclosure?.stripHtml,
              article.enclosure?.relativeLink,
              article.enclosure?.rootUrl
            ),
            size: 0,
            type: "application/octet-stream",
          },
        };
        if (itemData.enclosure.url) {
           if (itemData.enclosure.url.startsWith("//")) {
               itemData.enclosure.url = "http:" + itemData.enclosure.url;
             }
          try {
            const url = itemData.enclosure.url;
            const response = await fetch(url);
            if (response.ok) {
              const contentLength = response.headers.get("content-length");
              const contentType = response.headers.get("content-type");
              itemData.enclosure["size"] = parseInt(contentLength) || 0;
              itemData.enclosure["type"] =
                contentType || "application/octet-stream";
            }
          } catch (err) {
            console.error(
              "Failed to fetch enclosure:",
              itemData.enclosure.url,
              err
            );
          }
        }

        return itemData; // This is the resolved value of the Promise
      })
    );

    if (strict) {
      input = filterStrictly(input);
    }

    if (reverse) {
      input.reverse();
    }

    const feed = new RSS({
      title: apiConfig?.title || $("title")?.text(),
      description: $('meta[property="twitter:description"]')?.attr("content"),
      author: "mkfd",
      site_url: apiConfig.baseUrl,
      generator: "Generated by mkfd",
    });

    for (const item of input) {
      feed.item({
        title: item.title,
        description: item.description,
        url: item.url,
        guid: Bun.hash(JSON.stringify(item)),
        author: item.author,
        date: item.date,
        enclosure: {
          url: item.enclosure.url,
          size: item.enclosure.size,
          type: item.enclosure.type,
        },
      });
    }

    return feed.xml({ indent: true });
  }
}

export function buildRSSFromApiData(apiData, feedConfig) {
  const feed = new RSS({
    title: feedConfig.config.title || "API RSS Feed",
    description: "RSS feed generated from API data",
    feed_url: feedConfig.config.baseUrl + (feedConfig.config.route || ""),
    site_url: feedConfig.config.baseUrl,
    pubDate: new Date(),
  });

  const itemsPath = feedConfig.apiMapping.items || "";
  var items = get(apiData, itemsPath, []);

  if (feedConfig.strict) {
    items = filterStrictly(items);
  }

  if (feedConfig.reverse) {
    items.reverse();
  }

  items.forEach((item) => {
    feed.item({
      title: get(item, feedConfig.apiMapping.title, ""),
      description: get(item, feedConfig.apiMapping.description, ""),
      url: get(item, feedConfig.apiMapping.link, ""),
      guid: Bun.hash(JSON.stringify(item)),
      date: get(item, feedConfig.apiMapping.date, "") || new Date(),
    });
  });

  return feed.xml({ indent: true });
}

function getNonNullProps(item: any): Set<string> {
  const nonNull = new Set<string>();

  for (const [key, val] of Object.entries(item)) {
    if (key === "enclosure") {
      const eUrl = (val as any)?.url;
      if (eUrl !== null && eUrl !== undefined && eUrl !== "") {
        nonNull.add("enclosure");
      }
    } else {
      if (val !== null && val !== undefined && val !== "") {
        nonNull.add(key);
      }
    }
  }

  return nonNull;
}
function filterStrictly(items: any[]): any[] {
  const itemPropsSets = items.map((item) => getNonNullProps(item));
  const maxSize = Math.max(...itemPropsSets.map((s) => s.size), 0);
  const topIndices = itemPropsSets
    .map((propsSet, i) => (propsSet.size === maxSize ? i : -1))
    .filter((i) => i !== -1);
  let intersect: Set<string> = new Set(itemPropsSets[topIndices[0]] ?? []);
  for (let i = 1; i < topIndices.length; i++) {
    const s = itemPropsSets[topIndices[i]];
    const temp = new Set<string>();
    for (const prop of intersect) {
      if (s.has(prop)) {
        temp.add(prop);
      }
    }
    intersect = temp;
  }
  const requiredProps = intersect;
  const filtered = items.filter((_, idx) => {
    const itemSet = itemPropsSets[idx];
    for (const prop of requiredProps) {
      if (!itemSet.has(prop)) {
        return false;
      }
    }
    return true;
  });
  return filtered;
}

async function extractField(
  $: cheerio.Root,
  el: cheerio.Element,
  field: CSSTarget,
  advanced: boolean = false,
  forEnclosure: boolean = false,
  forLink: boolean = false
): Promise<string> {
  if (!field) return "";

  if (field.drillChain?.length) {
    const itemHtml = $.html(el);
    return await resolveDrillChain(itemHtml, field.drillChain, advanced);
  }

  const target = $(el).find(field.selector);

  if (field.attribute) {
    const rawAttr = target.attr(field.attribute);
    if (rawAttr) return rawAttr;
  }

  const rawText = target.text()?.trim();

  if (rawText && /^https?:\/\//i.test(rawText)) {
    return rawText;
  }

  if (rawText) {
    return rawText;
  }

  if (forLink) {
    const directHref = target.attr("href");
    if (directHref) return directHref;

    const nestedHref = target
      .find("*")
      .toArray()
      .map((child) => $(child).attr("href"))
      .find((url) => url && /^https?:\/\//i.test(url));
    if (nestedHref) return nestedHref;
  }

  if (forEnclosure) {
    const inlineStyle = target.attr("style");
    let bgMatch = inlineStyle?.match(
      /background(?:-image)?:.*url\(["']?(.*?)["']?\)/i
    );
    if (bgMatch?.[1]) return bgMatch[1];

    let parent = target.parent();
    while (parent.length) {
      const parentStyle = parent.attr("style");
      bgMatch = parentStyle?.match(/background(?:-image)?:.*url\(["']?(.*?)["']?\)/i);
      if (bgMatch?.[1]) return bgMatch[1];
      parent = parent.parent();
    }

    const nestedSrc = target
      .find("img, video, audio")
      .toArray()
      .map((child) => $(child).attr("src"))
      .find((url) => url && /^https?:\/\//i.test(url));
    if (nestedSrc) return nestedSrc;
  }

  return "";
}
