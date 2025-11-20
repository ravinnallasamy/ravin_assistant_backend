// adminController.js (LinkedIn disabled version)

const supabase = require('../services/supabaseClient');
const { extractTextFromResume } = require('../services/resumeExtractService');
const { scrapeLink } = require('../services/linkScraper');
const { chunkText, generateBatchEmbeddings, generateEmbedding, similaritySearch } = require('../services/embeddingService');
const { textToSpeechMale } = require('../services/audioService');
require('dotenv').config();


// ======================================================================
// LOGIN
// ======================================================================
exports.login = async (req, res) => {
    res.json({ message: 'Login successful' });
};


// ======================================================================
// UPDATE PROFILE (LinkedIn disabled)
// ======================================================================
exports.updateProfile = async (req, res) => {
    try {
        const { github_url, linkedin_url, portfolio_url, bio } = req.body;

        const { data: existingProfile } = await supabase
            .from('profile')
            .select('*')
            .single();

        // First time creation
        if (!existingProfile) {

            const scrapedData = await processEmbeddings({
                github_url,
                // linkedin removed
                portfolio_url,
                bio
            });

            await supabase.from('profile').insert([{
                id: '00000000-0000-0000-0000-000000000000',
                github_url,
                linkedin_url,     // stored but not scraped
                portfolio_url,
                bio,
                scraped_github: scrapedData.github || null,
                scraped_portfolio: scrapedData.portfolio || null
                // no scraped_linkedin
            }]);

            return res.json({ message: "Profile created successfully." });
        }

        // Otherwise, updating values
        const updateData = {
            github_url,
            linkedin_url,     // stored but ignored for scraping
            portfolio_url,
            bio
        };

        const scrapePayload = {};

        // Helper for GitHub & Portfolio ONLY
        const checkSource = async (type, newUrl, oldUrl, oldScraped) => {
            if (type === 'linkedin') return; // 🚫 disabled entirely

            if (newUrl !== oldUrl) {
                if (!newUrl) {
                    // URL removed
                    updateData[`scraped_${type}`] = null;
                    await supabase.from("embeddings").delete().eq("source", type);
                } else {
                    // URL changed → scrape again
                    scrapePayload[`${type}_url`] = newUrl;
                }
            } else if (newUrl && !oldScraped) {
                scrapePayload[`${type}_url`] = newUrl;
            }
        };

        await checkSource("github", github_url, existingProfile.github_url, existingProfile.scraped_github);
        await checkSource("linkedin", linkedin_url, existingProfile.linkedin_url, existingProfile.scraped_linkedin); // ignored
        await checkSource("portfolio", portfolio_url, existingProfile.portfolio_url, existingProfile.scraped_portfolio);

        // BIO
        if (bio !== existingProfile.bio) {
            if (!bio) {
                await supabase.from("embeddings").delete().eq("source", "bio");
            } else {
                scrapePayload.bio = bio;
            }
        }

        // Run scraping/embedding
        if (Object.keys(scrapePayload).length > 0) {
            console.log("Scraping sources:", Object.keys(scrapePayload));

            const results = await processEmbeddings(scrapePayload);

            if (results.github) updateData.scraped_github = results.github;
            if (results.portfolio) updateData.scraped_portfolio = results.portfolio;
            // no linkedin
        }

        await supabase.from("profile").update(updateData).eq("id", existingProfile.id);

        res.json({ message: "Profile updated successfully." });

    } catch (error) {
        console.error("UpdateProfile Error:", error);
        res.status(500).json({ error: "Profile update failed" });
    }
};


// ======================================================================
// SCRAPING + EMBEDDING PIPELINE (LinkedIn disabled)
// ======================================================================
async function processEmbeddings(data) {
    const { github_url, portfolio_url, bio } = data;

    const results = {};

    const linkSources = [
        { url: github_url, type: "github" },
        // LinkedIn REMOVED
        { url: portfolio_url, type: "portfolio" }
    ].filter(v => v.url);

    await Promise.all(
        linkSources.map(async (src) => {

            console.log(`Scraping ${src.type} → ${src.url}`);

            const text = await scrapeLink(src.url, src.type);
            if (!text) return;

            if (src.type === "github") results.github = text;
            if (src.type === "portfolio") results.portfolio = text;

            const chunks = chunkText(text);
            if (!chunks.length) return;

            const embeddings = await generateBatchEmbeddings(chunks);

            await supabase.from("embeddings").delete().eq("source", src.type);

            const insertRows = embeddings.map(e => ({
                chunk: e.chunk,
                embedding: e.embedding,
                source: src.type
            }));

            await supabase.from("embeddings").insert(insertRows);
        })
    );

    // BIO
    if (bio) {
        const chunks = chunkText(bio);
        const embeddings = await generateBatchEmbeddings(chunks);

        await supabase.from("embeddings").delete().eq("source", "bio");

        await supabase.from("embeddings").insert(
            embeddings.map(e => ({
                chunk: e.chunk,
                embedding: e.embedding,
                source: "bio"
            }))
        );
    }

    return results;
}


// ======================================================================
// UPLOAD FILE (RESUME / PHOTO)
// ======================================================================
exports.uploadFile = async (req, res) => {
    try {
        const file = req.file;
        const { type } = req.body;

        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        const ext = file.originalname.split('.').pop();
        const fileName = type === 'resume' ? `resume.${ext}` : `photo.${ext}`;

        const { error: uploadError } = await supabase.storage
            .from("assets")
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (uploadError) return res.status(500).json({ error: "Upload failed" });

        const { data: urlData } = supabase.storage.from("assets").getPublicUrl(fileName);
        let publicUrl = urlData.publicUrl;

        // Add cache-busting timestamp for photos to prevent browser caching
        if (type === "photo") {
            publicUrl = `${publicUrl}?t=${Date.now()}`;
        }

        const updateData = type === "resume"
            ? { resume_url: publicUrl }
            : { photo_url: publicUrl };

        if (type === "resume") {
            const extracted = await extractTextFromResume(file.buffer, file.mimetype);

            updateData.scraped_resume = extracted;

            const chunks = chunkText(extracted);
            const embeddings = await generateBatchEmbeddings(chunks);

            await supabase.from("embeddings").delete().eq("source", "resume");

            await supabase.from("embeddings").insert(
                embeddings.map(e => ({
                    chunk: e.chunk,
                    embedding: e.embedding,
                    source: "resume"
                }))
            );
        }

        const { data: profiles } = await supabase.from("profile").select("*");

        if (!profiles.length) {
            await supabase.from("profile").insert([{
                id: "00000000-0000-0000-0000-000000000000",
                ...updateData
            }]);
        } else {
            await supabase.from("profile").update(updateData).eq("id", profiles[0].id);
        }

        res.json({ message: "Upload successful", url: publicUrl });


    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: "Upload failed" });
    }
};


// ======================================================================
// GET QNA
// ======================================================================
exports.getQnA = async (req, res) => {
    try {
        const { data } = await supabase
            .from("qna")
            .select("*")
            .order("created_at", { ascending: false });

        res.json(data);
    } catch (err) {
        console.error("QnA fetch error:", err);
        res.status(500).json({ error: "Fetch failed" });
    }
};


// ======================================================================
// GET PROFILE (Simple)
// ======================================================================
exports.getAdminProfile = async (req, res) => {
    try {
        const { data } = await supabase.from("profile").select("*").single();
        res.json(data || {});
    } catch (err) {
        console.error("Profile error:", err);
        res.status(500).json({ error: "Fetch failed" });
    }
};


// ======================================================================
// MANUAL SCRAPING (LinkedIn disabled)
// ======================================================================
exports.scrapeUrl = async (req, res) => {
    try {
        const { url, type } = req.body;

        if (!url) return res.status(400).json({ error: "URL is required" });

        if (type === "linkedin")
            return res.status(400).json({ error: "LinkedIn scraping disabled." });

        const scrapedText = await scrapeLink(url, type);

        if (!scrapedText)
            return res.status(400).json({ error: "Unable to scrape content." });

        const updateData = {};
        if (type === "github") updateData.scraped_github = scrapedText;
        if (type === "portfolio") updateData.scraped_portfolio = scrapedText;

        const { data: profiles } = await supabase
            .from("profile")
            .select("id");

        if (profiles.length > 0)
            await supabase.from("profile").update(updateData).eq("id", profiles[0].id);

        const chunks = chunkText(scrapedText);
        const embeddings = await generateBatchEmbeddings(chunks);

        await supabase.from("embeddings").delete().eq("source", type);

        await supabase.from("embeddings").insert(
            embeddings.map(e => ({
                chunk: e.chunk,
                embedding: e.embedding,
                source: type
            }))
        );

        res.json({ scrapedText });

    } catch (err) {
        console.error("Manual scrape error:", err);
        res.status(500).json({ error: "Scraping failed" });
    }
};
