import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, DateTime, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
import enum

from app.db.session import Base


class DatabaseType(str, enum.Enum):
    POSTGRES = "postgres"
    MYSQL = "mysql"
    MONGODB = "mongodb"
    REDIS = "redis"
    DYNAMODB = "dynamodb"
    AURORA = "aurora"


class CloudProvider(str, enum.Enum):
    AWS = "aws"
    GCP = "gcp"
    AZURE = "azure"


class Environment(str, enum.Enum):
    PRODUCTION = "production"
    STAGING = "staging"
    DEVELOPMENT = "development"


class HealthStatus(str, enum.Enum):
    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"


class Database(Base):
    __tablename__ = "databases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    type = Column(SQLEnum(DatabaseType), nullable=False, index=True)
    cloud_provider = Column(SQLEnum(CloudProvider), nullable=False, index=True)
    region = Column(String(50), nullable=False, index=True)
    environment = Column(SQLEnum(Environment), nullable=False, index=True)

    # Health metrics
    health_status = Column(SQLEnum(HealthStatus), default=HealthStatus.HEALTHY)
    health_score = Column(Float, default=100.0)

    # Current metrics (denormalized for quick access)
    cpu_usage = Column(Float, default=0.0)
    memory_usage = Column(Float, default=0.0)
    storage_usage = Column(Float, default=0.0)
    connections_active = Column(Integer, default=0)
    connections_max = Column(Integer, default=100)

    # Cost
    monthly_cost = Column(Float, default=0.0)
    cost_trend = Column(Float, default=0.0)  # percentage change

    # Metadata
    version = Column(String(50))
    instance_type = Column(String(100))
    storage_size_gb = Column(Integer)
    tags = Column(JSONB, default=dict)

    # Issue tracking (denormalized count)
    active_issues_count = Column(Integer, default=0)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    issues = relationship("Issue", back_populates="database", cascade="all, delete-orphan")
    metrics = relationship("Metric", back_populates="database", cascade="all, delete-orphan")
    billing_records = relationship("BillingRecord", back_populates="database", cascade="all, delete-orphan")
    change_events = relationship("ChangeEvent", back_populates="database", cascade="all, delete-orphan")
    log_entries = relationship("LogEntry", back_populates="database", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Database {self.name} ({self.type.value})>"
