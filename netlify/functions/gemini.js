exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { prompt } = JSON.parse(event.body);
        const API_KEY = process.env.GEMINI_API_KEY || process.env.synapse;

        if (!API_KEY) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Missing API key in Netlify environment variables." })
            };
        }

        // List active models and fallback variants
        const models = [
            "gemini-3.6-flash",
            "gemini-3.6-pro"
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
                    return {
                        statusCode: 200,
                        body: JSON.stringify(data)
                    };
                }

                lastError = data.error.message || `Error calling ${model}`;
                console.warn(`Model ${model} failed:`, lastError);

            } catch (err) {
                lastError = err.message;
            }
        }

        return {
            statusCode: 429,
            body: JSON.stringify({ error: `Rate limit reached or quota exceeded. ${lastError}` })
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
