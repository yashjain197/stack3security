"""
Run GSQL statements against the TigerGraph workspace from the command line (setup and debugging).

Usage:
    python -m scripts.tg_gsql "ls"
    python -m scripts.tg_gsql -f graph/schema.gsql

Made by Yash Jain with passion.
"""

import argparse
import base64
import sys
import urllib.error
import urllib.request

from app.core.config import get_settings


def run_gsql(statements: str, timeout: int = 600) -> str:
    """POST statements to the GSQL server as the in-database user and return its text output."""
    settings = get_settings()
    if not (settings.tigergraph_host and settings.tigergraph_username and settings.tigergraph_password):
        sys.exit("TIGERGRAPH_HOST, TIGERGRAPH_USERNAME and TIGERGRAPH_PASSWORD must be set")
    credentials = f"{settings.tigergraph_username}:{settings.tigergraph_password.get_secret_value()}"
    request = urllib.request.Request(  # noqa: S310
        f"{settings.tigergraph_host.rstrip('/')}/gsql/v1/statements",
        data=statements.encode(),
        headers={
            "Authorization": "Basic " + base64.b64encode(credentials.encode()).decode(),
            "Content-Type": "text/plain",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return response.read().decode()
    except urllib.error.HTTPError as exc:
        return f"HTTP {exc.code}: {exc.read().decode()}"


def main() -> None:
    """CLI entry point: run inline statements or a .gsql file."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("statements", nargs="?", help="GSQL to run")
    parser.add_argument("-f", "--file", help="Path to a .gsql file")
    args = parser.parse_args()
    if not args.statements and not args.file:
        parser.error("give statements or -f FILE")
    text = open(args.file, encoding="utf-8").read() if args.file else args.statements  # noqa: SIM115
    print(run_gsql(text))


if __name__ == "__main__":
    main()
