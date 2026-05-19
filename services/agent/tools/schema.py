# src/tools/schema.py

SMART_HOME_TOOLS = [
    {
        "name": "set_device_state",
        "description": "Changes the physical state of a smart home device (e.g., turning lights on/off, changing brightness or color).",
        "parameters": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "The exact friendly_name of the device from the context."
                },
                "state_changes": {
                    "type": "object",
                    "description": "A dictionary of the properties to change. E.g., {'state': 'ON', 'brightness': 255}",
                }
            },
            "required": ["device_id", "state_changes"]
        }
    },
    {
        "name": "update_user_profile",
        "description": "Saves long-term memory, facts, or preferences about the user. Re-write the entire memory file incorporating the new facts alongside existing ones.",
        "parameters": {
            "type": "object",
            "properties": {
                "new_content": {
                    "type": "string",
                    "description": "The complete, updated text to save in the user's profile file."
                }
            },
            "required": ["new_content"]
        }
    }
]