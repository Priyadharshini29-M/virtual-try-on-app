import logging
import sys


def configure_logging(level: int = logging.INFO) -> None:
    """Structured-ish console logging — replaces shared/helpers.php's writeLog()
    flat-file logger. In production, point the handler at your log aggregator
    instead of stdout.
    """
    root = logging.getLogger()
    if root.handlers:
        return  # already configured (avoid duplicate handlers under reload)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    root.addHandler(handler)
    root.setLevel(level)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
