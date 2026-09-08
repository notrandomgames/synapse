const express = require('express');
const path = require('path');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, history } = req.body;

        // Pulls all Groq API keys from GROQ_API_KEYS environment variable separated by commas
        const rawKeys = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

        if (apiKeys.length === 0) {
            return res.status(500).json({ error: "Missing GROQ_API_KEYS environment variable." });
        }

        // Format history for OpenAI-compatible chat completion structure
        const messages = [
            { role: "system", content: "You are an authoritative, helpful, and highly accurate AI assistant. State facts clearly, verify reasoning step-by-step, and explicitly state when you are uncertain." }
        ];

        if (Array.isArray(history)) {
            history.forEach(h => {
                messages.push({
                    role: h.role === 'model' ? 'assistant' : 'user',
                    content: h.parts?.[0]?.text || ""
                });
            });
        }
        messages.push({ role: "user", content: prompt || "Hello" });

        const payload = {
            model: "llama-3.3-70b-versatile", // High-performance open-weight model on Groq
            messages: messages,
            temperature: 0.1,
            stream: true
        };

        let groqResponse = null;
        let lastError = "";

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const currentKey = apiKeys[keyIndex];

            try {
                const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${currentKey}`
                    },
                    body: JSON.stringify(payload)
                });

                if (resp.ok) {
                    groqResponse = resp;
                    console.log(`[Groq Success] Key #${keyIndex + 1} connected successfully.`);
                    break;
                }

                const status = resp.status;
                const errText = await resp.text();
                lastError = `Key #${keyIndex + 1} [${status}]: ${errText}`;
                console.warn(`[Groq Warning] ${lastError}`);

                if (status === 429) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            } catch (err) {
                console.error(`[Groq Fetch Error] Key #${keyIndex + 1}: ${err.message}`);
                lastError = err.message;
            }
        }

        if (!groqResponse) {
            console.error(`[Failure] All Groq keys failed. Last error: ${lastError}`);
            return res.status(429).json({ 
                error: "All provided Groq API keys have reached their rate limits. Please try again shortly." 
            });
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const reader = groqResponse.body.getReader();
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
                        const textChunk = parsed.choices?.[0]?.delta?.content;
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
