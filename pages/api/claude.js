export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { system, messages } = req.body;

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(200).json({
      content: [{ type: "text", text: "Server error: ANTHROPIC_API_KEY missing hai Vercel mein. Settings > Environment Variables mein add karo aur redeploy karo." }],
    });
  }

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: system,
        messages: messages,
      }),
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      return res.status(200).json({
        content: [{ type: "text", text: `Claude API error (${apiRes.status}): ${msg}` }],
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({
      content: [{ type: "text", text: `Server exception: ${err.message}` }],
    });
  }
}
