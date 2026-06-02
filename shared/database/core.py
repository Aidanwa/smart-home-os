# Connection & Session Logic
import os
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

# Grab the URL from the environment (provided by docker-compose)
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set. Check your .env or docker-compose.yml")

# Create the async engine
# Note: pool_size and max_overflow are tuned low here for edge devices (Pi 4)
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10
)

# Create the async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine, 
    class_=AsyncSession, 
    expire_on_commit=False, 
    autocommit=False, 
    autoflush=False
)

class Base(DeclarativeBase):
    """Base class for all SQLAlchemy 2.0 models."""
    pass

# Dependency for FastAPI or Agent tool execution
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yields a database session and ensures it is closed after use."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

