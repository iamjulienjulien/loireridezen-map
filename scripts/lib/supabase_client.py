from __future__ import annotations

import os

from supabase import create_client, Client

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.environ.get("SUPA_URL")
        key = os.environ.get("SUPA_SECRET_KEY")
        if not url:
            raise RuntimeError("Variable d'environnement SUPA_URL manquante.")
        if not key:
            raise RuntimeError("Variable d'environnement SUPA_SECRET_KEY manquante.")
        _client = create_client(url, key)
    return _client
