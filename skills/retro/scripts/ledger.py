#!/usr/bin/env python3
"""Retro ledger: a small SQLite log of retrospective entries.

Standard library only. Run as `python3 -I scripts/ledger.py <command>`.

Database path, first match wins:
  1. environment variable RETRO_LEDGER
  2. key "ledger" in ~/.config/retro/config.json (XDG_CONFIG_HOME honored)
  3. ${XDG_STATE_HOME:-~/.local/state}/retro/ledger.sqlite
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

GOALS = ("achieved", "partial", "not_achieved")
FIELDS = (
    "id",
    "created_at",
    "project",
    "harness",
    "goal",
    "helped",
    "friction",
    "changes",
    "candidates",
)
SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    project TEXT NOT NULL,
    harness TEXT,
    goal TEXT CHECK (goal IN ('achieved', 'partial', 'not_achieved')),
    helped TEXT,
    friction TEXT,
    changes TEXT,
    candidates TEXT
)
"""


class LedgerError(Exception):
    pass


def _env_dir(name, fallback):
    value = os.environ.get(name, "")
    return Path(value).expanduser() if value else Path.home() / fallback


def config_path():
    return _env_dir("XDG_CONFIG_HOME", ".config") / "retro" / "config.json"


def ledger_path():
    env = os.environ.get("RETRO_LEDGER", "")
    if env:
        return Path(env).expanduser()
    cfg = config_path()
    if cfg.is_file():
        try:
            data = json.loads(cfg.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise LedgerError(f"cannot read {cfg}: {exc}") from exc
        if not isinstance(data, dict):
            raise LedgerError(f"{cfg} must contain a JSON object")
        value = data.get("ledger")
        if value:
            if not isinstance(value, str):
                raise LedgerError(f'{cfg}: "ledger" must be a string path')
            return Path(value).expanduser()
    return _env_dir("XDG_STATE_HOME", ".local/state") / "retro" / "ledger.sqlite"


def connect():
    path = ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute(SCHEMA)
    conn.commit()
    return conn


def _git(*args):
    try:
        out = subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def _strip_credentials(url):
    """Drop user:password@ from an http(s) remote so tokens never reach the ledger."""
    parts = urlsplit(url)
    if parts.scheme in ("http", "https") and "@" in parts.netloc:
        host = parts.netloc.rsplit("@", 1)[1]
        return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))
    return url


def detect_project():
    """Remote URL of origin when available, else the git toplevel path."""
    remote = _git("remote", "get-url", "origin")
    project = _strip_credentials(remote) if remote else _git(
        "rev-parse", "--show-toplevel"
    )
    if not project:
        raise LedgerError(
            "cannot detect project: not in a git repository; pass --project"
        )
    return project


def _like(pattern):
    escaped = (
        pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    )
    return f"%{escaped}%"


def _emit(rows, as_json, footer=None):
    items = [dict(row) for row in rows]
    if as_json:
        print(json.dumps(items, indent=2, ensure_ascii=False))
        return
    for item in items:
        print(
            f"#{item['id']} {item['created_at']} | {item['harness'] or '-'}"
            f" | {item['project']} | goal: {item['goal'] or '-'}"
        )
        for key in ("helped", "friction", "changes", "candidates"):
            if item[key]:
                print(f"  {key}: {item[key]}")
    if footer is not None:
        print(footer)


def cmd_add(args):
    project = args.project or detect_project()
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO entries (created_at, project, harness, goal, helped,"
            " friction, changes, candidates) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                created_at,
                project,
                args.harness,
                args.goal,
                args.helped,
                args.friction,
                args.changes,
                args.candidates,
            ),
        )
        new_id = cur.lastrowid
    conn.close()
    if args.json:
        print(json.dumps({"id": new_id, "created_at": created_at, "project": project}))
    else:
        print(new_id)


def cmd_list(args):
    sql = "SELECT * FROM entries"
    params = []
    if args.project:
        sql += " WHERE project = ?"
        params.append(args.project)
    sql += " ORDER BY created_at DESC, id DESC LIMIT ?"
    params.append(args.limit)
    conn = connect()
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    _emit(rows, args.json)


def cmd_search(args):
    like = _like(args.pattern)
    sql = (
        "SELECT * FROM entries WHERE (friction LIKE ? ESCAPE '\\'"
        " OR changes LIKE ? ESCAPE '\\' OR candidates LIKE ? ESCAPE '\\')"
    )
    params = [like, like, like]
    if args.project:
        sql += " AND project = ?"
        params.append(args.project)
    sql += " ORDER BY created_at DESC, id DESC"
    conn = connect()
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    _emit(rows, args.json, footer=f"matches: {len(rows)}")


def cmd_path(_args):
    print(ledger_path())


def build_parser():
    parser = argparse.ArgumentParser(
        prog="ledger.py", description="Retro ledger (SQLite)."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="record one retro entry")
    add.add_argument(
        "--project",
        help="project id; default: git remote origin URL, else git toplevel path",
    )
    add.add_argument("--harness", help="for example claude-code, codex, opencode")
    add.add_argument("--goal", choices=GOALS, help="session goal outcome")
    add.add_argument("--helped", help="practice that helped")
    add.add_argument("--friction", help="problem and confirmed cause or hypothesis")
    add.add_argument("--changes", help="files actually changed, or none")
    add.add_argument("--candidates", help="pattern and occurrence count, or none")
    add.add_argument("--json", action="store_true", help="print JSON")
    add.set_defaults(func=cmd_add)

    lst = sub.add_parser("list", help="show recent entries, newest first")
    lst.add_argument("--project", help="exact project id to filter on")
    lst.add_argument("--limit", type=int, default=20, help="default 20")
    lst.add_argument("--json", action="store_true", help="print JSON")
    lst.set_defaults(func=cmd_list)

    srch = sub.add_parser(
        "search",
        help="case-insensitive substring search over friction, changes, candidates",
    )
    srch.add_argument("pattern", help="text to look for (no wildcards needed)")
    srch.add_argument("--project", help="exact project id to filter on")
    srch.add_argument("--json", action="store_true", help="print JSON")
    srch.set_defaults(func=cmd_search)

    pth = sub.add_parser("path", help="print the resolved database path")
    pth.set_defaults(func=cmd_path)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except (LedgerError, sqlite3.Error, OSError) as exc:
        print(f"ledger.py: error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
