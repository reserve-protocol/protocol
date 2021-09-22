import pytest
import brownie
from common import PAUSER_ROLE


def test_initialized(circuitBreaker, owner):
    assert circuitBreaker.hasRole(PAUSER_ROLE, owner.address) == True
    assert circuitBreaker.paused() == False


def test_pause_unpause_with_owner(circuitBreaker, owner):
    assert circuitBreaker.paused() == False

    # TODO: create TX interface
    tx = circuitBreaker.pause({"from": owner})
    assert circuitBreaker.paused() == True
    # assert tx.events["Paused"]["account"] == owner

    tx = circuitBreaker.unpause({"from": owner})
    assert circuitBreaker.paused() == False
    # assert tx.events["Unpaused"]["account"] == owner


@pytest.mark.parametrize("idx", range(1, 4))
def test_cannot_pause_unpause_if_not_owner(backend, circuitBreaker, accounts, idx):
    assert circuitBreaker.paused() == False

    # TODO: catch reverts
    with brownie.reverts("Not Pauser"):
        circuitBreaker.pause({"from": backend.accounts[idx]})

    with brownie.reverts("Not Pauser"):
        circuitBreaker.unpause({"from": backend.accounts[idx]})

    assert circuitBreaker.paused() == False
