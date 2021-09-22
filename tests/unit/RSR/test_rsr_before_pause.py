import brownie

def assert_initial_balance(rsr, previousRSR, user):
    assert rsr.balanceOf(user) == previousRSR.balanceOf(user)
    assert rsr.crossed(user) == False

def test_rsr_before_pause_balances(rsr, previousRSR, owner, user1, user2):
    # check balances
    assert_initial_balance(rsr, previousRSR, owner)
    assert_initial_balance(rsr, previousRSR, user1);
    assert_initial_balance(rsr, previousRSR, user2);

def test_rsr_before_pause_should_not_transfer(rsr, owner, user1):
    amount = 50 * 1e18
    prevBalanceUser1 = rsr.balanceOf(user1)
    with brownie.reverts("ERC20: transfer amount exceeds balance"):
        rsr.transfer(user1, amount, {'from': owner}) 
            
    assert rsr.balanceOf(user1) == prevBalanceUser1
    assert rsr.crossed(owner) == False
    assert rsr.crossed(user1) == False
 
def test_rsr_before_pause_should_not_transferFrom(rsr, owner, user1, user2):
    # Transfer 500 tokens from owner to user2, handled by user1 (allowance) 
    amount = 500 * 1e18
    prevBalanceUser2 = rsr.balanceOf(user2)

    with brownie.reverts("ERC20: transfer amount exceeds balance"):
        rsr.transferFrom(owner, user2, amount, {'from': user1}) 
   
    assert rsr.balanceOf(user2) == prevBalanceUser2
    assert rsr.crossed(owner) == False
    assert rsr.crossed(user2) == False

def test_rsr_before_pause_should_allow_approvals(rsr, owner, user1):
    amount = 100 * 1e18
    # Grant allowance
    rsr.approve(user1, amount, {'from': owner})
    assert rsr.allowance(owner, user1) == amount
    assert rsr.crossed(owner) == False
    assert rsr.crossed(user1) == False
