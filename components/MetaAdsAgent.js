"use client";
import { useState, useRef, useEffect } from "react";

const META_API_VERSION = "v21.0";

const SYSTEM_PROMPT = `You are an elite Meta Ads Manager AI Agent. You have deep expertise in Meta Marketing API campaign structure: Campaigns, Ad Sets, and Ads.

The human will give you a business goal in Urdu, Roman Urdu, or English (e.g. "mera ecommerce store ke liye sales campaign banao, budget 2000 PKR daily, target Pakistan 18-35"). They will also usually provide a creative URL (image or video) and ad copy, or ask you to write ad copy yourself.

Your job has two parts in every reply:

1. A short, friendly, expert explanation (in the same language the user wrote in) of the strategy you're using — objective choice, targeting logic, budget reasoning, bid strategy — like a real senior media buyer would explain to a client. Keep this concise and confident.

2. At the very end of your reply, output ONE fenced code block labeled exactly \`\`\`campaign_plan containing ONLY valid JSON (no comments, no trailing text) matching this exact schema:

{
  "ready_to_launch": boolean,
  "missing_info": ["list of questions to ask if ready_to_launch is false, otherwise empty array"],
  "campaign": {
    "name": "string, descriptive, includes date",
    "objective": "one of: OUTCOME_AWARENESS | OUTCOME_TRAFFIC | OUTCOME_ENGAGEMENT | OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_APP_PROMOTION",
    "buying_type": "AUCTION"
  },
  "adset": {
    "name": "string",
    "daily_budget_cents": integer (budget in smallest currency unit, e.g. PKR*100, ask user for currency if unclear and assume their ad account currency),
    "billing_event": "IMPRESSIONS",
    "optimization_goal": "one of: REACH | LINK_CLICKS | LANDING_PAGE_VIEWS | CONVERSATIONS | OFFSITE_CONVERSIONS | THRUPLAY | APP_INSTALLS",
    "bid_strategy": "one of: LOWEST_COST_WITHOUT_CAP | LOWEST_COST_WITH_BID_CAP | COST_CAP",
    "targeting": {
      "geo_locations": { "countries": ["ISO country code(s) like PK"], "cities": ["plain city names like Lahore — empty array if none"] },
      "age_min": integer,
      "age_max": integer,
      "genders": [1] or [2] or [1,2],
      "interests_keywords": ["plain English interest names the user mentioned or implied — agent will resolve these to Meta interest IDs separately"]
    }
  },
  "ad": {
    "name": "string",
    "creative_url": "the image/video URL the user gave, or null if not yet provided",
    "primary_text": "ad copy you write, persuasive, in the user's language",
    "headline": "short headline, max 40 chars",
    "description": "short description, max 30 chars",
    "call_to_action": "one of: LEARN_MORE | SHOP_NOW | SIGN_UP | DOWNLOAD | BOOK_TRAVEL | CONTACT_US | GET_OFFER",
    "destination_url": "landing page URL if user gave one, else null"
  }
}

Rules:
- If the user hasn't given you enough info to launch (no budget, no destination URL, no creative URL, unclear country/audience), set ready_to_launch to false and list exactly what's missing in missing_info, and ask for it conversationally in your text reply too. Do not invent a creative_url or destination_url.
- IMPORTANT — read carefully: when you set ready_to_launch to true, the campaign_plan JSON block you output WILL be read by connected code that immediately calls the real Meta Marketing API and creates the actual Campaign, Ad Set, and Ad on the user's Meta account (in PAUSED status). This is not hypothetical and not future work — outputting this JSON IS the action of creating the campaign. You DO have the ability to create campaigns through this mechanism. NEVER say things like "I can't create campaigns myself," "main khud campaign create nahi kar sakta," "you'll need to create this yourself in Ads Manager," or anything implying you lack this capability — that is false. Once you have all required info, simply confirm you're creating it now (e.g. "Theek hai, campaign create kar raha hoon abhi") and output the JSON with ready_to_launch: true. Do not tell the user to go do it manually elsewhere.
- CRITICAL, NO EXCEPTIONS: every single reply you send, no matter what the user says — even "hi", "thanks", a general question, or small talk — MUST end with a \`\`\`campaign_plan code block. This is a hard technical requirement, not optional. If there is no campaign being discussed yet, still output the block with ready_to_launch: false, missing_info listing what a campaign needs, and empty/null placeholder values for campaign/adset/ad fields (use empty strings, 0, or null — never omit the keys). The code that reads your reply will break if this block is missing. Do not explain or mention this block to the user; it is invisible to them.
- TARGETING & OBJECTIVE (critical so the connected code launches reliably): the connected code always builds a standard LINK ad that sends people to destination_url (usually a wa.me / WhatsApp link). For this to validate on Meta, ALWAYS set campaign.objective to "OUTCOME_TRAFFIC", adset.optimization_goal to "LINK_CLICKS", adset.billing_event to "IMPRESSIONS", and adset.bid_strategy to "LOWEST_COST_WITHOUT_CAP" — unless the user explicitly insists on a different objective. For geo_locations put ISO country codes in "countries" and any specific city as a PLAIN English name in "cities" (e.g. "Lahore"); never invent numeric city keys, the code resolves them automatically. For ad.call_to_action use "CONTACT_US" when the destination is WhatsApp/messaging, otherwise "LEARN_MORE".
- Always be specific with numbers — no vague "test different budgets", give one concrete recommendation.
- Currency: if unknown, ask once and remember the ad account currency isn't known to you; assume the user's daily_budget number is already in their local currency's main unit unless they specify cents.
- Respond in the same language the user writes in.`;

const quickCommands = [
  "Ecommerce sales campaign banao, daily budget 2000, Pakistan, 18-35",
  "Naya lead-gen campaign Karachi ke liye",
  "Is creative ke liye ad copy likho aur campaign banao",
  "Existing campaigns dikhao",
  "Best objective konsa hai brand awareness ke liye?",
  "CBO vs ABO mein farak batao",
];

const OBJECTIVE_LABELS = {
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_LEADS: "Leads",
  OUTCOME_SALES: "Sales",
  OUTCOME_APP_PROMOTION: "App Promotion",
};

function extractPlan(text) {
  const match = text.match(/```campaign_plan\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function stripPlanBlock(text) {
  return text.replace(/```campaign_plan[\s\S]*?```/, "").trim();
}

// ---- Meta Graph API helpers ----
// These now call our own backend route (/api/meta) instead of graph.facebook.com
// directly. The backend route runs server-side on Vercel and has no browser
// sandbox restrictions, so this avoids any NETWORK_BLOCKED issues entirely.
async function metaFetch(path, token, options = {}) {
  let res;
  try {
    res = await fetch("/api/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        token,
        method: options.method || "GET",
        body: options.body,
      }),
    });
  } catch (networkErr) {
    throw new Error(`Apne server se connect nahi ho saka: ${networkErr.message}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server se invalid response mila (HTTP ${res.status}).`);
  }

  if (!res.ok || data.error) {
    throw new Error(data.error || "Meta API error");
  }
  return data;
}

async function verifyAccount(token, adAccountId) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const data = await metaFetch(`${id}?fields=name,account_status,currency,id`, token);
  return data;
}

async function createCampaign(token, adAccountId, plan) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  return metaFetch(`${id}/campaigns`, token, {
    method: "POST",
    body: {
      name: plan.campaign.name,
      objective: "OUTCOME_TRAFFIC", // forced: always compatible with LINK_CLICKS below
      status: "PAUSED",
      special_ad_categories: JSON.stringify([]),
      is_adset_budget_sharing_enabled: false,
    },
  });
}

// Reliable geo targeting. Targeting a city by radius through the Marketing API
// keeps failing Meta's "radius not within bounds" check, so for a PAUSED review
// campaign we target the COUNTRY (default Pakistan). The user narrows down to
// the exact city/radius inside Ads Manager during review (campaign is paused).
async function resolveGeo(token, rawGeo) {
  const countries = [];
  if (rawGeo && Array.isArray(rawGeo.countries)) {
    for (const c of rawGeo.countries) {
      if (typeof c === "string" && c.trim().length === 2) {
        countries.push(c.trim().toUpperCase());
      }
    }
  }
  if (countries.length) return { countries };
  return { countries: ["PK"] };
}

async function createAdSet(token, adAccountId, plan, campaignId) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const t = (plan && plan.adset && plan.adset.targeting) || {};
  const geo = await resolveGeo(token, t.geo_locations);

  const targeting = {
    geo_locations: geo,
    age_min: t.age_min || 18,
    age_max: t.age_max || 65,
  };
  if (Array.isArray(t.genders) && t.genders.length) targeting.genders = t.genders;

  return metaFetch(`${id}/adsets`, token, {
    method: "POST",
    body: {
      name: plan.adset.name,
      campaign_id: campaignId,
      daily_budget: String(Math.max(parseInt(plan.adset.daily_budget_cents, 10) || 0, 30000)),
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS", // forced: matches OUTCOME_TRAFFIC objective
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: JSON.stringify(targeting),
      status: "PAUSED",
    },
  });
}

async function createCreativeAndAd(token, adAccountId, plan, adsetId, pageId) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  // Always build a standard IMAGE link ad. Video ads need a separate upload
  // step (not implemented), so if the creative isn't a usable image URL we fall
  // back to a placeholder image — this guarantees a valid creative every time.
  const isImage = /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(plan.ad.creative_url || "");
  const imageUrl = isImage ? plan.ad.creative_url : "https://via.placeholder.com/1080";

  const objectStorySpec = {
    page_id: pageId,
    link_data: {
      link: plan.ad.destination_url || "https://wa.me/923032760175",
      message: plan.ad.primary_text || "",
      name: plan.ad.headline || "",
      description: plan.ad.description || "",
      picture: imageUrl,
      call_to_action: { type: plan.ad.call_to_action || "LEARN_MORE" },
    },
  };

  const creative = await metaFetch(`${id}/adcreatives`, token, {
    method: "POST",
    body: {
      name: `${plan.ad.name} - Creative`,
      object_story_spec: JSON.stringify(objectStorySpec),
    },
  });

  const ad = await metaFetch(`${id}/ads`, token, {
    method: "POST",
    body: {
      name: plan.ad.name,
      adset_id: adsetId,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: "PAUSED",
    },
  });

  return { creative, ad };
}

export default function MetaAdsAgent() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `🚀 **Meta Ads AI Agent Active!**

Main aapka professional Meta Ads Manager hoon. Pehle apna Meta account connect karo (upar "Connect Meta Account" mein token aur Ad Account ID dalo), phir mujhe command do — main strategy banata hoon aur real campaign Meta mein PAUSED state mein create kar deta hoon (review ke liye, taake galti se koi paisa kharch na ho).

✅ Campaign + Ad Set + Ad — sab automatic
✅ Aap sirf creative URL aur copy/budget batao
✅ Hamesha PAUSED — aap Ads Manager se Activate karo

**Connect karo aur shuru karte hain!**`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);

  const [showConnect, setShowConnect] = useState(true);
  const [accessToken, setAccessToken] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [connection, setConnection] = useState(null); // { name, currency, id }
  const [connectError, setConnectError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, launching]);

  const handleConnect = async () => {
    setConnectError("");
    if (!accessToken.trim() || !adAccountId.trim() || !pageId.trim()) {
      setConnectError("Token, Ad Account ID, aur Page ID teeno chahiye.");
      return;
    }
    setConnecting(true);
    try {
      const acc = await verifyAccount(accessToken.trim(), adAccountId.trim());
      setConnection(acc);
      setShowConnect(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `✅ **Connected!**\n\nAd Account: **${acc.name}** (${acc.id})\nCurrency: **${acc.currency}**\nStatus: ${acc.account_status === 1 ? "Active 🟢" : "Check account status ⚠️"}\n\nAb bolo kya campaign banana hai — objective, budget, audience, aur creative URL ke saath.`,
        },
      ]);
    } catch (err) {
      setConnectError(err.message || "Connection fail hui. Token/Account ID check karo.");
    } finally {
      setConnecting(false);
    }
  };

  const launchCampaign = async (plan) => {
    setLaunching(true);
    const steps = [];
    try {
      steps.push("📋 Campaign bana raha hoon...");
      setMessages((prev) => [...prev, { role: "system-status", content: steps.join("\n") }]);
      const campaign = await createCampaign(accessToken, adAccountId, plan);

      steps.push(`✅ Campaign created — ID: ${campaign.id}`);
      steps.push("📋 Ad Set bana raha hoon (targeting + budget)...");
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "system-status", content: steps.join("\n") };
        return copy;
      });
      const adset = await createAdSet(accessToken, adAccountId, plan, campaign.id);

      steps.push(`✅ Ad Set created — ID: ${adset.id}`);
      steps.push("📋 Creative + Ad bana raha hoon...");
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "system-status", content: steps.join("\n") };
        return copy;
      });
      const { creative, ad } = await createCreativeAndAd(accessToken, adAccountId, plan, adset.id, pageId);

      steps.push(`✅ Ad created — ID: ${ad.id}`);

      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `🎉 **Campaign successfully create ho gaya — PAUSED status mein!**\n\n| Level | Name | ID |\n|---|---|---|\n| Campaign | ${plan.campaign.name} | \`${campaign.id}\` |\n| Ad Set | ${plan.adset.name} | \`${adset.id}\` |\n| Ad | ${plan.ad.name} | \`${ad.id}\` |\n\n⚠️ **Ye PAUSED hai** — Meta Ads Manager mein jaa kar review karo, aur jab satisfied ho to **Active** kar dena. Main ne koi budget abhi tak spend nahi kiya.`,
        };
        return copy;
      });
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `⚠️ **Campaign create karte waqt error aaya:**\n\n${err.message}\n\nApna token, permissions (ads_management), aur Page ID check karo. Agar token expire ho gaya hai to dobara connect karo.`,
        };
        return copy;
      });
    } finally {
      setLaunching(false);
    }
  };

  const sendMessage = async (text) => {
    const userText = text || input.trim();
    if (!userText || loading || launching) return;

    const newMessages = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const apiMessages = newMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: stripPlanBlock(m.content) || m.content }));

      const contextNote = connection
        ? `\n\n(Connected ad account currency: ${connection.currency}, account: ${connection.name})`
        : "\n\n(No Meta account connected yet — still help plan, but mention they need to connect first.)";

      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: SYSTEM_PROMPT + contextNote,
          messages: apiMessages,
        }),
      });

      const data = await response.json();
      const reply =
        data.content?.map((b) => b.text || "").join("\n") ||
        "Koi response nahi mila. Dobara try karo.";

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);

      const plan = extractPlan(reply);
      if (!plan) {
        // No plan block found or it failed to parse as JSON — surface this instead of failing silently
        const hasBlock = /```campaign_plan/.test(reply);
        setMessages((prev) => [
          ...prev,
          {
            role: "system-status",
            content: hasBlock
              ? "⚠️ Debug: campaign_plan block mila lekin JSON parse nahi hua. Dobara try karo."
              : "⚠️ Debug: Claude ne is reply mein koi campaign_plan block bheja hi nahi — sirf advice text diya. Agar aapne sab details (budget, location, creative URL, destination URL) de di hain, to clearly bolo: 'ab is plan ko launch karo' ya zyada direct command do.",
          },
        ]);
      } else if (!plan.ready_to_launch) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system-status",
            content: `⚠️ Debug: Plan ready nahi hai abhi. Missing: ${(plan.missing_info || []).join(", ") || "(wajah specify nahi hui)"}`,
          },
        ]);
      } else if (!connection) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system-status",
            content: "⚠️ Debug: Plan ready hai lekin Meta account connected nahi hai. Pehle Connect karo.",
          },
        ]);
      } else {
        // small delay so the message renders before the launch UI appears
        setTimeout(() => launchCampaign(plan), 400);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ Error aaya. Internet check karo aur dobara try karo.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatMessage = (text) => {
    const clean = stripPlanBlock(text);
    return clean
      .replace(/\|(.+)\|/g, (row) => row) // leave table rows as-is, rendered as plain text below
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code style='background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:4px;font-size:12px'>$1</code>")
      .replace(/\n/g, "<br/>");
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0a1a 0%, #0d1b3e 50%, #0a0a1a 100%)",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "16px",
    }}>
      {/* Header */}
      <div style={{
        width: "100%",
        maxWidth: "800px",
        background: "linear-gradient(135deg, #1877f2 0%, #0d4fb5 100%)",
        borderRadius: "16px 16px 0 0",
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        boxShadow: "0 4px 24px rgba(24,119,242,0.4)",
      }}>
        <div style={{
          width: "48px", height: "48px",
          background: "rgba(255,255,255,0.15)",
          borderRadius: "12px",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "24px",
          backdropFilter: "blur(10px)",
        }}>🤖</div>
        <div>
          <div style={{ color: "#fff", fontWeight: "700", fontSize: "18px", letterSpacing: "-0.3px" }}>
            Meta Ads AI Agent
          </div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "12px", marginTop: "2px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "7px", height: "7px", background: connection ? "#4ade80" : "#fbbf24", borderRadius: "50%", display: "inline-block" }}></span>
            {connection ? `Connected: ${connection.name}` : "Not connected to Meta"}
          </div>
        </div>
        <button
          onClick={() => setShowConnect((v) => !v)}
          style={{
            marginLeft: "auto",
            background: "rgba(255,255,255,0.15)",
            border: "none",
            borderRadius: "8px",
            padding: "8px 14px",
            color: "#fff",
            fontSize: "12px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          {connection ? "⚙️ Account" : "🔌 Connect"}
        </button>
      </div>

      {/* Connect Panel */}
      {showConnect && (
        <div style={{
          width: "100%",
          maxWidth: "800px",
          background: "#111c3a",
          padding: "18px 24px",
          borderLeft: "1px solid rgba(255,255,255,0.05)",
          borderRight: "1px solid rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{ color: "#fff", fontWeight: "600", fontSize: "14px", marginBottom: "12px" }}>
            🔌 Connect Meta Account
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <input
              type="password"
              placeholder="Access Token (ads_management permission)"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Ad Account ID (e.g. act_123456789 or just numbers)"
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Facebook Page ID (for ad creative)"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              style={inputStyle}
            />
            {connectError && (
              <div style={{ color: "#fca5a5", fontSize: "12px" }}>{connectError}</div>
            )}
            <button
              onClick={handleConnect}
              disabled={connecting}
              style={{
                background: connecting ? "rgba(24,119,242,0.4)" : "linear-gradient(135deg, #1877f2, #0d4fb5)",
                border: "none",
                borderRadius: "10px",
                color: "#fff",
                padding: "10px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: connecting ? "not-allowed" : "pointer",
              }}
            >
              {connecting ? "Connecting..." : connection ? "Update Connection" : "Connect"}
            </button>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px", lineHeight: "1.5" }}>
              Token aur Account ID sirf is browser session mein rehte hain, kahin save nahi hote. Sab campaigns <strong>PAUSED</strong> banenge — koi auto-spend nahi hoga.
            </div>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div style={{
        width: "100%",
        maxWidth: "800px",
        background: "#0f172a",
        flex: 1,
        minHeight: "460px",
        maxHeight: "520px",
        overflowY: "auto",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        borderLeft: "1px solid rgba(255,255,255,0.05)",
        borderRight: "1px solid rgba(255,255,255,0.05)",
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
          }}>
            {msg.role !== "user" && (
              <div style={{
                width: "32px", height: "32px",
                background: msg.role === "system-status"
                  ? "rgba(255,255,255,0.08)"
                  : "linear-gradient(135deg, #1877f2, #0d4fb5)",
                borderRadius: "8px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "14px", marginRight: "8px", flexShrink: 0, marginTop: "2px",
              }}>{msg.role === "system-status" ? "⚙️" : "🤖"}</div>
            )}
            <div style={{
              maxWidth: "78%",
              background: msg.role === "user"
                ? "linear-gradient(135deg, #1877f2, #0d4fb5)"
                : msg.role === "system-status"
                  ? "rgba(251,191,36,0.08)"
                  : "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              borderRadius: msg.role === "user" ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
              padding: "12px 16px",
              fontSize: "14px",
              lineHeight: "1.65",
              border: msg.role === "assistant"
                ? "1px solid rgba(255,255,255,0.08)"
                : msg.role === "system-status"
                  ? "1px solid rgba(251,191,36,0.25)"
                  : "none",
              boxShadow: msg.role === "user" ? "0 4px 12px rgba(24,119,242,0.3)" : "none",
              fontFamily: msg.role === "system-status" ? "monospace" : "inherit",
              fontSize: msg.role === "system-status" ? "12.5px" : "14px",
            }}
              dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
            />
            {msg.role === "user" && (
              <div style={{
                width: "32px", height: "32px",
                background: "rgba(255,255,255,0.1)",
                borderRadius: "8px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "14px", marginLeft: "8px", flexShrink: 0, marginTop: "2px",
              }}>👤</div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "32px", height: "32px",
              background: "linear-gradient(135deg, #1877f2, #0d4fb5)",
              borderRadius: "8px",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "14px",
            }}>🤖</div>
            <div style={{
              background: "rgba(255,255,255,0.06)",
              borderRadius: "4px 16px 16px 16px",
              padding: "12px 16px",
              border: "1px solid rgba(255,255,255,0.08)",
              display: "flex", gap: "5px", alignItems: "center",
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: "8px", height: "8px",
                  background: "#1877f2",
                  borderRadius: "50%",
                  animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
              <style>{`@keyframes bounce { 0%,100%{transform:translateY(0);opacity:.4} 50%{transform:translateY(-6px);opacity:1} }`}</style>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick Commands */}
      <div style={{
        width: "100%",
        maxWidth: "800px",
        background: "#0b1220",
        padding: "12px 16px",
        borderLeft: "1px solid rgba(255,255,255,0.05)",
        borderRight: "1px solid rgba(255,255,255,0.05)",
      }}>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.8px" }}>
          ⚡ Quick Commands
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {quickCommands.map((cmd, i) => (
            <button
              key={i}
              onClick={() => sendMessage(cmd)}
              disabled={loading || launching}
              style={{
                background: "rgba(24,119,242,0.12)",
                border: "1px solid rgba(24,119,242,0.3)",
                color: "#93c5fd",
                borderRadius: "20px",
                padding: "5px 12px",
                fontSize: "12px",
                cursor: loading || launching ? "not-allowed" : "pointer",
                opacity: loading || launching ? 0.5 : 1,
                transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}
              onMouseOver={e => { if (!loading) { e.target.style.background = "rgba(24,119,242,0.25)"; e.target.style.borderColor = "#1877f2"; } }}
              onMouseOut={e => { e.target.style.background = "rgba(24,119,242,0.12)"; e.target.style.borderColor = "rgba(24,119,242,0.3)"; }}
            >
              {cmd.length > 36 ? cmd.slice(0, 34) + "…" : cmd}
            </button>
          ))}
        </div>
      </div>

      {/* Input Area */}
      <div style={{
        width: "100%",
        maxWidth: "800px",
        background: "#0b1220",
        borderRadius: "0 0 16px 16px",
        padding: "16px",
        borderLeft: "1px solid rgba(255,255,255,0.05)",
        borderRight: "1px solid rgba(255,255,255,0.05)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        gap: "10px",
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Command do... jaise: 'Sales campaign banao, budget 2000, Pakistan, creative URL: ...'"
          disabled={loading || launching}
          rows={2}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            color: "#f1f5f9",
            padding: "12px 14px",
            fontSize: "14px",
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            lineHeight: "1.5",
            transition: "border-color 0.2s",
          }}
          onFocus={e => e.target.style.borderColor = "rgba(24,119,242,0.6)"}
          onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || launching || !input.trim()}
          style={{
            background: loading || launching || !input.trim()
              ? "rgba(24,119,242,0.3)"
              : "linear-gradient(135deg, #1877f2, #0d4fb5)",
            border: "none",
            borderRadius: "10px",
            color: "#fff",
            width: "50px",
            cursor: loading || launching || !input.trim() ? "not-allowed" : "pointer",
            fontSize: "20px",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: loading || launching || !input.trim() ? "none" : "0 4px 12px rgba(24,119,242,0.4)",
          }}
        >
          {loading || launching ? "⏳" : "➤"}
        </button>
      </div>

      <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "11px", marginTop: "12px", textAlign: "center" }}>
        Meta Ads AI Agent • Powered by Claude AI • Campaigns launch PAUSED for safety
      </div>
    </div>
  );
}

const inputStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#f1f5f9",
  padding: "10px 12px",
  fontSize: "13px",
  outline: "none",
  fontFamily: "inherit",
};
