import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import enum

from app.db.session import Base


class LogLevel(str, enum.Enum):
    DEBUG = "debug"
    INFO = "info"
    WARN = "warn"
    ERROR = "error"
    FATAL = "fatal"


class LogEntry(Base):
    __tablename__ = "log_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    database_id = Column(UUID(as_uuid=True), ForeignKey("databases.id", ondelete="CASCADE"), nullable=False)

    # Log details
    level = Column(SQLEnum(LogLevel), nullable=False, index=True)
    message = Column(Text, nullable=False)
    source = Column(String(100))  # error_log, slow_query_log, system_log

    # Context
    query = Column(Text)  # For query-related logs
    duration_ms = Column(String(50))  # For slow query logs
    error_code = Column(String(50))

    # Timestamp
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    database = relationship("Database", back_populates="log_entries")

    # Composite index for efficient queries
    __table_args__ = (
        Index("ix_log_entries_database_level_timestamp", "database_id", "level", "timestamp"),
    )

    def __repr__(self):
        return f"<LogEntry [{self.level.value}] {self.message[:50]}>"
