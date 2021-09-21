import pytest
from brownie import (
    CircuitBreaker,
    CompoundMath,
    ERC20Mock,
    ReserveRightsTokenMock,
    RSR,
    ZERO_ADDRESS,
)


@pytest.fixture(scope="session")
def owner(accounts):
    return accounts[0]


@pytest.fixture(scope="session")
def other(accounts):
    return accounts[1]


@pytest.fixture
def tokenMock(owner):
    return owner.deploy(ERC20Mock, "Basket Token", "BSK")


@pytest.fixture
def previousRSR(owner):
    prevRSRToken = owner.deploy(ReserveRightsTokenMock, "Reserve Rights", "RSR")
    prevRSRToken.mint(owner.address, 100000 * 1e18, {"from": owner})
    prevRSRToken.pause({"from": owner})
    return prevRSRToken


@pytest.fixture
def rsr(previousRSR, owner):
    return owner.deploy(RSR, previousRSR.address, ZERO_ADDRESS, ZERO_ADDRESS)


@pytest.fixture(scope="session")
def compoundMath(owner):
    return owner.deploy(CompoundMath)


@pytest.fixture
def circuitBreaker(owner):
    return owner.deploy(CircuitBreaker, owner)
