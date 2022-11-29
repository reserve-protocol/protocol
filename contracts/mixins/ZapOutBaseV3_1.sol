// SPDX-License-Identifier: GPL-2.0

pragma solidity ^0.8.0;
import "./ZapBaseV2_1.sol";

// ============================================================
// ZapOutBaseV3_1 is the base contract for all ZapOut contracts
// ============================================================
// solhint-disable-next-line contract-name-camelcase
abstract contract ZapOutBaseV3_1 is ZapBaseV2_1 {
    using SafeERC20 for IERC20;

    /**
    @dev Transfer tokens from msg.sender to this contract
    @param token The ERC20 token to transfer to this contract
    @return Quantity of tokens transferred to this contract
     */
    function _pullTokens(address token, uint256 amount) internal returns (uint256) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        return amount;
    }
}
