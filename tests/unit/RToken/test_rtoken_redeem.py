import pytest
import brownie

def test_revert_if_no_supply(rToken, owner):    
    redeemAmount = 10000 * 1e18

    with brownie.reverts("ERC20: burn amount exceeds balance"):
        rToken.redeem(redeemAmount, {'from': owner})

    assert rToken.totalSupply() == 0

@pytest.mark.parametrize("redeemAmount", [0, 10000 * 1e18]) 
def test_should_not_redeem_with_invalid_amounts(rTokenIssued, user1, redeemAmount):
    with brownie.reverts():
        rTokenIssued.redeem(redeemAmount, {'from': user1})

def test_should_redeem_correctly(rTokenIssued, tokenMock, user1):
    redeemAmount = 500 * 1e18

    # check balances
    prevTokenBalanceforRToken = tokenMock.balanceOf(rTokenIssued.address)
    prevTokenBalanceforUser = tokenMock.balanceOf(user1)
    prevRTokenBalanceforUser = rTokenIssued.balanceOf(user1)
    prevTotalSupply = rTokenIssued.totalSupply()

    # Redeem rTokens
    tx = rTokenIssued.redeem(redeemAmount, {'from': user1})
    assert tx.events["Redemption"]['redeemer'] == user1
    assert tx.events["Redemption"]['amount'] == redeemAmount
   
    # check funds were transferred
    #assert rTokenIssued.balanceOf(user1) == 
    assert tokenMock.balanceOf(rTokenIssued.address) == prevTokenBalanceforRToken - redeemAmount
    assert tokenMock.balanceOf(user1) == prevTokenBalanceforUser + redeemAmount
    assert rTokenIssued.balanceOf(user1) == prevRTokenBalanceforUser - redeemAmount
    assert rTokenIssued.totalSupply() == prevTotalSupply - redeemAmount
