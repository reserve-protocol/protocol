import brownie

def test_rsr_transfer_and_cross(rsr, previousRSRPaused, owner, user1):   
    # Transfer 50 tokens from owner to user1
    amount = 50 * 1e18
    prevBalanceOwner = rsr.balanceOf(owner)
    prevBalanceUser1 = rsr.balanceOf(user1)

    rsr.transfer(user1, amount, {'from': owner})
    
    rsr.balanceOf(owner) == prevBalanceOwner - amount
    rsr.balanceOf(user1) == prevBalanceUser1 + amount
    
    # Check owner has crossed
    assert rsr.crossed(owner) == True
    assert rsr.crossed(user1) == False

def test_rsr_transferFrom_and_cross(rsr, previousRSRPaused, owner, user1, user2):   
    # Transfer 50 tokens from owner to user1
    amount = 500 * 1e18
    prevBalanceOwner = rsr.balanceOf(owner)
    prevBalanceUser2 = rsr.balanceOf(user2)

    # Set allowances
    rsr.approve(user1, amount, {'from': owner})
    rsr.transferFrom(owner, user2, amount, {'from': user1})
    
    rsr.balanceOf(owner) == prevBalanceOwner - amount
    rsr.balanceOf(user2) == prevBalanceUser2 + amount
    
    # Check owner has crossed
    assert rsr.crossed(owner) == True
    assert rsr.crossed(user1) == False

def test_rsr_not_transfer_to_self(rsr, previousRSRPaused, owner):
    amount = 50 * 1e18
    with brownie.reverts():  # TransferToContractAddress()
        rsr.transfer(rsr.address, amount, {'from': owner})

def test_rsr_cross_only_once(rsr, previousRSRPaused, owner, user1):
    amount1 = 50 * 1e18
    amount2 = 100 * 1e18
    
    prevBalanceOwner = rsr.balanceOf(owner)
    prevBalanceUser1 = rsr.balanceOf(user1)

    # Transfer
    rsr.transfer(user1, amount1, {'from': owner})     
    
    assert rsr.balanceOf(owner) == prevBalanceOwner - amount1
    assert rsr.balanceOf(user1) == prevBalanceUser1 + amount1

    # Check owner has crossed
    assert rsr.crossed(owner) == True
    assert rsr.crossed(user1) == False
 
    #  Perform second transfer of 50 tokens from owner to addr1
    rsr.transfer(user1, amount2, {'from': owner})     
    
    assert rsr.balanceOf(owner) == prevBalanceOwner - amount1 - amount2
    assert rsr.balanceOf(user1) == prevBalanceUser1 + amount1 + amount2

    # Check owner has crossed
    assert rsr.crossed(owner) == True
    assert rsr.crossed(user1) == False

def test_rsr_transfer_slowWallet_to_multisig(rsr, previousRSRPaused, user1, slowWallet, multisigWallet):
    amount = 200 * 1e18
    prevBalanceMultisig = rsr.balanceOf(multisigWallet)
    prevBalanceSlowWallet = rsr.balanceOf(slowWallet)
    prevBalanceUser1 = rsr.balanceOf(user1)
    
    # Transfer from multisig
    rsr.transfer(user1, amount, {'from': multisigWallet})
    
    assert rsr.balanceOf(user1) == prevBalanceUser1 + amount
    assert rsr.balanceOf(multisigWallet) == prevBalanceMultisig + prevBalanceSlowWallet - amount
    assert rsr.balanceOf(slowWallet) == 0
    
    # Check multisig and slowWallet have crossed
    assert rsr.crossed(multisigWallet) == True
    assert rsr.crossed(slowWallet) == True
    assert rsr.crossed(user1) == False
