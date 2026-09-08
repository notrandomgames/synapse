const express = require('express');
const path = require('path');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, history } = req.body;

        const groqKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || process.env.synapse || "").split(',').map(k => k.trim()).filter(Boolean);
        const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.synapse || "";

        // Keep ONLY the last 2 messages to prevent exceeding Groq's 6,000 TPM limit
        const recentHistory = Array.isArray(history) ? history.slice(-2) : [];
        
        const messages = [
            { role: "system", content: "You are an authoritative, concise, and helpful AI assistant." }
        ];

        recentHistory.forEach(h => {
            messages.push({
                role: h.role === 'model' ? 'assistant' : 'user',
                content: h.parts?.[0]?.text || ""
            });
        });
        messages.push({ role: "user", content: prompt || "Hello" });

        let streamedResponse = null;

        // 1. Try Groq First
        for (const key of groqKeys) {
            try {
                const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: "llama-3.1-8b-instant",
                        messages: messages,
                        temperature: 0.1,
                        stream: true,
                        max_tokens: 1024
                    })
                });

                if (resp.ok) {
                    streamedResponse = resp;
                    console.log("[Success] Connected via Groq.");
                    break;
                }
            } catch (err) {
                console.warn("[Groq Warning]:", err.message);
            }
        }

        // 2. Fall back to OpenRouter Free Tier if Groq is rate-limited
        if (!streamedResponse && openRouterKey) {
            try {
                const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openRouterKey}`,
                        'HTTP-Referer': 'https://synapse.app',
                        'X-Title': 'Synapse'
                    },
                    body: JSON.stringify({
                        model: "meta-llama/llama-3.3-70b-instruct:free",
                        messages: messages,
                        stream: true
                    })
                });

                if (resp.ok) {
                    streamedResponse = resp;
                    console.log("[Success] Connected via OpenRouter Fallback.");
                }
            } catch (err) {
                console.warn("[OpenRouter Warning]:", err.message);
            }
        }

        if (!streamedResponse) {
            return res.status(429).json({ 
                error: "All free tier rate limits hit. Wait 15 seconds or add a payment card at console.groq.com to unlock 250,000 TPM." 
            });
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const reader = streamedResponse.body.getReader();
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
