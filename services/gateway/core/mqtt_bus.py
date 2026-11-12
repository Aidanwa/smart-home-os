import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
import aiomqtt
import redis.asyncio as redis
from typing import Callable, Optional, Dict, Any

from core.device_settings import summarize_settings

logger = logging.getLogger(__name__)

# category: Z2M marks settings "config" and housekeeping "diagnostic"; the routine pickers hide those by default.
_EXPOSE_KEYS = ("property", "type", "unit", "values", "value_on", "value_off", "value_min", "value_max", "category")


def summarize_exposes(devices: list) -> dict:
    """{ieee: [{property, type, unit, values, ...}]} for the properties each device publishes.
    Composite/list exposes (e.g. colour x/y) are skipped: their values are objects, not scalars.
    Z2M tags only some settings with category "config", so an untagged top-level property that can
    be set (access bit 2) counts as one too. A light's or plug's own controls (state, brightness) sit
    inside its typed group (light/switch/...) and stay readings; sensor readings are read-only."""
    def flat(exposes, nested=False):
        for e in exposes:
            if not isinstance(e, dict) or e.get("type") in ("composite", "list"):
                continue
            if e.get("features"):
                yield from flat(e["features"], nested=True)
            elif e.get("property") and e.get("access", 1) & 1 and e["property"] != "linkquality":
                item = {k: e[k] for k in _EXPOSE_KEYS if k in e}
                if not item.get("category") and not nested and e.get("access", 1) & 2:
                    item["category"] = "config"
                yield item

    out = {}
    for d in devices:
        if isinstance(d, dict) and d.get("ieee_address") and d.get("type") != "Coordinator":
            props = list(flat((d.get("definition") or {}).get("exposes") or []))
            if props:
                out[d["ieee_address"]] = props
    return out


def summarize_device_meta(devices: list) -> dict:
    """{ieee: {...}} identity, firmware and pairing health from bridge/devices (no endpoints/exposes)."""
    out = {}
    for d in devices:
        if not isinstance(d, dict) or not d.get("ieee_address") or d.get("type") == "Coordinator":
            continue
        definition = d.get("definition") or {}
        interview = d.get("interview_state")  # Z2M 2.x; older versions only have the booleans
        if not interview:
            interview = ("IN_PROGRESS" if d.get("interviewing")
                         else "SUCCESSFUL" if d.get("interview_completed") else "FAILED")
        out[d["ieee_address"]] = {
            "vendor": definition.get("vendor"),
            "model": definition.get("model"),
            "description": definition.get("description"),
            "supports_ota": definition.get("supports_ota"),
            "manufacturer": d.get("manufacturer"),
            "model_id": d.get("model_id"),
            "type": d.get("type"),
            "power_source": d.get("power_source"),
            "software_build_id": d.get("software_build_id"),
            "date_code": d.get("date_code"),
            "interview_state": interview,
            "supported": d.get("supported"),
            "disabled": d.get("disabled", False),
        }
    return out


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
        # Device RPCs correlate on friendly_name, so only one may be in flight per device.
        self._device_rpc_locks: Dict[str, asyncio.Lock] = {}
        # Optional per-RPC filter: a device reply resolves the RPC only if this returns True, so
        # stale or duplicate reports in between are skipped (see device_control.set_device).
        self._rpc_accept: Dict[str, Callable[[dict], bool]] = {}
        self._listen_task: Optional[asyncio.Task] = None

        # A local memory cache of group names to filter the Digital Twin
        self._known_groups = set()

        # High-speed memory cache mapping friendly_name to ieee_address
        self._device_registry: Dict[str, str] = {}

        # Websocket subscribers to push real time updates to the frontend
        self._subscribers: set[asyncio.Queue] = set()

    async def start(self):
        self._listen_task = asyncio.create_task(self._listen_loop())

    async def stop(self):
        if self._listen_task:
            self._listen_task.cancel()
            # Wait for the task to fully clean up the aiomqtt client
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
                
        if self.redis:
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
                        # A single bad message (or a transient Redis error) must never
                        # kill the listener, or the twin silently goes stale forever.
                        try:
                            await self._process_message(message)
                        except Exception:
                            logger.exception(f"Failed to process MQTT message on topic '{message.topic}'")

            except aiomqtt.MqttError as error:
                logger.warning(f"MQTT connection lost: {error}. Reconnecting in {reconnect_interval}s...")
                await asyncio.sleep(reconnect_interval)
            except asyncio.CancelledError:
                break
            except Exception:
                # Anything unexpected at the connection level: log and reconnect rather than die.
                logger.exception(f"Unexpected MQTT listener error. Reconnecting in {reconnect_interval}s...")
                await asyncio.sleep(reconnect_interval)
            finally:
                # Don't let routes publish into a dead client between reconnects.
                self.client = None

    def subscribe(self) -> asyncio.Queue:
        """Returns a queue that receives all digital twin updates."""
        q = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)

    def broadcast(self, msg: dict):
        """Push a message to every subscriber queue (the /api/ws clients, later the scheduler)."""
        for q in list(self._subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

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

                # Broadcast Group Changes to the Frontend
                self.broadcast({"type": "groups_update", "groups": payload})
        
        # Catch the heavy info payload so we never have to RPC for it
        if topic == f"{self.z2m_base}/bridge/info":
            await self.redis.set("gateway:bridge_info", json.dumps(payload))

        # 0.6 Capture Bridge Devices (Topology Sync)
        if topic == f"{self.z2m_base}/bridge/devices":
            if not isinstance(payload, list):
                return
                
            new_registry = {}
            for device in payload:
                # Skip the coordinator itself as it doesn't have a normal state
                if device.get("type") == "Coordinator":
                    continue
                
                friendly_name = device.get("friendly_name")
                ieee_address = device.get("ieee_address")
                
                if friendly_name and ieee_address:
                    new_registry[friendly_name] = ieee_address
            
            # Update our fast in-memory registry
            self._device_registry = new_registry

            # Property metadata (type, unit, allowed values) for the routine editor's pickers
            await self.redis.set("gateway:device_exposes", json.dumps(summarize_exposes(payload)))

            # Identity, firmware and health per device, for the device drawer's About section
            await self.redis.set("gateway:device_meta", json.dumps(summarize_device_meta(payload)))

            # Each device's own settings and read-only details, for the drawer's "All settings"
            await self.redis.set("gateway:device_settings", json.dumps(summarize_settings(payload)))

            # The Diff Engine: Sync Redis Topology
            current_twin = await self.redis.hgetall("gateway:digital_twin")
            
            for ieee_address, state_str in current_twin.items():
                
                # Check if the device was completely removed from the network
                is_deleted = ieee_address not in new_registry.values()
                
                if is_deleted:
                    logger.info(f"Device removed from network: IEEE {ieee_address}")
                    await self.redis.hdel("gateway:digital_twin", ieee_address)
                    continue
                
                # Check if the device was renamed
                try:
                    state_obj = json.loads(state_str)
                except json.JSONDecodeError:
                    continue
                
                # Find the current true friendly name for this ieee_address
                new_friendly_name = next(
                    (name for name, ieee in new_registry.items() if ieee == ieee_address), 
                    None
                )
                
                old_friendly_name = state_obj.get("friendly_name")

                if new_friendly_name and old_friendly_name != new_friendly_name:
                    logger.info(f"Device renamed in Twin: {old_friendly_name} -> {new_friendly_name}")
                    # Simply update the property and save it back to the exact same IEEE key
                    state_obj["friendly_name"] = new_friendly_name
                    await self.redis.hset("gateway:digital_twin", ieee_address, json.dumps(state_obj))

        # 1. Update Digital Twin & Resolve Device Futures
        if len(topic_parts) == 2 and topic_parts[0] == self.z2m_base:
            device_name = topic_parts[1]
            
            # Ignore the bridge AND any known groups
            if device_name != "bridge" and device_name not in self._known_groups:
                
                ieee_address = self._device_registry.get(device_name)
                
                # Determine the primary key for Redis & Frontend (Fallback to name if IEEE is somehow missing)
                twin_key = ieee_address if ieee_address else device_name

                if ieee_address:
                    payload["ieee_address"] = ieee_address
                    payload["friendly_name"] = device_name

                # Presence/motion sensors: remember when the reading last flipped, so the UI and
                # the agent can say "empty for 2 hours". Z2M resends the full state each time, so
                # carry the previous timestamp over while the value is unchanged.
                watched = "presence" if "presence" in payload else "occupancy" if "occupancy" in payload else None
                if watched and isinstance(payload, dict):
                    prev_raw = await self.redis.hget("gateway:digital_twin", twin_key)
                    prev = json.loads(prev_raw) if prev_raw else {}
                    if prev.get(watched) == payload[watched] and prev.get("presence_changed_at"):
                        payload["presence_changed_at"] = prev["presence_changed_at"]
                    else:
                        payload["presence_changed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

                logger.debug(f"Updating digital twin for {twin_key} ({device_name}): {payload}")
                await self.redis.hset("gateway:digital_twin", twin_key, json.dumps(payload))

                # Broadcast to UI using the IEEE address so it maps perfectly
                self.broadcast({"type": "device_update", "device": twin_key, "state": payload})
                
                # If we were waiting on a device state change via RPC, resolve it using the reference name!
                if device_name in self._pending_rpcs:
                    if not self._pending_rpcs[device_name].done():
                        accept = self._rpc_accept.get(device_name)
                        try:
                            wanted = accept is None or accept(payload)
                        except Exception:
                            wanted = True
                        if wanted:
                            self._pending_rpcs[device_name].set_result(payload)
        
        # 2. Resolve pending Bridge RPC Requests via Transaction ID,
        #    explicitly ignore '/request/' topics to ignore outgoing msg we publish
        if isinstance(payload, dict) and "/request/" not in topic:
            tx_id = payload.get("transaction") or payload.get("id")
            if tx_id and tx_id in self._pending_rpcs:
                if not self._pending_rpcs[tx_id].done():
                    self._pending_rpcs[tx_id].set_result(payload)

    async def rpc(self, topic: str, payload: dict, timeout: float = 5.0,
                  accept: Optional[Callable[[dict], bool]] = None) -> dict:
        """Publish and wait for the reply. `accept` (device RPCs only): resolve only on a state
        report it returns True for; other reports in between are ignored until the timeout."""
        if not self.client:
            raise RuntimeError("MQTT Client is not connected.")

        # Check if this is a bridge request or a hardware device request
        is_bridge_request = topic.startswith(f"{self.z2m_base}/bridge/request/")

        if is_bridge_request:
            # Bridge requests safely support custom transaction IDs, so they never collide
            correlation_key = uuid.uuid4().hex[:8]
            payload["transaction"] = correlation_key
            return await self._publish_and_wait(topic, payload, correlation_key, timeout)

        # Device sets error out if injected with unknown fields, so we correlate on the
        # friendly_name instead. Topic format: zigbee2mqtt/Bedroom1/set -> 'Bedroom1'.
        # Two concurrent sets to the same device would share that key (the second would
        # overwrite the first's future and the first would time out), so serialize them.
        correlation_key = topic.split("/")[1]
        lock = self._device_rpc_locks.setdefault(correlation_key, asyncio.Lock())
        async with lock:
            return await self._publish_and_wait(topic, payload, correlation_key, timeout, accept)

    async def _publish_and_wait(self, topic: str, payload: dict, correlation_key: str, timeout: float,
                                accept: Optional[Callable[[dict], bool]] = None) -> dict:
        # Re-check inside the lock: the client may have dropped while we were queued
        if not self.client:
            raise RuntimeError("MQTT Client is not connected.")

        future = asyncio.get_running_loop().create_future()
        self._pending_rpcs[correlation_key] = future
        if accept is not None:
            self._rpc_accept[correlation_key] = accept
        else:
            self._rpc_accept.pop(correlation_key, None)

        try:
            await self.client.publish(topic, json.dumps(payload))
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f"RPC Timeout waiting for {correlation_key} on {topic}")
        finally:
            # Only remove our own future, never a newer one registered under the same key
            if self._pending_rpcs.get(correlation_key) is future:
                self._pending_rpcs.pop(correlation_key, None)
                self._rpc_accept.pop(correlation_key, None)

    async def get_digital_twin(self) -> dict:
        raw_data = await self.redis.hgetall("gateway:digital_twin")
        return {k: json.loads(v) for k, v in raw_data.items()}