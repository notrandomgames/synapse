exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { prompt } = JSON.parse(event.body);
        // Supports both variable names
        const API_KEY = process.env.GEMINI_API_KEY || process.env.synapse;

        if (!API_KEY) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Missing API key in Netlify environment variables." })
            };
        }

        // Updated model endpoint to gemini-3.6-flash
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            })
        });

        const data = await response.json();

        if (data.error) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: data.error.message || "Gemini API error" })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
