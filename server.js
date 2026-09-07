const express = require('express');
const path = require('path');

const app = express();

// Handle base64 image uploads
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(__dirname));

// Streaming endpoint for Gemini API with Accuracy Enhancements
app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, imageBase64, mimeType } = req.body;
        const API_KEY = process.env.GEMINI_API_KEY || process.env.synapse;

        if (!API_KEY) {
            return res.status(500).json({ error: "Missing GEMINI_API_KEY environment variable." });
        }

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

        // Accuracy-focused payload configuration
        const payload = {
            systemInstruction: {
                parts: [{ 
                    text: "You are an authoritative, helpful, and highly accurate AI assistant. State facts clearly, double-check logic step-by-step, and do not invent details." 
                }]
            },
            contents: [{ parts }],
            tools: [{ googleSearch: {} }], // Enable Google Search Grounding for real-time facts
            generationConfig: {
                temperature: 0.1, // Near-zero temperature minimizes hallucination
                topP: 0.8
            }
        };

        // Active Gemini models
        const models = [
            "gemini-3.8-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash"
        ];

        let geminiResponse = null;
        let lastError = null;

        for (const model of models) {
            try {
                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (resp.ok) {
                    geminiResponse = resp;
                    break;
                } else {
                    const errText = await resp.text();
                    lastError = `Model ${model} (${resp.status}): ${errText}`;
                    console.warn(lastError);
                }
            } catch (err) {
                lastError = `Model ${model} fetch failed: ${err.message}`;
                console.warn(lastError);
            }
        }

        if (!geminiResponse) {
            return res.status(500).json({ error: lastError || "Failed to connect to Gemini API models." });
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
