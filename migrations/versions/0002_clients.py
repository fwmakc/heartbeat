"""clients: справочник клиентов и хэши API-ключей.

Revision ID: 0002_clients
Revises: 0001_initial
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_clients"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("api_key_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_foreign_key(
        "fk_messages_client", "messages", "clients", ["client_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_messages_client", "messages", type_="foreignkey")
    op.drop_table("clients")
