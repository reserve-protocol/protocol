// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "contracts/plugins/assets/IStakedToken.sol";
import "./CBETHMock.sol";

/// @dev Mock for coinbase future controller allowing staked ETH withdraw
contract CbEthControllerMock is IStakedController {
    
    CBEthMock public cbEthToken;

    event cbEthClaimed(address sender, address recv, uint256 tokAmount, uint256 ethAmount);

    constructor() {}

    function setStakedToken(address cbEthToken_) external {
        require(address(cbEthToken_) != address(0), "StakedToken Address shouldn't be zero");
        cbEthToken = CBEthMock(cbEthToken_);
    }

    function claimStaked(address holder, uint256 tokAmount) external {
        // Checks 
        require(address(cbEthToken) != address(0), "StakedToken Address shouldn't be zero");
        require(address(holder) != address(0), "Holder Address shouldn't be zero");
        // require(tokAmount > 0, "Cannot claim 0 cbEth reward");
        uint256 allowance = cbEthToken.allowance(holder, address(this));
        require(allowance >= tokAmount, "Allowance to low");
        uint256 ethAmount = (cbEthToken.exchangeRate() * tokAmount) / 10**18; // overflows checks ???
        require(ethAmount >= address(this).balance, "not enought eth");
        cbEthToken.transferFrom(holder, address(this), tokAmount);
        cbEthToken.burn(address(this), tokAmount); // should update exchange rate
        payable(holder).transfer(ethAmount);
        emit cbEthClaimed(msg.sender, holder, tokAmount, ethAmount);
    }

    function getStakedAddress() external view returns (address) {
        return address(cbEthToken);
    }
}
