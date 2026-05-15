from root:

Start just the core system: docker compose up -d gateway

Rebuild just the gateway after a code change: docker compose up -d --build gateway

View logs for just the agent: docker compose logs -f agent

