import pytest
from implementations.py0 import PyBackend0


def pytest_addoption(parser):
    parser.addoption("--backend", help="comma-separated list of backends to target/compare")
    parser.addoption("--unitary", action="store_true", help="only run unit tests")


@pytest.fixture
def backend():
    # TODO: Parse --backend flag
    return PyBackend0(10)
