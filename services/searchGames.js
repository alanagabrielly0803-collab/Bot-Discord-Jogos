const axios = require('axios');
const cheerio = require('cheerio');

const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DiscordFreeGamesBot/1.0',
    Accept: 'text/html,application/json,application/xml;q=0.9,*/*;q=0.8'
  },
  validateStatus: (status) => status >= 200 && status < 500
});

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function stripHtml(value) {
  if (!value) {
    return '';
  }
  const $ = cheerio.load(`<div>${value}</div>`);
  return cleanText($.text());
}

function uniqueBy(items, selector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = selector(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function absoluteUrl(baseUrl, href) {
  if (!href) {
    return null;
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  return null;
}

function pickImageFromArray(images) {
  if (!Array.isArray(images)) {
    return null;
  }

  const preferredTypes = ['OfferImageWide', 'DieselStoreFrontWide', 'featuredMedia', 'Thumbnail', 'Image'];
  for (const type of preferredTypes) {
    const found = images.find((image) => String(image.type || '').toLowerCase() === type.toLowerCase());
    if (found && found.url) {
      return found.url;
    }
  }

  const first = images.find((image) => image && image.url);
  return first ? first.url : null;
}

function normalizeGame(game) {
  const dedupeKey = cleanText(
    game.dedupeKey || [game.platform, game.title, game.claimUrl || game.sourceUrl, game.endDate || ''].join('|')
  );

  return {
    title: cleanText(game.title),
    platform: cleanText(game.platform),
    originalPrice: cleanText(game.originalPrice || 'Não informado'),
    claimUrl: game.claimUrl || null,
    sourceUrl: game.sourceUrl || game.claimUrl || null,
    endDate: game.endDate || null,
    image: game.image || null,
    description: cleanText(game.description || ''),
    freeType: cleanText(game.freeType || 'Grátis'),
    dedupeKey,
    discoveredAt: new Date().toISOString()
  };
}

async function fetchJson(url) {
  const response = await http.get(url, { responseType: 'json' });
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status} ao acessar ${url}`);
  }
  return response.data;
}

async function fetchText(url) {
  const response = await http.get(url, { responseType: 'text' });
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status} ao acessar ${url}`);
  }
  return response.data;
}

async function searchEpicGames() {
  const data = await fetchJson(
    'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US'
  );

  const elements = data?.data?.Catalog?.searchStore?.elements || [];
  const now = Date.now();

  const games = elements
    .map((element) => {
      const promo = element?.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (!promo) {
        return null;
      }

      const endDate = promo.endDate ? new Date(promo.endDate) : null;
      if (!endDate || Number.isNaN(endDate.getTime()) || endDate.getTime() < now) {
        return null;
      }

      const slug =
        element.productSlug ||
        element.urlSlug ||
        element.catalogNs?.mappings?.[0]?.pageSlug ||
        element.offerMappings?.[0]?.pageSlug;

      return normalizeGame({
        title: element.title,
        platform: 'Epic Games Store',
        originalPrice: element.price?.totalPrice?.fmtPrice?.originalPrice || 'Grátis',
        claimUrl: slug ? `https://store.epicgames.com/p/${slug}` : null,
        sourceUrl: slug ? `https://store.epicgames.com/p/${slug}` : null,
        endDate: endDate.toISOString(),
        image: pickImageFromArray(element.keyImages),
        description: cleanText(element.description || element.title || 'Oferta da Epic Games Store.'),
        freeType: 'Grátis por tempo limitado',
        dedupeKey: `epic|${slug || element.id || element.title}|${endDate.toISOString()}`
      });
    })
    .filter(Boolean);

  return uniqueBy(games, (game) => game.dedupeKey);
}

async function searchSteamGames() {
  const urls = [
    'https://store.steampowered.com/news/search/?term=free+weekend',
    'https://store.steampowered.com/news/search/?term=play+for+free'
  ];

  const candidates = [];

  for (const url of urls) {
    const html = await fetchText(url);
    const $ = cheerio.load(html);

    $('a[href*="/news/app/"], a[href*="/news/"]').each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href');
      const title = cleanText(anchor.text());
      const cardText = cleanText(anchor.closest('div, article, li, .newsfeed').text());

      if (!href || !/free weekend|play for free|free to play weekend|weekend deal/i.test(`${title} ${cardText}`)) {
        return;
      }

      const absolute = absoluteUrl('https://store.steampowered.com', href);
      candidates.push({
        href: absolute,
        title: title || cardText
      });
    });
  }

  const uniqueCandidates = uniqueBy(candidates, (item) => item.href).slice(0, 5);
  const games = [];

  for (const candidate of uniqueCandidates) {
    try {
      const articleHtml = await fetchText(candidate.href);
      const article$ = cheerio.load(articleHtml);
      const articleTitle = cleanText(
        article$('meta[property="og:title"]').attr('content') ||
          article$('title').text() ||
          candidate.title
      );
      const articleImage = article$('meta[property="og:image"]').attr('content') || null;
      const articleBody = cleanText(article$('article').text() || article$('body').text());
      const appMatch = candidate.href.match(/news\/app\/(\d+)\/view\/(\d+)/i);
      const appId = appMatch ? appMatch[1] : null;

      let gameTitle = articleTitle.replace(/^Steam News - /i, '');
      gameTitle = gameTitle.replace(/^Free Weekend - /i, '').replace(/^Free Weekend\s*[-–—]\s*/i, '');

      if (appId) {
        try {
          const appDetails = await fetchJson(
            `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US&l=english`
          );
          const payload = appDetails?.[appId]?.data;
          if (payload?.name) {
            gameTitle = payload.name;
          }

          const price = payload?.price_overview?.initial_formatted || payload?.price_overview?.final_formatted;
          const headerImage = payload?.header_image || articleImage;

          games.push(
            normalizeGame({
              title: gameTitle,
              platform: 'Steam',
              originalPrice: price || 'Grátis',
              claimUrl: `https://store.steampowered.com/app/${appId}`,
              sourceUrl: candidate.href,
              endDate: extractSteamEndDate(articleBody, candidate.href, articleHtml),
              image: headerImage,
              description:
                payload?.short_description ||
                extractSteamDescription(articleBody) ||
                'Promoção temporária da Steam.',
              freeType: 'Free Weekend',
              dedupeKey: `steam|${appId}|${candidate.href}`
            })
          );
        } catch {
          games.push(
            normalizeGame({
              title: gameTitle,
              platform: 'Steam',
              originalPrice: 'Não informado',
              claimUrl: candidate.href,
              sourceUrl: candidate.href,
              endDate: extractSteamEndDate(articleBody, candidate.href, articleHtml),
              image: articleImage,
              description: extractSteamDescription(articleBody) || 'Promoção temporária da Steam.',
              freeType: 'Free Weekend',
              dedupeKey: `steam|${candidate.href}`
            })
          );
        }
      } else {
        games.push(
          normalizeGame({
            title: gameTitle,
            platform: 'Steam',
            originalPrice: 'Não informado',
            claimUrl: candidate.href,
            sourceUrl: candidate.href,
            endDate: extractSteamEndDate(articleBody, candidate.href, articleHtml),
            image: articleImage,
            description: extractSteamDescription(articleBody) || 'Promoção temporária da Steam.',
            freeType: 'Free Weekend',
            dedupeKey: `steam|${candidate.href}`
          })
        );
      }
    } catch {
      // Ignore individual Steam article failures.
    }
  }

  return uniqueBy(games, (game) => game.dedupeKey);
}

function extractSteamDescription(articleText) {
  const match = articleText.match(
    /(?:Play|Try|Jump into|Enjoy)\s+(.+?)(?:for free|free weekend|this weekend|starting now|available)/i
  );
  return match ? cleanText(match[1]) : '';
}

function extractSteamEndDate(articleText, sourceUrl, articleHtml) {
  const referenceDate = extractSteamReferenceDate(articleHtml);
  const explicitDate = firstMatch(articleText, [
    /(?:through|until|available until|ends on|available through)\s+([^.]+?)(?:\.\s|$)/i,
    /(?:from .*? until )([^.]+?)(?:\.\s|$)/i
  ]);

  if (explicitDate) {
    return normalizeSteamDatePhrase(explicitDate, referenceDate);
  }

  const dayMatch = firstMatch(articleText, [
    /through\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)(?:,\s*([A-Za-z]+)\s+(\d{1,2}))?(?:\s+at\s+([0-9:apm\s]+))?/i,
    /until\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)(?:,\s*([A-Za-z]+)\s+(\d{1,2}))?(?:\s+at\s+([0-9:apm\s]+))?/i
  ]);

  if (dayMatch) {
    return cleanText(dayMatch);
  }

  const linkHint = sourceUrl.match(/(\d{4,})/g);
  return linkHint ? 'Ver artigo da promoção' : 'Não informado';
}

function normalizeSteamDatePhrase(phrase, referenceDate) {
  const text = cleanText(phrase);
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const weekdayMatch = text.match(
    /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)(?:,\s*([A-Za-z]+)\s+(\d{1,2}))?(?:\s+at\s+([0-9:apm\s]+))?/i
  );
  if (weekdayMatch) {
    const targetDate = resolveNextWeekday(weekdayMatch[1], referenceDate || new Date());
    return targetDate ? formatDateOnly(targetDate) : text;
  }

  return text;
}

function extractSteamReferenceDate(articleHtml) {
  try {
    const $ = cheerio.load(articleHtml);
    const timestamp =
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[property="og:updated_time"]').attr('content') ||
      $('time[datetime]').first().attr('datetime');
    if (timestamp) {
      const parsed = new Date(timestamp);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return new Date();
}

function resolveNextWeekday(dayName, baseDate) {
  const days = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };
  const target = days[String(dayName || '').toLowerCase()];
  if (target === undefined) {
    return null;
  }

  const date = new Date(baseDate || new Date());
  const currentDay = date.getDay();
  const delta = (target - currentDay + 7) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function formatDateOnly(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium'
  }).format(date);
}

async function searchGogGames() {
  const html = await fetchText('https://www.gog.com/en/partner/free_games');
  const $ = cheerio.load(html);
  const games = [];

  const candidates = [];

  $('.product-tile, .big-spot, [gog-product]').each((_, element) => {
    const node = $(element);
    const href =
      node.find('a[href*="/game/"]').first().attr('href') ||
      node.find('a[href*="/games/"]').first().attr('href') ||
      node.attr('href');

    const title =
      cleanText(node.find('.product-tile__title, .big-spot__title, h2, h3, h4').first().text()) ||
      cleanText(node.find('a').first().text()) ||
      cleanText(node.text());

    if (!href || !title) {
      return;
    }

    const cardText = cleanText(node.text());
    if (!/free|grátis|owned/i.test(cardText)) {
      return;
    }

    candidates.push({
      title,
      href: absoluteUrl('https://www.gog.com', href),
      image:
        node.find('img').first().attr('src') ||
        node.find('img').first().attr('data-src') ||
        node.find('img').first().attr('data-lazy') ||
        null,
      description:
        cleanText(
          node.find('.product-tile__description, .big-spot__description, .product-tile__subtitle').text()
        ) || '',
      cardText
    });
  });

  const uniqueCandidates = uniqueBy(candidates, (item) => item.href).slice(0, 20);

  for (const candidate of uniqueCandidates) {
    try {
      const productHtml = await fetchText(candidate.href);
      const product$ = cheerio.load(productHtml);
      const description =
        cleanText(product$('meta[name="description"]').attr('content')) ||
        candidate.description ||
        extractFirstParagraph(product$);
      const image =
        product$('meta[property="og:image"]').attr('content') ||
        candidate.image ||
        product$('img').first().attr('src') ||
        null;
      const title =
        cleanText(product$('meta[property="og:title"]').attr('content')) ||
        candidate.title;
      const priceText = extractGogPriceText(product$) || '$0.00';
      const endDate = extractGogEndDate(product$);

      games.push(
        normalizeGame({
          title,
          platform: 'GOG',
          originalPrice: priceText,
          claimUrl: candidate.href,
          sourceUrl: candidate.href,
          endDate,
          image,
          description,
          freeType: 'Free Game',
          dedupeKey: `gog|${candidate.href}`
        })
      );
    } catch {
      games.push(
        normalizeGame({
          title: candidate.title,
          platform: 'GOG',
          originalPrice: '$0.00',
          claimUrl: candidate.href,
          sourceUrl: candidate.href,
          endDate: 'Não informado',
          image: candidate.image,
          description: candidate.description || 'Oferta gratuita da GOG.',
          freeType: 'Free Game',
          dedupeKey: `gog|${candidate.href}`
        })
      );
    }
  }

  return uniqueBy(games, (game) => game.dedupeKey);
}

function extractGogPriceText($) {
  const block =
    $('.discount_final_price').first().text() ||
    $('.product-actions__price').first().text() ||
    $('[data-price-final]').first().attr('data-price-final') ||
    '';
  const text = cleanText(block);
  if (!text) {
    return '$0.00';
  }
  return text;
}

function extractFirstParagraph($) {
  const paragraph = $('p')
    .map((_, element) => cleanText($(element).text()))
    .get()
    .find(Boolean);
  return paragraph || '';
}

function extractGogEndDate($) {
  const text = cleanText($('body').text());
  const explicit = firstMatch(text, [
    /offer ends on:\s*([^.]+?)(?:\.\s|$)/i,
    /ends on:\s*([^.]+?)(?:\.\s|$)/i,
    /available until:\s*([^.]+?)(?:\.\s|$)/i
  ]);
  if (explicit) {
    return cleanText(explicit);
  }
  return 'Não informado';
}

async function searchItchGames() {
  const xml = await fetchText('https://itch.io/games/price-free.xml');
  const $ = cheerio.load(xml, { xmlMode: true });
  const games = [];

  $('item').each((_, item) => {
    const node = $(item);
    const title = cleanText(node.find('plainTitle').text() || node.find('title').text());
    const link = cleanText(node.find('link').text());
    const image = cleanText(node.find('imageurl').text()) || null;
    const price = cleanText(node.find('price').text()) || '$0.00';
    const description = stripHtml(node.find('description').text()) || 'Jogo gratuito no itch.io.';
    const pubDate = cleanText(node.find('pubDate').text());

    if (!title || !link) {
      return;
    }

    games.push(
      normalizeGame({
        title,
        platform: 'itch.io',
        originalPrice: price,
        claimUrl: link,
        sourceUrl: link,
        endDate: 'Não informado',
        image,
        description,
        freeType: 'Grátis permanente',
        dedupeKey: `itch|${link}`
      })
    );
  });

  return uniqueBy(games, (game) => game.dedupeKey);
}

async function searchMicrosoftGames() {
  const xml = await fetchText('https://news.xbox.com/en-us/tag/free-play-days/feed/');
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = $('item').toArray();
  const games = [];

  for (const item of items.slice(0, 3)) {
    const node = $(item);
    const title = cleanText(node.find('title').first().text());
    const link = cleanText(node.find('link').first().text());
    const pubDate = cleanText(node.find('pubDate').first().text());
    const contentHtml = node.find('content\\:encoded').text() || '';
    const content$ = cheerio.load(contentHtml);

    const articleText = cleanText(content$.text());
    const articleImage = content$('img').first().attr('src') || null;
    const sectionTitles = [];

    content$('.ms-product-badge').each((_, badge) => {
      const card = content$(badge);
      const gameTitle = cleanText(card.find('h2').first().text());
      const linkNode = card.find('a.mspb-link, a[href*="microsoft.com/en-us/store/apps/"]').first();
      const claimUrl = linkNode.attr('href') || link;
      const image = card.find('img').first().attr('src') || articleImage;
      const currentPrice = cleanText(card.find('.mspb-price > span').last().text());
      const msrp = cleanText(card.find('.mspb-msrp span').first().text());
      const intro = cleanText(
        content$('p')
          .map((_, p) => content$(p).text())
          .get()
          .find((text) => text && text.includes(gameTitle)) || ''
      );

      if (!gameTitle) {
        return;
      }

      sectionTitles.push(gameTitle);

      games.push(
        normalizeGame({
          title: gameTitle,
          platform: 'Microsoft Store',
          originalPrice: msrp || currentPrice || '$0.00',
          claimUrl,
          sourceUrl: link,
          endDate: extractMicrosoftEndDate(articleText, pubDate),
          image,
          description:
            intro ||
            extractMicrosoftDescription(articleText, title) ||
            'Oferta temporária da Microsoft / Xbox.',
          freeType: title.toLowerCase().includes('for all') ? 'Free Play Days For All' : 'Free Play Days',
          dedupeKey: `microsoft|${claimUrl || gameTitle}|${pubDate}`
        })
      );
    });

    if (sectionTitles.length === 0) {
      const titleMatch = title.match(/Free Play Days\s*[–-]\s*(.+)$/i);
      const gameTitles = titleMatch ? splitMicrosoftTitleList(titleMatch[1]) : [];
      for (const gameTitle of gameTitles) {
        games.push(
          normalizeGame({
            title: gameTitle,
            platform: 'Microsoft Store',
            originalPrice: 'Não informado',
            claimUrl: link,
            sourceUrl: link,
            endDate: extractMicrosoftEndDate(articleText, pubDate),
            image: articleImage,
            description: extractMicrosoftDescription(articleText, title) || 'Oferta temporária da Microsoft / Xbox.',
            freeType: title.toLowerCase().includes('for all') ? 'Free Play Days For All' : 'Free Play Days',
            dedupeKey: `microsoft|${link}|${gameTitle}`
          })
        );
      }
    }
  }

  return uniqueBy(games, (game) => game.dedupeKey);
}

function splitMicrosoftTitleList(value) {
  return cleanText(value)
    .replace(/\sand\s/gi, ', ')
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function extractMicrosoftDescription(articleText, articleTitle) {
  const sentence = firstMatch(articleText, [
    /Celebrate[^.]+\./i,
    /Don’t miss out[^.]+\./i,
    /Don't miss out[^.]+\./i
  ]);
  if (sentence) {
    return cleanText(sentence);
  }
  return cleanText(articleTitle || 'Free Play Days no Xbox / Microsoft Store.');
}

function extractMicrosoftEndDate(articleText, pubDate) {
  const explicit = firstMatch(articleText, [
    /from\s+[A-Za-z]+,\s+([A-Za-z]+\s+\d{1,2})\s+to\s+[A-Za-z]+,\s+([A-Za-z]+\s+\d{1,2})/i,
    /until\s+[A-Za-z]+,\s+([A-Za-z]+\s+\d{1,2})/i,
    /to\s+[A-Za-z]+,\s+([A-Za-z]+\s+\d{1,2})/i
  ]);

  if (explicit) {
    const match = articleText.match(
      /from\s+[A-Za-z]+,\s+([A-Za-z]+\s+\d{1,2})\s+to\s+[A-Za-z]+,\s+([A-Za-z]+\s+\d{1,2})/i
    );
    if (match) {
      const year = pubDate ? new Date(pubDate).getUTCFullYear() : new Date().getUTCFullYear();
      return `${match[2]}, ${year}`;
    }

    const year = pubDate ? new Date(pubDate).getUTCFullYear() : new Date().getUTCFullYear();
    return `${explicit}, ${year}`;
  }

  return 'Não informado';
}

async function searchUbisoftGames() {
  const urls = [
    { url: 'https://store.ubisoft.com/us/date-free-offer-active?lang=en_US', freeType: 'Free Access' },
    { url: 'https://store.ubisoft.com/us/free-games?lang=en_US', freeType: 'Free to Play' }
  ];

  const games = [];

  for (const source of urls) {
    try {
      const html = await fetchText(source.url);
      const $ = cheerio.load(html);

      const candidates = [];
      $('a[href]').each((_, element) => {
        const anchor = $(element);
        const href = anchor.attr('href');
        const text = cleanText(anchor.text());
        const fullText = cleanText(anchor.closest('article, li, div').text());

        if (!href || !/store\.ubisoft\.com|ubisoft\.com/i.test(href)) {
          return;
        }

        if (!/free|access|play|games|siege|trackmania|growtopia|brawlhalla|champions tactics|roller champions|battlecore arena/i.test(`${text} ${fullText}`)) {
          return;
        }

        if (/add to wishlist|see more|get free access|view results|filters|sort by/i.test(text)) {
          return;
        }

        const title = text || fullText.split('\n').map(cleanText).find(Boolean);
        if (!title || title.length > 120) {
          return;
        }

        candidates.push({
          title,
          claimUrl: absoluteUrl(source.url, href),
          image: anchor.find('img').first().attr('src') || anchor.closest('article, li, div').find('img').first().attr('src') || null,
          cardText: fullText
        });
      });

      const uniqueCandidates = uniqueBy(candidates, (item) => item.claimUrl).slice(0, 12);

      for (const candidate of uniqueCandidates) {
        try {
          const detailHtml = await fetchText(candidate.claimUrl);
          const detail$ = cheerio.load(detailHtml);
          const title =
            cleanText(detail$('meta[property="og:title"]').attr('content')) ||
            cleanText(detail$('title').text()) ||
            candidate.title;
          const description =
            cleanText(detail$('meta[name="description"]').attr('content')) ||
            cleanText(detail$('body').text()) ||
            candidate.cardText;
          const endDate = extractUbisoftEndDate(description);
          const image =
            detail$('meta[property="og:image"]').attr('content') ||
            candidate.image ||
            detail$('img').first().attr('src') ||
            null;
          const price = extractUbisoftPrice(description) || 'Grátis';

          games.push(
            normalizeGame({
              title,
              platform: 'Ubisoft Store',
              originalPrice: 'Grátis',
              claimUrl: candidate.claimUrl,
              sourceUrl: source.url,
              endDate,
              image,
              description: extractUbisoftDescription(description, title),
              freeType: source.freeType,
              dedupeKey: `ubisoft|${candidate.claimUrl}`
            })
          );
        } catch {
          games.push(
            normalizeGame({
              title: candidate.title,
              platform: 'Ubisoft Store',
              originalPrice: 'Grátis',
              claimUrl: candidate.claimUrl,
              sourceUrl: source.url,
              endDate: 'Não informado',
              image: candidate.image,
              description: candidate.cardText || 'Oferta gratuita da Ubisoft.',
              freeType: source.freeType,
              dedupeKey: `ubisoft|${candidate.claimUrl}`
            })
          );
        }
      }
    } catch {
      // Ignore page-level Ubisoft failures.
    }
  }

  return uniqueBy(games, (game) => game.dedupeKey);
}

function extractUbisoftPrice(text) {
  const price = firstMatch(text, [
    /(\$?\d+(?:[.,]\d{2})?)/i,
    /(€\s?\d+(?:[.,]\d{2})?)/i,
    /(R\$\s?\d+(?:[.,]\d{2})?)/i
  ]);
  return price || 'Grátis';
}

function extractUbisoftDescription(text, fallbackTitle) {
  const paragraph = cleanText(text).split('. ').find((part) => part.length > 40);
  return paragraph || `Oferta gratuita da Ubisoft para ${fallbackTitle}.`;
}

function extractUbisoftEndDate(text) {
  const dateMatch = firstMatch(text, [
    /available until\s+([^\.]+)/i,
    /until\s+([^\.]+)/i,
    /offer ends on\s+([^\.]+)/i,
    /ends on\s+([^\.]+)/i
  ]);
  return dateMatch ? cleanText(dateMatch) : 'Não informado';
}

async function searchPrimeGames() {
  const urls = [
    'https://luna.amazon.com/claims/home',
    'https://gaming.amazon.com/home'
  ];

  const games = [];

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const $ = cheerio.load(html);

      $('a[href]').each((_, element) => {
        const anchor = $(element);
        const href = anchor.attr('href');
        const text = cleanText(anchor.text());
        const image = anchor.find('img').first().attr('src') || null;

        if (!href || !/claim|free|game|prime|luna/i.test(`${text} ${href}`)) {
          return;
        }

        const claimUrl = absoluteUrl(url, href);
        const title = text;
        if (!title || title.length > 120) {
          return;
        }

        games.push(
          normalizeGame({
            title,
            platform: 'Prime Gaming',
            originalPrice: 'Não informado',
            claimUrl,
            sourceUrl: url,
            endDate: extractPrimeEndDate($, text) || 'Não informado',
            image,
            description: extractPrimeDescription($, title) || 'Oferta da Prime Gaming / Amazon Luna.',
            freeType: 'Prime Gaming',
            dedupeKey: `prime|${claimUrl}`
          })
        );
      });
    } catch {
      // Keep trying alternate Prime Gaming pages.
    }
  }

  return uniqueBy(games, (game) => game.dedupeKey).slice(0, 10);
}

function extractPrimeDescription($, title) {
  const text = cleanText($('body').text());
  const sentence = firstMatch(text, [
    /free games?[^.]+\./i,
    /claim[^.]+\./i
  ]);
  if (sentence) {
    return sentence;
  }
  return `Oferta da Prime Gaming para ${title}.`;
}

function extractPrimeEndDate($) {
  const text = cleanText($('body').text());
  const date = firstMatch(text, [
    /available until\s+([^\.]+)/i,
    /claim by\s+([^\.]+)/i,
    /ends on\s+([^\.]+)/i
  ]);
  return date ? cleanText(date) : null;
}

async function searchAllPlatforms() {
  const providers = [
    { name: 'Epic Games Store', fn: searchEpicGames },
    { name: 'Steam', fn: searchSteamGames },
    { name: 'GOG', fn: searchGogGames },
    { name: 'Ubisoft Store', fn: searchUbisoftGames },
    { name: 'Microsoft Store', fn: searchMicrosoftGames },
    { name: 'itch.io', fn: searchItchGames },
    { name: 'Prime Gaming', fn: searchPrimeGames }
  ];

  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const games = await provider.fn();
      return { name: provider.name, games };
    })
  );

  const games = [];
  const errors = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      games.push(...result.value.games);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const dedupedGames = uniqueBy(games, (game) => game.dedupeKey);
  return {
    games: dedupedGames,
    errors
  };
}

module.exports = {
  searchAllPlatforms,
  searchEpicGames,
  searchGogGames,
  searchItchGames,
  searchMicrosoftGames,
  searchPrimeGames,
  searchSteamGames,
  searchUbisoftGames
};
