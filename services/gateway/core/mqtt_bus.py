import asyncio
import json
import logging
import uuid
import aiomqtt
import redis.asyncio as redis
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class AsyncMqttBus:
    def __init__(self, mqtt_host: str, mqtt_port: int, mqtt_username: str | None, 
                 mqtt_password: str | None, redis_url: str, z2m_base: str = "zigbee2mqtt"):
        self.mqtt_host = mqtt_host
        self.mqtt_port = mqtt_port
        self.z2m_base = z2m_base
        self.mqtt_username = mqtt_username
        self.mqtt_password = mqtt_password
        
        # Redis client
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.client: Optional[aiomqtt.Client] = None
        
        # Holds our RPC futures. Key: transaction_id OR friendly_name, Value: asyncio.Future
        self._pending_rpcs: Dict[str, asyncio.Future] = {}
        self._listen_task: Optional[asyncio.Task] = None

        # A local memory cache of group names to filter the Digital Twin
        self._known_groups = set()

    async def start(self):
        self._listen_task = asyncio.create_task(self._listen_loop())

    async def stop(self):
        if self._listen_task:
            self._listen_task.cancel()
        await self.redis.close()

    async def _listen_loop(self):
        reconnect_interval = 3
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=self.mqtt_host, 
                    port=self.mqtt_port,
                    username=self.mqtt_username,
                    password=self.mqtt_password
                ) as client:
                    self.client = client
                    logger.info("Connected to MQTT Broker")
                    await client.subscribe(f"{self.z2m_base}/#")
                    
                    async for message in client.messages:
                        await self._process_message(message)
                        
            except aiomqtt.MqttError as error:
                logger.warning(f"MQTT connection lost: {error}. Reconnecting in {reconnect_interval}s...")
                await asyncio.sleep(reconnect_interval)
            except asyncio.CancelledError:
                break

    async def _process_message(self, message: aiomqtt.Message):
        topic = str(message.topic)
        try:
            payload = json.loads(message.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return 

        topic_parts = topic.split("/")

        # 0.5 Capture Bridge Configuration (Retained Topics)
        if topic == f"{self.z2m_base}/bridge/groups":
            await self.redis.set("gateway:groups", json.dumps(payload))
            if isinstance(payload, list):
                self._known_groups = {g.get("friendly_name") for g in payload if isinstance(g, dict)}
            
        # Catch the heavy info payload so we never have to RPC for it
        if topic == f"{self.z2m_base}/bridge/info":
            await self.redis.set("gateway:bridge_info", json.dumps(payload))

        # 1. Update Digital Twin & Resolve Device Futures
        if len(topic_parts) == 2 and topic_parts[0] == self.z2m_base:
            device_name = topic_parts[1]
            
            # Ignore the bridge AND any known groups
            if device_name != "bridge" and device_name not in self._known_groups:
                await self.redis.hset("gateway:digital_twin", device_name, json.dumps(payload))
                
                # If we were waiting on a device state change via RPC, resolve it!
                if device_name in self._pending_rpcs:
                    if not self._pending_rpcs[device_name].done():
                        self._pending_rpcs[device_name].set_result(payload)
        
        # 2. Resolve pending Bridge RPC Requests via Transaction ID,
        #    explicitly ignore '/request/' topics to ignore outgoing msg we publish
        if isinstance(payload, dict) and "/request/" not in topic:
            tx_id = payload.get("transaction") or payload.get("id")
            if tx_id and tx_id in self._pending_rpcs:
                if not self._pending_rpcs[tx_id].done():
                    self._pending_rpcs[tx_id].set_result(payload)

    async def rpc(self, topic: str, payload: dict, timeout: float = 5.0) -> dict:
        if not self.client:
            raise RuntimeError("MQTT Client is not connected.")

        loop = asyncio.get_running_loop()
        future = loop.create_future()
        
        # Check if this is a bridge request or a hardware device request
        is_bridge_request = topic.startswith(f"{self.z2m_base}/bridge/request/")
        
        if is_bridge_request:
            # Bridge requests safely support custom transaction IDs
            correlation_key = uuid.uuid4().hex[:8]
            payload["transaction"] = correlation_key
        else:
            # Device sets error out if injected with unknown fields.
            # Instead, we extract the friendly_name and use that as the correlation key.
            # Topic format: zigbee2mqtt/Bedroom1/set -> Extract 'Bedroom1'
            correlation_key = topic.split("/")[1]  

        self._pending_rpcs[correlation_key] = future

        try:
            await self.client.publish(topic, json.dumps(payload))
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            raise TimeoutError(f"RPC Timeout waiting for {correlation_key} on {topic}")
        finally:
            self._pending_rpcs.pop(correlation_key, None)

    async def get_digital_twin(self) -> dict:
        raw_data = await self.redis.hgetall("gateway:digital_twin")
        return {k: json.loads(v) for k, v in raw_data.items()}