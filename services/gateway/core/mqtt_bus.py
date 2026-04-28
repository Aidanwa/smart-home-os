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
        
        # aiomqtt client (instantiated during connect)
        self.client: Optional[aiomqtt.Client] = None
        
        # Dictionary to hold our RPC futures. Key: transaction_id, Value: asyncio.Future
        self._pending_rpcs: Dict[str, asyncio.Future] = {}
        
        # Background task reference
        self._listen_task: Optional[asyncio.Task] = None

    async def start(self):
        """Starts the background MQTT listening loop."""
        self._listen_task = asyncio.create_task(self._listen_loop())

    async def stop(self):
        """Cleanly shuts down the bus."""
        if self._listen_task:
            self._listen_task.cancel()
        await self.redis.close()

    async def _listen_loop(self):
        """Main reconnection and message processing loop."""
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
                    
                    # Subscribe to all Zigbee traffic
                    await client.subscribe(f"{self.z2m_base}/#")
                    
                    # Async generator yields messages as they arrive
                    async for message in client.messages:
                        await self._process_message(message)
                        
            except aiomqtt.MqttError as error:
                logger.warning(f"MQTT connection lost: {error}. Reconnecting in {reconnect_interval}s...")
                await asyncio.sleep(reconnect_interval)
            except asyncio.CancelledError:
                logger.info("MQTT listening loop cancelled.")
                break

    async def _process_message(self, message: aiomqtt.Message):
        topic = str(message.topic)
        try:
            payload = json.loads(message.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return 

        topic_parts = topic.split("/")

        logger.info(f"Received MQTT message on topic: {topic} with payload: {payload}")
        
        # 1. Update Digital Twin (Strictly filter for exactly 'base/device_name')
        if len(topic_parts) == 2 and topic_parts[0] == self.z2m_base:
            device_name = topic_parts[1]
            
            # Ignore the bridge's own status updates
            if device_name != "bridge":
                await self.redis.hset("gateway:digital_twin", device_name, json.dumps(payload))
        
        # 2. Resolve pending RPC Requests (Strict Confirmation)
        if isinstance(payload, dict):
            # Check if this message has a transaction ID we are waiting for
            tx_id = payload.get("transaction") or payload.get("id")
            if tx_id and tx_id in self._pending_rpcs:
                if not self._pending_rpcs[tx_id].done():
                    self._pending_rpcs[tx_id].set_result(payload)

    async def rpc(self, topic: str, payload: dict, timeout: float = 5.0) -> dict:
        """
        Publishes a payload with a transaction ID and awaits the corresponding response.
        """
        if not self.client:
            raise RuntimeError("MQTT Client is not connected.")

        # Generate a unique correlation ID
        tx_id = uuid.uuid4().hex[:8]
        payload["transaction"] = tx_id
        
        # Create a Future that will be resolved by _process_message
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending_rpcs[tx_id] = future

        try:
            # Publish the command
            await self.client.publish(topic, json.dumps(payload))
            
            # Pause this function until the Future is resolved or times out
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
            
        except asyncio.TimeoutError:
            raise TimeoutError(f"RPC Timeout waiting for transaction {tx_id} on {topic}")
        finally:
            # Always clean up the memory
            self._pending_rpcs.pop(tx_id, None)

    async def get_digital_twin(self) -> dict:
        """Returns the entire current state of the home from Redis."""
        raw_data = await self.redis.hgetall("gateway:digital_twin")
        return {k: json.loads(v) for k, v in raw_data.items()}