// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../assets/compoundv2/CTokenWrapper.sol";
import "../assets/compoundv2/ICToken.sol";
import "./CTokenMock.sol";

contract CTokenWrapperMock is ERC20Mock, IRewardable {
    ERC20Mock public comp;
    CTokenMock public underlying;
    IComptroller public comptroller;

    bool public revertClaimRewards;

    constructor(
        string memory _name,
        string memory _symbol,
        address _underlyingToken,
        ERC20Mock _comp,
        IComptroller _comptroller
    ) ERC20Mock(_name, _symbol) {
        underlying = new CTokenMock("cToken Mock", "cMOCK", _underlyingToken);
        comp = _comp;
        comptroller = _comptroller;
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function exchangeRateCurrent() external returns (uint256) {
        return underlying.exchangeRateCurrent();
    }

    function exchangeRateStored() external view returns (uint256) {
        return underlying.exchangeRateStored();
    }

    function claimRewards() external {
        if (revertClaimRewards) {
            revert("reverting claim rewards");
        }
        uint256 oldBal = comp.balanceOf(msg.sender);
        comptroller.claimComp(msg.sender);
        emit RewardsClaimed(IERC20(address(comp)), comp.balanceOf(msg.sender) - oldBal);
    }

    function setExchangeRate(uint192 fiatcoinRedemptionRate) external {
        underlying.setExchangeRate(fiatcoinRedemptionRate);
    }

    function setRevertClaimRewards(bool newVal) external {
        revertClaimRewards = newVal;
    }
}
