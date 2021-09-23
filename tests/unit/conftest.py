import pytest

@pytest.fixture(scope="session")
def owner(accounts):
    return accounts[0]

@pytest.fixture(scope="session")
def user1(accounts):
    return accounts[1]

@pytest.fixture(scope="session")
def user2(accounts):
    return accounts[2]

@pytest.fixture(scope="session")
def slowWallet(accounts):
    return accounts[5]

@pytest.fixture(scope="session")
def multisigWallet(accounts):
    return accounts[6]

@pytest.fixture(scope="session")
def other(accounts):
    return accounts[9]

@pytest.fixture
def tokenMock(ERC20Mock, owner):
    return owner.deploy(ERC20Mock, "Basket Token", "BSK")

@pytest.fixture
def previousRSR(ReserveRightsTokenMock, owner, user1, user2, slowWallet, multisigWallet):
    prevRSRToken = owner.deploy(ReserveRightsTokenMock, "Reserve Rights", "RSR")
    
    prevRSRToken.mint(owner, 100000*1e18, {'from': owner})
    prevRSRToken.mint(user1, 20000*1e18, {'from': owner})
    prevRSRToken.mint(user2, 30000*1e18, {'from': owner})
    prevRSRToken.mint(slowWallet, 40000*1e18, {'from': owner})
    prevRSRToken.mint(multisigWallet, 10000*1e18, {'from': owner})

    prevRSRToken.approve(user1, 500*1e18, {'from': owner})
    prevRSRToken.approve(user1, 200*1e18, {'from': user2})

    return prevRSRToken

@pytest.fixture
def previousRSRPaused(previousRSR, owner):
    previousRSR.pause({'from': owner})
    return previousRSR

@pytest.fixture
def rsr(RSR, previousRSR, slowWallet,multisigWallet, owner):
     return owner.deploy(RSR, previousRSR.address, slowWallet, multisigWallet)

@pytest.fixture(scope="session")
def compoundMath(CompoundMath, owner):
    return owner.deploy(CompoundMath)


@pytest.fixture
def circuitBreaker(CircuitBreaker, owner):
    return owner.deploy(CircuitBreaker, owner)

