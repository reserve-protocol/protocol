// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../SlowMintingERC20.sol";

contract SlowMintingERC20Mock is SlowMintingERC20 {
    constructor(
        string memory name_,
        string memory symbol_,
        address conf_
    ) SlowMintingERC20(name_, symbol_, conf_) {}

    function startMinting(address account, uint256 amount) public {
        _startMinting(account, amount);
    }

    function issuanceRate() external view returns(uint256) {
        return this.conf().issuanceRate();
    }
}
