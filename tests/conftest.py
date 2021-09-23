import pytest
from pathlib import Path


def pytest_addoption(parser):
    parser.addoption("--sim", help="comma-separated list of backends (len>=2) to compare")
    parser.addoption("--nounit", action="store_true", help="skip unit tests")


def pytest_ignore_collect(path, config):
    path_parts = Path(path).parts[1:-1]

    # with the `--sim` flag, run `simulation` subdirectory
    if not config.getoption("sim") and "simulation" in path_parts:
        return True

    # with the `--nounit` flag, skip the `unit` subdirectory
    if config.getoption("nounit") and "unit" in path_parts:
        return True

    return None
