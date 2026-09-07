const express = require('express');
const path = require('path');

const app = express();

app.use(express.json());
// Serve static frontend files (index.html, styles, client JS)
app.use(express.static(__dirname));

// Backend proxy endpoint for Gemini API
app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt } = req.body;
        const API_KEY = process.env.synapse || process.env.synapse;

        if (!API_KEY) {
            return res.status(500).json({ error: "Missing API key in environment variables." });
        }

        // Active models with fallback logic
        const models = [
            "gemini-3.6-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite"
        ];

        let lastError = null;

        for (const model of models) {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: prompt }]
                        }]
                    })
                });

                const data = await response.json();

                if (!data.error) {
                    return res.json(data);
                }

                lastError = data.error.message || `Error calling ${model}`;
                console.warn(`Model ${model} failed:`, lastError);

            } catch (err) {
                lastError = err.message;
            }
        }

        return res.status(429).json({ 
            error: `Quota exceeded or rate limit reached on Free Tier. (${lastError})` 
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Fallback route to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Synapse server running on port ${PORT}`);
});
