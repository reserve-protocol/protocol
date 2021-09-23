import pytest
import brownie

def test_no_issuance_if_circuitBreaker_paused(rToken, circuitBreaker, owner):    
    mintAmount = 100 * 1e18

    # Pause circuit breaker
    circuitBreaker.pause({'from': owner})

    with brownie.reverts():
        rToken.issue(mintAmount, {'from': owner})

    assert rToken.totalSupply() == 0

@pytest.mark.parametrize("idx", range(1, 4)) 
def test_reverts_if_no_approval(rToken, tokenMock, owner, accounts, idx):    
    mintAmount = 100 * 1e18
    
    tokenMock.mint(accounts[idx], mintAmount, {'from': owner})
    
    with brownie.reverts("ERC20: transfer amount exceeds allowance"):
        rToken.issue(mintAmount, {'from': accounts[idx]})

    assert rToken.totalSupply() == 0


@pytest.mark.parametrize("idx", range(1, 4)) 
def test_reverts_if_no_balanceOf(rToken, accounts, idx):    
    mintAmount = 1000 * 1e18
  
    with brownie.reverts("ERC20: transfer amount exceeds balance"):
        rToken.issue(mintAmount, {'from': accounts[idx]})

    assert rToken.totalSupply() == 0

@pytest.mark.parametrize("idx", range(1, 4)) 
def test_should_issue_correctly(rToken, tokenMock, owner, accounts, idx):
    mintAmount = 1000 * 1e18
    tokenMock.mint(accounts[idx], mintAmount, {'from': owner})
    tokenMock.approve(rToken.address, mintAmount,{'from': accounts[idx]})

    # Check no balance in contract
    assert tokenMock.balanceOf(rToken.address) == 0
    assert tokenMock.balanceOf(accounts[idx]) == mintAmount

    # Issue rTokens
    tx = rToken.issue(mintAmount, {'from': accounts[idx]})
    assert tx.events["SlowMintingInitiated"]['account'] == accounts[idx]
    assert tx.events["SlowMintingInitiated"]['amount'] == mintAmount
    

    # Check funds were transferred
    assert tokenMock.balanceOf(rToken.address) == mintAmount
    assert tokenMock.balanceOf(accounts[idx]) == 0
    assert rToken.totalSupply() == 0
    
    # Process Mintings and check RTokens issued
    rToken.tryProcessMintings({'from': owner})
    assert rToken.balanceOf(accounts[idx]) == mintAmount
    assert rToken.totalSupply() == mintAmount


