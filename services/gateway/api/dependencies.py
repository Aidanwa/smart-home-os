from fastapi import Request
from core.mqtt_bus import AsyncMqttBus

def get_mqtt_bus(request: Request) -> AsyncMqttBus:
    """Retrieves the active MQTT Bus from the FastAPI application state."""
    return request.app.state.bus


"""
In FastAPI, it's safer to use Dependency Injection via the Request object. 
This ensures your routes are easy to test and never access uninitialized variables.
"""