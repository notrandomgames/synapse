const express = require('express');
const path = require('path');

const app = express();

// Handle base64 image uploads
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(__dirname));

// Streaming endpoint with Fixed Multi-Key & Model Fallback
app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, imageBase64, mimeType } = req.body;

        // Parse multiple API keys from comma-separated string or single key fallback
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || process.env.synapse || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

        if (apiKeys.length === 0) {
            return res.status(500).json({ error: "Missing GEMINI_API_KEYS environment variable." });
        }

        console.log(`[Synapse] Processing request with ${apiKeys.length} available API key(s)...`);

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

        const payload = {
            systemInstruction: {
                parts: [{ 
                    text: "You are an authoritative, helpful, and highly accurate AI assistant. State facts clearly, double-check logic step-by-step, and do not invent details." 
                }]
            },
            contents: [{ parts }],
            generationConfig: {
                temperature: 0.1,
                topP: 0.8
            }
        };

        // Active Gemini models hierarchy
        const models = [
            "gemini-2.5-flash",
            "gemini-1.5-flash",
            "gemini-2.5-flash-lite"
        ];

        let geminiResponse = null;
        let lastError = null;

        // Loop through keys and fallback models
        keyLoop:
        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const currentKey = apiKeys[keyIndex];

            for (const model of models) {
                try {
                    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${currentKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (resp.ok) {
                        geminiResponse = resp;
                        console.log(`[Success] Connected using Key #${keyIndex + 1} with model ${model}`);
                        break keyLoop; // Successfully connected, break out of all loops
                    }

                    const status = resp.status;
                    const errText = await resp.text();

                    if (status === 429) {
                        console.warn(`[429 Quota Exceeded] Key #${keyIndex + 1} rate limited on ${model}. Switching to next key...`);
                        lastError = `API Key #${keyIndex + 1} exhausted quota.`;
                        break; // Rate limit hit: break model loop to try the next API key immediately
                    }

                    // For non-429 errors (e.g. 404/400), log and continue to next model for the SAME key
                    console.warn(`[${status} Error] Key #${keyIndex + 1} on ${model}: ${errText}`);
                    lastError = `Model ${model} (${status}): ${errText}`;

                } catch (err) {
                    console.warn(`[Fetch Error] Key #${keyIndex + 1} on ${model}: ${err.message}`);
                    lastError = err.message;
                }
            }
        }

        if (!geminiResponse) {
            console.error(`[Failure] All ${apiKeys.length} API keys failed across all models. Last error: ${lastError}`);
            return res.status(429).json({ 
                error: "All provided API keys have temporarily reached their free tier rate limits. Please try again in 30 seconds." 
            });
        }

        // Set streaming headers after confirming connection
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const reader = geminiResponse.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        const textChunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (textChunk) {
                            res.write(textChunk);
                        }
                    } catch (e) {}
                }
            }
        }

        if (buffer.trim().startsWith('data:')) {
            const jsonStr = buffer.trim().slice(5).trim();
            try {
                const parsed = JSON.parse(jsonStr);
                const textChunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textChunk) {
                    res.write(textChunk);
                }
            } catch (e) {}
        }

        res.end();

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.write(`\n[Stream Error: ${error.message}]`);
            res.end();
        }
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
