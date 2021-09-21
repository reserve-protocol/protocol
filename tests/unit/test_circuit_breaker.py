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
 
def test_cannot_pause_unpause_if_not_owner(circuitBreaker, other):
    assert circuitBreaker.paused() == False
    
    with brownie.reverts("Not Pauser"):
        circuitBreaker.pause({'from': other})

    with brownie.reverts("Not Pauser"):
        circuitBreaker.unpause({'from': other})

    assert circuitBreaker.paused() == False
