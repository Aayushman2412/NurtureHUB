"""
Lightweight, idempotent schema upgrades.

There is no migration framework here — Base.metadata.create_all() only creates
missing *tables*, never new columns on existing ones. run_column_migrations()
compares every model table that already exists in the database with its ORM
definition and issues "ALTER TABLE ... ADD COLUMN ..." for anything missing.
Safe to run on every startup, on both SQLite and Postgres.

Limitations (fine for our additive changes): no type changes, no drops, and
foreign-key columns are added without the FK constraint (SQLite cannot add one
via ALTER TABLE).
"""

from sqlalchemy import inspect, text

from app.database import Base, engine


def _default_literal(column, dialect_name: str):
    """SQL literal for a scalar python-side default, or None."""
    if column.default is None or not getattr(column.default, "is_scalar", False):
        return None
    arg = column.default.arg
    if isinstance(arg, bool):
        if dialect_name == "sqlite":
            return "1" if arg else "0"
        return "TRUE" if arg else "FALSE"
    if isinstance(arg, (int, float)):
        return str(arg)
    if isinstance(arg, str):
        return "'" + arg.replace("'", "''") + "'"
    return None


def _column_ddl(column, dialect) -> str:
    type_sql = column.type.compile(dialect=dialect)
    ddl = f"{column.name} {type_sql}"
    default_sql = _default_literal(column, dialect.name)
    if default_sql is not None:
        ddl += f" DEFAULT {default_sql}"
        if not column.nullable:
            ddl += " NOT NULL"
    return ddl


def run_column_migrations() -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # brand-new table: create_all handles it in full
            existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_cols:
                    continue
                ddl = _column_ddl(column, engine.dialect)
                conn.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {ddl}"))
                print(f"[migrate] added column {table.name}.{column.name}")
