
```mermaid
flowchart TD
    %% Edge and UI
    subgraph Clients["Physical & Web Clients"]
        Edge["Smart Node W/Speaker+Mic<br/>(Pi/ESP32: Wakeword, STT, TTS)"]
        UI["Web Client UI<br/>(React/Vite SPA)"]
    end

    %% Agent Service
    subgraph AgentContainer["Agent Container"]
        Agent["Agent Service<br/>(LLM Orchestrator & Tools)"]
    end

    %% Gateway Service
    subgraph GatewayContainer["Gateway Container"]
        Gateway["Gateway Service<br/>(API, MqttBus, RBAC Logic)"]
    end

    %% Data & Infra
    subgraph Infrastructure["Data & Infrastructure"]
        Postgres[("PostgreSQL<br/>(Users, Roles, Config)")]
        Redis[("Redis<br/>(Digital Twin)")]
        MQTT["MQTT Broker<br/>(Mosquitto / Z2M)"]
        Hardware["Zigbee Hardware<br/>(Lights, Sensors)"]
    end

    %% Flow: Edge/UI to Agent
    Edge -- "JSON: {user_id, text}" --> Agent
    UI -- "REST / WS" --> Agent
    UI -- "WebSockets (State)" --> Gateway

    %% Flow: Agent to Gateway (The Correction)
    Agent -- "1. GET /api/context (State + RBAC)" --> Gateway
    Agent -- "2. POST /api/devices/{name}/set" --> Gateway

    %% Flow: Gateway to Data
    Gateway -- "Read / Write Auth" --> Postgres
    Gateway -- "Read / Write State" --> Redis

    %% Flow: Gateway to Hardware
    Gateway -- "Publish RPC Command" --> MQTT
    MQTT -- "Broadcast State Change" --> Gateway
    MQTT <--> Hardware

    %% Styling
    classDef client fill:#f9f9f9,stroke:#333,stroke-width:2px;
    classDef service fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef db fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;
    classDef broker fill:#fff3e0,stroke:#f57c00,stroke-width:2px;
    
    class Edge,UI client;
    class Agent,Gateway service;
    class Postgres,Redis db;
    class MQTT,Hardware broker;
```