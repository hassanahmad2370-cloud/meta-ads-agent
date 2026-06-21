# Meta Ads AI Agent

An AI-powered agent that connects to your Meta (Facebook/Instagram) Ads account
and creates campaigns automatically based on natural-language commands.

## How it works

1. Connect your Meta Access Token, Ad Account ID, and Page ID
2. Describe the campaign you want (objective, budget, audience, creative URL)
3. The AI builds a campaign plan and creates the real Campaign → Ad Set → Ad
   on Meta, always in **PAUSED** status for your review before spending begins

## Environment Variables (set these in Vercel)

- `ANTHROPIC_API_KEY` — your Anthropic API key from console.anthropic.com

## Deploy

This is a standard Next.js app. Deploy directly to Vercel by importing this
repository — no other configuration needed beyond the environment variable above.
