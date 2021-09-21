import pytest
from brownie import ZERO_ADDRESS

@pytest.fixture(scope="session")
def owner(accounts):
    return accounts[0]

@pytest.fixture(scope="session")
def other(accounts):
    return accounts[1]

@pytest.fixture
def tokenMock(ERC20Mock, owner):
    return  owner.deploy(ERC20Mock, "Basket Token", "BSK")

@pytest.fixture
def previousRSR(ReserveRightsTokenMock, owner):
    prevRSRToken =  owner.deploy(ReserveRightsTokenMock, "Reserve Rights", "RSR")
    prevRSRToken.mint(owner.address, 100000*1e18, {'from': owner})
    prevRSRToken.pause({'from': owner})
    return prevRSRToken

@pytest.fixture
def rsr(RSR, previousRSR, owner):
     return owner.deploy(RSR, previousRSR.address, ZERO_ADDRESS, ZERO_ADDRESS)

@pytest.fixture(scope="session")
def compoundMath(CompoundMath, owner):
    return owner.deploy(CompoundMath)

@pytest.fixture
def circuitBreaker(CircuitBreaker, owner):
    return owner.deploy(CircuitBreaker, owner)

