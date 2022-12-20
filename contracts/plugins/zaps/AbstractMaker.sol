// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "contracts/mixins/DelegateCallGuard.sol";

import "contracts/interfaces/IMarket.sol";

error InvalidAssocArray();

/// @title AbstractMaker
/// @notice The AbstractMaker contract is used to "make" something, calling or
///         delegatecall'ing approved target contracts to perform a series of operations.
/// @dev ReentrancyGuard and DelegateCallGuard provide access to security modifiers
///      to nonReentrant and nonDelegateCall
abstract contract AbstractMaker is Ownable, ReentrancyGuard, DelegateCallGuard {
    // solhint-disable-next-line no-empty-blocks
    constructor() Ownable() ReentrancyGuard() DelegateCallGuard() {}

    mapping(address => bool) public approvedTargets;

    function setApprovedTargets(address[] calldata targets, bool[] calldata isApproved)
        external
        onlyOwner
    {
        uint256 targetCount = targets.length;
        if (targetCount != isApproved.length) revert InvalidAssocArray();

        for (uint256 i = 0; i < targetCount; ++i) {
            approvedTargets[targets[i]] = isApproved[i];
        }
    }

    function _getBalance(IERC20 token) internal view returns (uint256) {
        if (address(token) == address(0)) {
            return self.balance;
        } else {
            return token.balanceOf(self);
        }
    }

    function _marketEnter(MarketCall calldata marketCall) internal {
        _marketDelegateCall(marketCall, IMarket.enter.selector);
    }

    function _marketExit(MarketCall calldata marketCall) internal {
        _marketDelegateCall(marketCall, IMarket.exit.selector);
    }

    /// @dev This function is private, use _marketEnter or _marketExit instead
    /// @notice Inlined from Address.functionDelegateCall to include the approved target check
    function _marketDelegateCall(MarketCall calldata marketCall, bytes4 selector)
        private
        returns (uint256)
    {
        address target = marketCall.target;
        // Checks for approval and contract code at the target address
        if (!approvedTargets[target] || target.code.length == 0) revert TargetNotApproved(target);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = target.delegatecall(
            abi.encodeWithSelector(selector, marketCall)
        );

        // If the call was successful, IMarket will return the amountOut
        if (success) {
            return uint256(bytes32(returndata));
        }

        // No error was raised nor a reason provided
        if (returndata.length == 0) {
            revert TargetCallFailed(target, "DELEGATE_CALL_FAILED");
        }

        // Look for revert reason and bubble it up if present
        // solhint-disable-next-line no-inline-assembly
        assembly {
            revert(add(32, returndata), mload(returndata))
        }
    }
}
