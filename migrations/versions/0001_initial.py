"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    message_status = postgresql.ENUM(
        "pending", "delivered", "failed", name="message_status", create_type=True
    )
    attempt_status = postgresql.ENUM(
        "ok", "retryable_error", "permanent_error", name="attempt_status", create_type=True
    )

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("recipient", sa.String(length=512), nullable=False),
        sa.Column("text", sa.String(length=4096), nullable=False),
        sa.Column("channels", sa.String(length=256), nullable=False),
        sa.Column("status", message_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "delivery_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messages.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column("status", attempt_status, nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
    )


def downgrade() -> None:
    op.drop_table("delivery_attempts")
    op.drop_table("messages")
    postgresql.ENUM(name="attempt_status").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="message_status").drop(op.get_bind(), checkfirst=True)
