// adminController.js (LinkedIn disabled version)

const supabase = require('../services/supabaseClient');
const { extractTextFromResume } = require('../services/resumeExtractService');
const { scrapeLink } = require('../services/linkScraper');
const { chunkText, generateBatchEmbeddings, replaceEmbeddingsForSource } = require('../services/embeddingService');

const PROFILE_ID = '00000000-0000-0000-0000-000000000000';
const RESUME_PREVIEW_MAX_LENGTH = 200000;

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

        const { data: existingProfile, error: fetchError } = await supabase
            .from('profile')
            .select('*')
            .maybeSingle();

        if (fetchError) {
            console.error('UpdateProfile fetch error:', fetchError);
            return res.status(500).json({ error: 'Failed to load profile' });
        }

        // First time creation
        if (!existingProfile) {
            const scrapedData = await processEmbeddings({
                github_url,
                // linkedin removed
                portfolio_url,
                bio
            });

            const { error: insertError } = await supabase.from('profile').insert([{
                id: PROFILE_ID,
                github_url,
                linkedin_url,     // stored but not scraped
                portfolio_url,
                bio,
                scraped_github: scrapedData.github || null,
                scraped_portfolio: scrapedData.portfolio || null
                // no scraped_linkedin
            }]);

            if (insertError) {
                console.error('UpdateProfile insert error:', insertError);
                return res.status(500).json({ error: 'Profile creation failed' });
            }

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
                    await replaceEmbeddingsForSource(type, []);
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
                await replaceEmbeddingsForSource("bio", []);
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

        const { error: updateError } = await supabase
            .from("profile")
            .update(updateData)
            .eq("id", existingProfile.id);

        if (updateError) {
            console.error('UpdateProfile update error:', updateError);
            return res.status(500).json({ error: 'Profile update failed' });
        }

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
            await replaceEmbeddingsForSource(src.type, embeddings);
        })
    );

    // BIO
    if (bio) {
        const chunks = chunkText(bio);
        const embeddings = await generateBatchEmbeddings(chunks);
        await replaceEmbeddingsForSource("bio", embeddings);
    }

    return results;
}


// ======================================================================
// UPLOAD FILE (RESUME / PHOTO)
// ======================================================================
const EXT_BY_MIME = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};

exports.uploadFile = async (req, res) => {
    try {
        const file = req.file;
        const { type } = req.body;

        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        if (!['resume', 'photo'].includes(type)) {
            return res.status(400).json({ error: 'type must be "resume" or "photo"' });
        }

        const ext = EXT_BY_MIME[file.mimetype];
        if (!ext) return res.status(400).json({ error: 'Unsupported file type' });
        // Resumes may be a PDF or an image (for OCR); photos must be an image.
        if (type === 'photo' && ext === 'pdf') {
            return res.status(400).json({ error: 'Photo must be an image file' });
        }

        const fileName = type === 'resume' ? `resume.${ext}` : `photo.${ext}`;

        console.log(`Uploading ${type} → ${fileName} (${file.mimetype}, ${file.buffer.length} bytes)`);

        const { error: uploadError } = await supabase.storage
            .from("assets")
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            return res.status(500).json({ error: "Upload failed" });
        }

        console.log(`${type} storage upload successful`);

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
            console.log("Extracting resume text...");
            const extracted = await extractTextFromResume(file.buffer, file.mimetype);
            console.log(`Resume text extracted: ${extracted.length} chars`);
            updateData.scraped_resume = extracted.substring(0, RESUME_PREVIEW_MAX_LENGTH);

            const chunks = chunkText(extracted);
            console.log(`Resume chunked into ${chunks.length} chunk(s)`);

            const embeddings = await generateBatchEmbeddings(chunks);
            console.log(`Resume embeddings generated: ${embeddings.length}/${chunks.length}`);

            await replaceEmbeddingsForSource("resume", embeddings);
            console.log("Resume embeddings saved to database");
        }

        const { data: profiles, error: profilesError } = await supabase.from("profile").select("*");

        if (profilesError) {
            console.error('Profile lookup error:', profilesError);
            return res.status(500).json({ error: 'Upload succeeded but profile update failed' });
        }

        const { error: saveError } = !profiles.length
            ? await supabase.from("profile").insert([{ id: PROFILE_ID, ...updateData }])
            : await supabase.from("profile").update(updateData).eq("id", profiles[0].id);

        if (saveError) {
            console.error('Profile save error:', saveError);
            return res.status(500).json({ error: 'Upload succeeded but profile update failed' });
        }

        console.log(`${type} upload complete, profile updated`);

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
        const { data, error } = await supabase
            .from("qna")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error('QnA fetch error:', error);
            return res.status(500).json({ error: "Fetch failed" });
        }

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
        const { data, error } = await supabase.from("profile").select("*").maybeSingle();

        if (error) {
            console.error('Profile error:', error);
            return res.status(500).json({ error: "Fetch failed" });
        }

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

        const scrapedText = await scrapeLink(url, type);

        if (!scrapedText)
            return res.status(400).json({ error: "Unable to scrape content." });

        const updateData = {};
        if (type === "github") updateData.scraped_github = scrapedText;
        if (type === "portfolio") updateData.scraped_portfolio = scrapedText;

        const { data: profiles, error: profilesError } = await supabase
            .from("profile")
            .select("id");

        if (profilesError) {
            console.error('Profile lookup error:', profilesError);
            return res.status(500).json({ error: 'Scraping failed' });
        }

        if (profiles.length > 0) {
            const { error: updateError } = await supabase
                .from("profile")
                .update(updateData)
                .eq("id", profiles[0].id);

            if (updateError) {
                console.error('Profile update error:', updateError);
                return res.status(500).json({ error: 'Scraping failed' });
            }
        }

        const chunks = chunkText(scrapedText);
        const embeddings = await generateBatchEmbeddings(chunks);
        await replaceEmbeddingsForSource(type, embeddings);

        res.json({ scrapedText });

    } catch (err) {
        console.error("Manual scrape error:", err);
        res.status(500).json({ error: "Scraping failed" });
    }
};
