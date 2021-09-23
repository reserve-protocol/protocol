import pytest
import brownie
from brownie import web3

PAUSER_ROLE = web3.solidityKeccak(["string"], ["PAUSER_ROLE"])

def test_initialized(circuitBreaker, owner):
    assert circuitBreaker.hasRole(PAUSER_ROLE, owner) == True
    assert circuitBreaker.paused() == False

def test_pause_unpause_with_owner(circuitBreaker, owner):
    assert circuitBreaker.paused() == False
    
    tx = circuitBreaker.pause({'from': owner})
    assert circuitBreaker.paused() == True
    assert tx.events["Paused"]['account'] == owner
    
    tx = circuitBreaker.unpause({'from': owner})
    assert circuitBreaker.paused() == False
    assert tx.events["Unpaused"]['account'] == owner
 
@pytest.mark.parametrize("idx", range(1, 4)) 
def test_cannot_pause_unpause_if_not_owner(circuitBreaker, accounts, idx):
    assert circuitBreaker.paused() == False
    
    with brownie.reverts("Not Pauser"):
        circuitBreaker.pause({'from': accounts[idx]})

    with brownie.reverts("Not Pauser"):
        circuitBreaker.unpause({'from': accounts[idx]})

    assert circuitBreaker.paused() == False
