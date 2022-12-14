// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract GoldfinchSeniorPoolMock is ERC20Mock {
    using FixLib for uint192;
    uint256 public sharePrice;

    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {
        sharePrice = FIX_ONE;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function setSharePrice(uint256 _sharePrice) external {
        sharePrice = _sharePrice;
    }
}
