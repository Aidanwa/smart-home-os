# SQLAlchemy Tables
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Numeric, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from .core import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    
    # User's integration secrets (e.g., Spotify, OpenAI)
    secrets: Mapped[list["UserSecret"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    # User preferences
    preferences: Mapped["UserPreference"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)

class LogicalZone(Base):
    """Platform-Managed Logical Zones (Decoupled Room Concept)"""
    __tablename__ = "logical_zones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    zone_type: Mapped[str] = mapped_column(String(50), default="room")
    display_order: Mapped[int] = mapped_column(default=0)

class DevicePlacement(Base):
    """Maps physical Zigbee MAC addresses to Logical Zones and Spatial X/Y/Z Coordinates"""
    __tablename__ = "device_placements"

    ieee_address: Mapped[str] = mapped_column(String(30), primary_key=True)
    zone_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("logical_zones.id", ondelete="SET NULL"))
    pos_x: Mapped[float] = mapped_column(Numeric(6, 2), default=0.00)
    pos_y: Mapped[float] = mapped_column(Numeric(6, 2), default=0.00)
    pos_z: Mapped[float] = mapped_column(Numeric(6, 2), default=0.00)

class UserSecret(Base):
    """The Vault: Storing encrypted integration credentials"""
    __tablename__ = "user_secrets"
    __table_args__ = (UniqueConstraint('user_id', 'provider', name='unique_user_provider'),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    encrypted_credentials: Mapped[str] = mapped_column(String, nullable=False)

    user: Mapped["User"] = relationship(back_populates="secrets")

class UserPreference(Base):
    """Unstructured UI Option Bags & Agent Personality Overrides"""
    __tablename__ = "user_preferences"

    # Using user_id as the primary key ensures a strict 1-to-1 relationship
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    
    # JSONB allows for ultra-fast, indexable document storage inside Postgres
    ui_settings: Mapped[dict] = mapped_column(JSONB, default=dict, server_default='{}')
    agent_settings: Mapped[dict] = mapped_column(JSONB, default=dict, server_default='{}')
    
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Link back to the User object
    user: Mapped["User"] = relationship(back_populates="preferences")

class Home(Base):
    """Global Home Configuration, Location & Weather Context (Singleton)"""
    __tablename__ = "home_profile"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nickname: Mapped[str] = mapped_column(String(100), default="My Smart Home", nullable=False)
    
    # Location details
    address: Mapped[str | None] = mapped_column(String(255))
    timezone: Mapped[str] = mapped_column(String(50), default="UTC", nullable=False)
    
    # Spatial coordinates (Numeric 9,6 is standard for storing lat/lng with high precision)
    latitude: Mapped[float | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[float | None] = mapped_column(Numeric(9, 6))
    
    # Flexible JSONB storage for weather API grid requirements 
    # (e.g., {"office": "OKX", "gridX": 33, "gridY": 35})
    weather_grid: Mapped[dict | None] = mapped_column(JSONB, server_default='{}')

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())





