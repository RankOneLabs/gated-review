# Deployment

gated-review runs as a single Docker Compose service on **willie**, the always-on
infrastructure NUC. Agent MCP clients connect over Tailscale MagicDNS; the GitHub App
private key lives only on willie and is never sent to a client.

## Transport

The server speaks **Streamable HTTP MCP** (spec §4). Every MCP interaction goes through:

```
http://willie:3555/mcp
```

Clients POST to `/mcp` to initialize a session and then exchange JSON-RPC messages.
No TLS termination, no reverse proxy — direct port access over the Tailscale tailnet,
consistent with homelab conventions.

## Willie compose service

The service is defined in `machines/willie/docker-compose.yml` in the springfield repo
and built from `~/apps/gated-review` on willie.

```yaml
gated-review:
  build: ~/apps/gated-review
  container_name: gated-review
  restart: unless-stopped
  ports:
    - "3555:3555"
  volumes:
    - ~/apps/gated-review/keys/private-key.pem:/run/secrets/gated-review-key:ro
  environment:
    GITHUB_APP_PRIVATE_KEY_PATH: /run/secrets/gated-review-key
  env_file:
    - ~/apps/gated-review/.env
  networks:
    - springfield
```

## ~/apps/gated-review layout on willie

```
~/apps/gated-review/
├── (git clone of this repo — pulled via ssh -A from otto)
├── keys/
│   └── private-key.pem     # GitHub App private key — willie only, never committed
└── .env                    # runtime configuration — see below
```

## Environment file (~/apps/gated-review/.env)

```dotenv
GITHUB_APP_ID=<numeric app id>
GITHUB_APP_INSTALLATION_ID=<numeric installation id>
GATED_REVIEW_HTTP_PORT=3555

# Optional overrides — omit for github.com defaults
# GITHUB_API_BASE_URL=https://api.github.com
# GITHUB_GRAPHQL_URL=https://api.github.com/graphql
# GITHUB_COPILOT_REVIEWER_LOGIN=copilot[bot]
```

`GITHUB_APP_PRIVATE_KEY_PATH` is set in the compose `environment:` block (not the
`.env` file) so it always points at the mounted secret path regardless of what the
`.env` file contains.

## Private key

The GitHub App private key lives **only on willie** at
`~/apps/gated-review/keys/private-key.pem`. It is bind-mounted read-only into the
container at `/run/secrets/gated-review-key`. It is never included in the Docker image,
never present in the compose file, and never sent to an agent client.

## No server operator surface

There is **no operator HTTP port** and no second service. Operator actions (approving
merges, requesting Copilot reviews) are performed directly on GitHub. The server exposes
only the agent MCP endpoint.

## First deploy

On willie:

```sh
# 1. Clone the repo
git clone git@github.com:rankonelabs/gated-review.git ~/apps/gated-review

# 2. Place the GitHub App private key
mkdir -p ~/apps/gated-review/keys
# copy private-key.pem to ~/apps/gated-review/keys/private-key.pem
chmod 600 ~/apps/gated-review/keys/private-key.pem

# 3. Create the env file
cat > ~/apps/gated-review/.env <<EOF
GITHUB_APP_ID=<app-id>
GITHUB_APP_INSTALLATION_ID=<installation-id>
GATED_REVIEW_HTTP_PORT=3555
EOF

# 4. Deploy
cd ~/apps/springfield/machines/willie
docker compose up -d --build gated-review
```

## Updates

```sh
# On willie — pull new image and restart
cd ~/apps/gated-review && git pull
cd ~/apps/springfield/machines/willie && docker compose up -d --build gated-review
```

## MCP client registration

Register the endpoint in any MCP-capable client. The client holds only the address —
no GitHub credential is required or accepted.

### Claude Code (.mcp.json)

```json
{
  "mcpServers": {
    "gated-review": {
      "type": "http",
      "url": "http://willie:3555/mcp"
    }
  }
}
```

Place this `.mcp.json` in the project root (or in `~/.claude/`) and Claude Code will
connect automatically. Any number of clients can connect simultaneously; each gets an
independent session.

### Programmatic (TypeScript / MCP SDK)

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://willie:3555/mcp')
);
const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);
```

## Acceptance validation

**#4 — Reachable, ≥2 concurrent clients**

```sh
# From any machine on the Tailscale tailnet:
curl -s http://willie:3555/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
# Expect: 200 with a JSON-RPC result and an mcp-session-id header

# Open two separate sessions concurrently to confirm >=2 clients:
# run the above in two terminal tabs simultaneously
```

**#7 — No credential on any agent client**

The `.mcp.json` example above contains only `"url": "http://willie:3555/mcp"`. No
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, or any other GitHub credential appears in any
client config. Credentials live on willie only (mounted key file + env file) and are
loaded at server startup, never forwarded to callers.
