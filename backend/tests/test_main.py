"""App lifespan: the background access-mapping cache warm-up must never
block the event loop or raise — see docs/CONTEXT.md's incident note (a
version of this that ran synchronously inside the lifespan startup handler
once caused a k8s liveness-probe kill-restart loop in production)."""
import asyncio
import threading

from app import main
from app.core import access


def test_warm_access_cache_never_raises(monkeypatch):
    def boom():
        raise RuntimeError("BigQuery is down")

    monkeypatch.setattr(access, "get_live_config", boom)
    asyncio.run(main._warm_access_cache())  # must not raise


def test_warm_access_cache_runs_off_the_event_loop_thread(monkeypatch):
    """Regression: an earlier version called access.get_live_config()
    directly inside the async lifespan handler — a blocking sync call there
    freezes the event loop (and therefore every concurrent request,
    including /health) for however long it takes. It must run in a thread
    instead (see main.py::_warm_access_cache)."""
    calling_thread = {}

    def fake_get_live_config():
        calling_thread["id"] = threading.get_ident()
        return {}

    monkeypatch.setattr(access, "get_live_config", fake_get_live_config)
    main_thread_id = threading.get_ident()
    asyncio.run(main._warm_access_cache())
    assert calling_thread["id"] != main_thread_id
