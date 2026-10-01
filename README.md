# Salesforce Headless Bridge + React MCP App UI

This project keeps the existing Salesforce Headless 360 + Revenue Cloud MCP bridge and adds an interactive React MCP App called `show_revenue_workspace`.

## What this first build does

- Renders transcript requirements as a card.
- Always asks the user to use an existing Opportunity or create a new one.
- Collects quote fields in a form.
- Lets the user select quantities and selling models.
- Shows a final review before a write.
- Sends the user's button choice back to Claude as an explicit UI action.
- Requires Claude to execute through the existing Salesforce MCP tools.
- Shows Opportunity, Quote, and final workflow summaries as cards.

The first build deliberately keeps the actual Salesforce write execution in Claude + your existing MCP bridge. That means it does not hard-code your custom Revenue Cloud tool names or schemas. After the UI is rendering correctly, the next iteration can move selected writes into app-only MCP tools if desired.

## Install

```powershell
cd "C:\path\to\salesforce-headless-bridge"
npm install
```

Copy `.env.example` to `.env` only if you do not already have your existing `.env`.

## Authenticate Salesforce

Use the same auth flow you already use:

```powershell
npm run auth
```

## Build the React MCP App

```powershell
npm run build:ui
```

You should get:

```text
dist\mcp-app.html
```

## Start/test the MCP server manually

```powershell
npm run start:server
```

The server still uses stdio, so it is normally launched by Claude rather than used as an HTTP web server.

## Claude Desktop configuration

Keep your existing MCP configuration if it already runs `server.js` from this folder. The important change is that you must run `npm run build:ui` before restarting Claude Desktop.

Typical Windows pattern:

```json
{
  "mcpServers": {
    "salesforce-headless-bridge": {
      "command": "node",
      "args": [
        "--env-file=C:\\path\\to\\salesforce-headless-bridge\\.env",
        "C:\\path\\to\\salesforce-headless-bridge\\server.js"
      ]
    }
  }
}
```

Restart Claude Desktop after changing the server code or MCP configuration.

## Claude Project instructions

Copy the contents of `CLAUDE_PROJECT_INSTRUCTIONS.md` into your Claude Project instructions. This is what makes Claude open the React UI rather than asking for confirmation in prose.

## First test prompt

Use your normal transcript prompt:

```text
Analyze this customer call transcript and identify the requirements.
Suggest the next Salesforce actions.
Use the Revenue Workspace UI for all user choices and confirmations.
```

Expected flow:

1. Claude reads the transcript.
2. Claude performs read-only Salesforce discovery.
3. Claude calls `show_revenue_workspace`.
4. React card appears.
5. You choose existing vs create Opportunity.
6. You configure quote/products.
7. You click Create Quote.
8. Claude executes the existing Salesforce MCP tools.
9. Claude calls `show_revenue_workspace` again with the Quote summary.
10. The card shows the final transaction summary.
