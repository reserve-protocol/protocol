import pytest
from brownie import (
    accounts,
    CircuitBreaker,
    CompoundMath,
    ERC20Mock,
    ReserveRightsTokenMock,
    RSR,
    ZERO_ADDRESS,
)


@pytest.fixture
def owner(backend):
    return backend.accounts[0]


@pytest.fixture
def other(backend):
    return backend.accounts[1]


@pytest.fixture
def tokenMock(backend, owner):
    return backend.ERC20(owner, "Basket Token", "BSK")


# @pytest.fixture
# def previousRSR(owner):
#     prevRSRToken = owner.deploy(ReserveRightsTokenMock, "Reserve Rights", "RSR")
#     prevRSRToken.mint(owner.address, 100000 * 1e18, {"from": owner})
#     prevRSRToken.pause({"from": owner})
#     return prevRSRToken


# @pytest.fixture
# def rsr(previousRSR, owner):
#     return owner.deploy(RSR, previousRSR.address, ZERO_ADDRESS, ZERO_ADDRESS)


@pytest.fixture
def compoundMath(owner):
    return backend.CompoundMath(owner)


@pytest.fixture
def circuitBreaker(backend, owner):
    return backend.CircuitBreaker(owner, owner.address)
