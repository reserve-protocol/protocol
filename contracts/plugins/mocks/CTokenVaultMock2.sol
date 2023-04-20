// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "../../vendor/solmate/ERC20Solmate.sol";
import "../assets/compoundv2/CTokenVault.sol";
import "../assets/compoundv2/ICToken.sol";
import "./CTokenMock.sol";

contract CTokenVaultMock is ERC20Mock, IRewardable {
    ERC20Mock public comp;
    CTokenMock public asset;
    IComptroller public comptroller;

    constructor(
        string memory _name,
        string memory _symbol,
        address _underlyingToken,
        ERC20Mock _comp,
        IComptroller _comptroller
    ) ERC20Mock(_name, _symbol) {
        asset = new CTokenMock("cToken Mock", "cMOCK", _underlyingToken);
        comp = _comp;
        comptroller = _comptroller;
    }

    // function mint(uint256 amount, address recipient) external {
    //     _mint(recipient, amount);
    // }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function exchangeRateCurrent() external returns (uint256) {
        return asset.exchangeRateCurrent();
    }

    function exchangeRateStored() external view returns (uint256) {
        return asset.exchangeRateStored();
    }

    function claimRewards() external {
        uint256 oldBal = comp.balanceOf(msg.sender);
        comptroller.claimComp(msg.sender);
        emit RewardsClaimed(IERC20(address(comp)), comp.balanceOf(msg.sender) - oldBal);
    }

    function setExchangeRate(uint192 fiatcoinRedemptionRate) external {
        asset.setExchangeRate(fiatcoinRedemptionRate);
    }
}