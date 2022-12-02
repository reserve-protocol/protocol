// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import "./ERC20Mock.sol";
import "contracts/libraries/Fixed.sol";

/// Wrapped liquid staked Ether 2.0
/// @dev ERC20 + Oracle functions + Exchange rates
/// @dev https://etherscan.io/token/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0#code
contract WstETHMock is ERC20Mock {
    uint256 internal _exchangeRate;

    // solhint-disable-next-line no-empty-blocks
    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {}

    /**
     * @notice Get amount of stETH for a one wstETH
     * @return Amount of stETH for 1 wstETH
     */
    function stEthPerToken() external view returns (uint256) {
        return _exchangeRate;
    }
}
