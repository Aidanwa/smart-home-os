from fastapi import Security, HTTPException, status
from fastapi.security import APIKeyHeader
from api.config import get_config

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)

def verify_api_key(api_key: str = Security(api_key_header)):
    config = get_config()
    
    if api_key not in config.valid_api_keys:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key"
        )
    return api_key