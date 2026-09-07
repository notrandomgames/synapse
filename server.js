const express = require('express');
const path = require('path');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, history, imageBase64, mimeType } = req.body;

        // Pulls all keys from GEMINI_API_KEYS environment variable separated by commas
        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || process.env.synapse || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

        if (apiKeys.length === 0) {
            return res.status(500).json({ error: "Missing GEMINI_API_KEYS environment variable." });
        }

        const contents = Array.isArray(history) ? [...history] : [];
        const currentParts = [];

        if (imageBase64 && mimeType) {
            currentParts.push({
                inlineData: { mimeType, data: imageBase64 }
            });
        }
        currentParts.push({ text: prompt || "Analyze this image." });
        contents.push({ role: 'user', parts: currentParts });

        const payload = {
            systemInstruction: {
                parts: [{ 
                    text: "You are an authoritative, helpful, and highly accurate AI assistant. State facts clearly, verify reasoning step-by-step, and explicitly state when you are uncertain." 
                }]
            },
            contents: contents,
            generationConfig: {
                temperature: 0.1,
                topP: 0.8
            }
        };

        const models = [
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.5-flash-lite"
        ];

        let geminiResponse = null;
        let lastError = "";

        keyLoop:
        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const currentKey = apiKeys[keyIndex];

            for (const model of models) {
                try {
                    // Check if key format uses Bearer header (for AQ tokens) or query param (for AIza keys)
                    const isAuthToken = currentKey.startsWith('AQ.');
                    const url = isAuthToken 
                        ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
                        : `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${currentKey}`;

                    const headers = { 'Content-Type': 'application/json' };
                    if (isAuthToken) {
                        headers['Authorization'] = `Bearer ${currentKey}`;
                    }

                    const resp = await fetch(url, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload)
                    });

                    if (resp.ok) {
                        geminiResponse = resp;
                        console.log(`[Success] Key #${keyIndex + 1} connected via ${model}`);
                        break keyLoop;
                    }

                    const status = resp.status;
                    const errText = await resp.text();
                    lastError = `Key #${keyIndex + 1} on ${model} [${status}]: ${errText}`;
                    console.warn(`[API Warning] ${lastError}`);

                    if (status === 429) {
                        await new Promise(r => setTimeout(r, 1500));
                        break; 
                    }
                } catch (err) {
                    console.error(`[Fetch Error] Key #${keyIndex + 1} on ${model}: ${err.message}`);
                    lastError = err.message;
                }
            }
        }

        if (!geminiResponse) {
            console.error(`[Failure] All keys failed. Last error: ${lastError}`);
            return res.status(429).json({ 
                error: "All provided API keys have temporarily reached their free tier quota. Please wait 30 seconds." 
            });
        }

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
                        if (textChunk) res.write(textChunk);
                    } catch (e) {}
                }
            }
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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Synapse server running on port ${PORT}`));
