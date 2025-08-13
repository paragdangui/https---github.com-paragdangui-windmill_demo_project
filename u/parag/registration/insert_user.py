# u/parag/registration/insert_user
# extra_requirements: wmill PyMySQL
import re
import pymysql
import wmill


def _quote_ident(ident: str) -> str:
    """
    Safely quote a MySQL identifier (db.table or table).
    Allows only A-Z, a-z, 0-9, and underscore per segment, then wraps in backticks.
    """
    parts = ident.split(".")
    quoted = []
    for p in parts:
        if not re.fullmatch(r"[A-Za-z0-9_]+", p):
            raise ValueError(f"Invalid identifier segment: {p!r}")
        quoted.append(f"`{p}`")
    return ".".join(quoted)


def main(
    username: str,
    email: str,
    password_hash: str,  # keep the external param name for compatibility
    users_table: str,
    db_resource_path: str,
) -> dict:
    # Fetch DB resource by path
    db = wmill.get_resource(db_resource_path)

    # Accept either "database" or "dbname" key from the resource
    database = db.get("database") or db.get("dbname")
    if not database:
        raise ValueError(
            "Database name not found in resource (expected 'database' or 'dbname')."
        )

    # Optional SSL root CA if present on the resource
    ssl_params = (
        {"ca": db.get("root_certificate_pem")}
        if db.get("root_certificate_pem")
        else None
    )

    conn = pymysql.connect(
        host=db["host"],
        port=int(db.get("port", 3306)),
        user=db["user"],
        password=db["password"],
        database=database,
        charset="utf8mb4",
        autocommit=False,
        ssl=ssl_params,
    )

    cur = conn.cursor()
    try:
        table_ident = _quote_ident(users_table)

        # INSERT using schema: id, username, password, email, created_at, updated_at
        # Map password_hash -> password column and set timestamps explicitly.
        insert_sql = f"""
            INSERT INTO {table_ident} (username, email, `password`, created_at, updated_at)
            VALUES (%s, %s, %s, NOW(), NOW())
        """
        cur.execute(insert_sql, (username, email, password_hash))
        new_id = cur.lastrowid

        # Read back selected columns
        select_sql = f"SELECT id, username, email FROM {table_ident} WHERE id = %s"
        cur.execute(select_sql, (new_id,))
        row = cur.fetchone()

        conn.commit()
        if not row:
            raise RuntimeError("Insert succeeded but no row was returned on reselect.")
        return {"id": row[0], "username": row[1], "email": row[2]}
    except pymysql.err.IntegrityError:
        conn.rollback()
        raise
    finally:
        try:
            cur.close()
        except Exception:
            pass
        conn.close()
