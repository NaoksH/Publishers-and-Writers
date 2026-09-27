// GitHub Actions が定期実行するスクリプト。
// 各出版社のRSS/AtomフィードをNode.jsから直接取得し（サーバー間通信なのでCORSの制限を受けない）、
// 結果を feeds.json としてリポジトリ直下に書き出す。
// サイト側（index.html）はこの feeds.json を読むだけなので、ブラウザからの
// 不安定な無料CORS中継サービス頼みだった部分がなくなる。

import { writeFile } from 'node:fs/promises';

const FEED_URLS = {
  bungeishunju: 'https://books.bunshun.jp/list/feed/rss',    // 本の話（文藝春秋）
  shinchosha1: 'https://kangaeruhito.jp/feed',                // 考える人（新潮社）
  shinchosha2: 'https://rss.app/feeds/7yFevhcjup6OM7Ox.xml',  // BookBang（新潮社、RSS.app変換）
  kodansha: 'https://rss.app/feeds/wu43uRxFwQcuzTYY.xml',     // tree（講談社、RSS.app変換）
  kadokawa: 'https://rss.app/feeds/2tILI9TaTzqaYxFa.xml',     // カドブン（KADOKAWA、RSS.app変換）
  shogakukan: 'https://rss.app/feeds/3zIEVCxjqikLrtE8.xml',   // 小説丸（小学館、RSS.app変換）
  kawade: 'https://web.kawade.co.jp/feed/',                   // Web河出（河出書房新社）
  chikuma: 'https://note.com/webchikuma/rss',                 // webちくま（筑摩書房、note基盤）
  shueisha: 'https://rss.app/feeds/6FnANkNx5OEBKEv0.xml',     // 青春と読書（集英社、RSS.app変換）
};

function stripCdata(s) {
  if (s == null) return '';
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripHtml(s) {
  if (!s) return '';
  return decodeEntities(String(s).replace(/<[^>]*>/g, '')).trim();
}

function extractTag(block, tag) {
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const m = block.match(re);
  if (!m) return null;
  return stripCdata(m[1].trim());
}

function extractLinkHref(block) {
  let m = block.match(/<link\b[^>]*\bhref="([^"]+)"[^>]*\/?>/i);
  if (m) return m[1];
  m = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (m) return stripCdata(m[1].trim());
  return null;
}

function toIsoDate(dateLike) {
  const d = new Date(dateLike);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

async function fetchFeedItems(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PublishersNewsBot/1.0; +https://github.com/naoksh/Publishers-and-Writers)',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();

  const items = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const entryBlocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];

  if (itemBlocks.length) {
    for (const block of itemBlocks) {
      const title = extractTag(block, 'title');
      const link = extractLinkHref(block);
      const pubDate = extractTag(block, 'pubDate');
      const desc = extractTag(block, 'description');
      const author = extractTag(block, 'dc:creator') || extractTag(block, 'creator');
      const date = toIsoDate(pubDate) || toIsoDate(new Date());
      if (title) {
        items.push({
          title: stripHtml(title),
          date,
          link,
          author: author ? stripHtml(author) : null,
          excerpt: stripHtml(desc).slice(0, 60),
        });
      }
    }
  } else if (entryBlocks.length) {
    for (const block of entryBlocks) {
      const title = extractTag(block, 'title');
      const link = extractLinkHref(block);
      const updated = extractTag(block, 'updated') || extractTag(block, 'published');
      const summary = extractTag(block, 'summary') || extractTag(block, 'content');
      const author = extractTag(block, 'name') || extractTag(block, 'dc:creator') || extractTag(block, 'creator');
      const date = toIsoDate(updated) || toIsoDate(new Date());
      if (title) {
        items.push({
          title: stripHtml(title),
          date,
          link,
          author: author ? stripHtml(author) : null,
          excerpt: stripHtml(summary).slice(0, 60),
        });
      }
    }
  }

  return items.slice(0, 15);
}

async function main() {
  const feeds = {};
  const errors = {};

  for (const [id, url] of Object.entries(FEED_URLS)) {
    try {
      feeds[id] = await fetchFeedItems(url);
      console.log(`OK: ${id} (${feeds[id].length} items)`);
    } catch (err) {
      console.warn(`FAILED: ${id}: ${err.message}`);
      errors[id] = String(err.message || err);
      feeds[id] = [];
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    feeds,
    errors,
  };

  await writeFile('feeds.json', JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log('feeds.json written.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
