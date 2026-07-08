// linkScraper.js
// High-accuracy scraping for GitHub + Portfolio using Puppeteer + Readability
// LINKEDIN scraping is fully disabled (blocked by 999/429)

const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { parse } = require("node-html-parser");
const { assertSafeUrl } = require("./urlGuard");

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10000;
const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

/* -----------------------------------------------------
   CLEAN TEXT (for embeddings)
----------------------------------------------------- */
function cleanText(str = "") {
    return str.replace(/[\s\n\r\t]+/g, " ").trim();
}

// Wraps axios.get with SSRF protection: resolves+validates the URL before
// the request, and again on every redirect hop (axios does not re-validate
// redirect targets itself).
async function safeGet(rawUrl, opts = {}) {
    await assertSafeUrl(rawUrl);

    return axios.get(rawUrl, {
        timeout: FETCH_TIMEOUT_MS,
        maxRedirects: 0, // handle redirects manually so each hop is validated
        validateStatus: (s) => s < 400,
        ...opts,
    }).catch(async (err) => {
        const redirect = err.response && [301, 302, 303, 307, 308].includes(err.response.status);
        const location = err.response && err.response.headers && err.response.headers.location;

        if (redirect && location && (opts._redirectCount || 0) < MAX_REDIRECTS) {
            const nextUrl = new URL(location, rawUrl).toString();
            return safeGet(nextUrl, { ...opts, _redirectCount: (opts._redirectCount || 0) + 1 });
        }
        throw err;
    });
}

/* -----------------------------------------------------
   MASTER SCRAPER ROUTER
----------------------------------------------------- */
async function scrapeLink(url, type = "generic") {
    if (!url) return "";

    try {
        await assertSafeUrl(url);
    } catch (err) {
        console.error("scrapeLink blocked unsafe URL:", err.message);
        return "";
    }

    try {
        if (type === "github" || url.includes("github.com"))
            return await scrapeGithub(url);

        // ❌ LINKEDIN COMPLETELY DISABLED
        if (type === "linkedin" || url.includes("linkedin.com")) {
            console.log("⚠ LinkedIn scraping disabled. Skipping:", url);
            return "";
        }

        // Portfolio / Website
        return await scrapePortfolio(url);

    } catch (err) {
        console.error("scrapeLink Error:", err.message);
        return "";
    }
}

/* =========================================================
   1. GITHUB SCRAPER (Reliable + Fast)
========================================================= */
async function scrapeGithub(url) {
    try {
        const rawSegment = url.split("github.com/")[1];
        const username = rawSegment ? rawSegment.split("/")[0].split("?")[0] : "";

        if (!GITHUB_USERNAME_RE.test(username)) {
            console.error("GitHub scrape rejected: invalid username in URL");
            return "";
        }

        let finalText = "";

        // Fetch GitHub Profile
        const profileRes = await safeGet(`https://github.com/${username}`, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });

        let $ = cheerio.load(profileRes.data);

        const name = $(".p-name").text().trim();
        const uname = $(".p-nickname").text().trim();
        const bio = $(".p-note").text().trim();

        finalText += `GitHub Profile:\nName: ${name}\nUsername: ${uname}\nBio: ${bio}\n`;

        // Pinned repos
        let pinnedRepos = [];
        $(".pinned-item-list-item").each((_, el) => {
            pinnedRepos.push(
                `Pinned Repo: ${$(el).find("span.repo").text().trim()} | ${$(el).find(".pinned-item-desc").text().trim()}`
            );
        });

        if (pinnedRepos.length > 0)
            finalText += "\nPinned Repositories:\n" + pinnedRepos.join("\n");

        // Fetch Repositories Page
        const reposRes = await safeGet(
            `https://github.com/${username}?tab=repositories`,
            { headers: { "User-Agent": "Mozilla/5.0" } }
        );

        $ = cheerio.load(reposRes.data);
        let allRepos = [];

        $(".source").each((_, repo) => {
            const repoName = $(repo).find("a").text().trim();
            if (/^[a-zA-Z0-9._-]+$/.test(repoName)) allRepos.push(repoName);
        });

        finalText += `\nAll Repositories:\n${allRepos.join(", ")}\n`;

        // README Scraping for first 5 repos
        const readmePromises = allRepos.slice(0, 5).map(async (repo) => {
            const rawUrls = [
                `https://raw.githubusercontent.com/${username}/${repo}/main/README.md`,
                `https://raw.githubusercontent.com/${username}/${repo}/master/README.md`
            ];

            for (let rawUrl of rawUrls) {
                try {
                    const r = await safeGet(rawUrl);
                    return `\nREADME of ${repo}:\n${String(r.data).substring(0, 3000)}`;
                } catch { }
            }
            return "";
        });

        const readmes = await Promise.all(readmePromises);
        finalText += readmes.join("");

        return cleanText(finalText);

    } catch (err) {
        console.error("GitHub scrape failed:", err.message);
        return await scrapePortfolio(url);
    }
}

/* =========================================================
   2. PORTFOLIO SCRAPER (PUPPETEER + READABILITY)
========================================================= */
async function scrapePortfolio(url) {
    let browser;

    try {
        await assertSafeUrl(url);

        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--disable-gpu"
            ]
        });

        const page = await browser.newPage();

        // Block images, css, fonts for speed, and re-validate the target of
        // every navigation/redirect the page makes (blocks SSRF via
        // client-side redirects to internal hosts).
        await page.setRequestInterception(true);
        page.on('request', async (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                return req.abort();
            }
            if (resourceType === 'document') {
                try {
                    await assertSafeUrl(req.url());
                } catch {
                    return req.abort();
                }
            }
            req.continue();
        });

        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        console.log("Scraping portfolio:", url);

        // Faster timeout, domcontentloaded is usually enough for text
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20000
        });

        // Wait a bit for hydration if needed, but not too long
        try {
            await page.waitForNetworkIdle({ timeout: 2000 });
        } catch (e) {
            // Ignore timeout on network idle
        }

        await scrollPage(page);

        const html = await page.content();

        const dom = new JSDOM(html, { url });
        const doc = dom.window.document;

        const reader = new Readability(doc);
        const article = reader.parse();

        let finalText = "";

        if (article && article.textContent && article.textContent.length > 50) {
            finalText = `
                Title: ${article.title}
                Excerpt: ${article.excerpt}
                Content: ${article.textContent}
            `;
        } else {
            finalText = doc.body.textContent;
        }

        await browser.close();

        return cleanText(finalText).substring(0, 20000);

    } catch (err) {
        console.error("Portfolio scrape failed:", err.message);

        if (browser) {
            try { await browser.close(); } catch { }
        }

        return await fastFallback(url);
    }
}

/* =========================================================
   3. FAST FALLBACK SCRAPER (No JS Support)
========================================================= */
async function fastFallback(url) {
    try {
        const { data } = await safeGet(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
        });

        const cleaned = String(data)
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<img[^>]*>/gi, "")
            .replace(/<video[\s\S]*?<\/video>/gi, "");

        const root = parse(cleaned);
        return cleanText(root.innerText).substring(0, 20000);

    } catch (err) {
        console.error("fastFallback error:", err.message);
        return "";
    }
}

/* =========================================================
   4. AUTO SCROLL (Required for Next.js/React SPA)
========================================================= */
async function scrollPage(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 800; // Increased distance
            const maxScrolls = 20; // Limit scrolls to avoid infinite loops

            let scrolls = 0;
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;
                scrolls++;

                if (totalHeight >= document.body.scrollHeight || scrolls >= maxScrolls) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100); // Faster interval
        });
    });
}

module.exports = { scrapeLink };
