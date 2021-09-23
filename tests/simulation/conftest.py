import pytest
from simulation.backend import evm, py0
from simulation.interface import AbstractProtocol
from typing import List, Type

_backends = {"py0": py0.EconProtocol, "evm": evm.EconProtocol}


@pytest.fixture
def Backends(pytestconfig) -> List[Type[AbstractProtocol]]:
    return [_backends[b] for b in pytestconfig.getoption("sim").split(',')]
