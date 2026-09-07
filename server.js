app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, imageBase64, mimeType } = req.body;
        const API_KEY = process.env.GEMINI_API_KEY || process.env.synapse;

        if (!API_KEY) {
            return res.status(500).json({ error: "Missing API key in environment variables." });
        }

        const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
        let lastError = null;

        // Build Gemini multimodal request contents payload
        const parts = [];
        if (imageBase64 && mimeType) {
            parts.push({
                inlineData: {
                    mimeType: mimeType,
                    data: imageBase64
                }
            });
        }
        parts.push({ text: prompt || "Analyze this image." });

        const payload = { contents: [{ parts }] };

        for (const model of models) {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                if (!data.error) return res.json(data);

                lastError = data.error.message || `Error calling ${model}`;
                console.warn(`Model ${model} failed:`, lastError);
            } catch (err) {
                lastError = err.message;
            }
        }

        return res.status(429).json({ error: `Quota exceeded or rate limit reached. (${lastError})` });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
