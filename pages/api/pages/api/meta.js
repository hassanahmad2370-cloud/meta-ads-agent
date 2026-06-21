const META_API_VERSION = "v21.0";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { path, method, token, body } = req.body;

  if (!path || !token) {
    return res.status(400).json({ error: "Missing path or token" });
  }

  try {
    const url = `https://graph.facebook.com/${META_API_VERSION}/${path}`;
    const isGet = !method || method === "GET";

    const finalUrl = isGet
      ? `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`
      : url;

    const response = await fetch(finalUrl, {
      method: method || "GET",
      headers: isGet ? undefined : { "Content-Type": "application/x-www-form-urlencoded" },
      body: isGet
        ? undefined
        : new URLSearchParams({ ...body, access_token: token }).toString(),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        error: data.error.error_user_msg || data.error.message || "Meta API error",
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
