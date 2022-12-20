// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "contracts/mixins/DelegateCallGuard.sol";

import "contracts/interfaces/IMarket.sol";

error InvalidAssocArray();

/// @title AbstractMaker
/// @notice The AbstractMaker contract is used to "make" something,
///         delegatecall'ing approved target contracts to perform a series of operations.
/// @dev ReentrancyGuard and DelegateCallGuard provide access to security modifiers
///      nonReentrant and nonDelegateCall
abstract contract AbstractMaker is Ownable, ReentrancyGuard, DelegateCallGuard {
    address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // solhint-disable-next-line no-empty-blocks
    constructor() Ownable() ReentrancyGuard() DelegateCallGuard() {}

    mapping(address => bool) public isApprovedTarget;

    /// @notice This function is used to set the approved targets for delegatecalls
    function setApprovedTargets(address[] calldata targets, bool[] calldata isApproved)
        external
        onlyOwner
    {
        uint256 targetCount = targets.length;
        if (targetCount != isApproved.length) revert InvalidAssocArray();

        for (uint256 i = 0; i < targetCount; ++i) {
            isApprovedTarget[targets[i]] = isApproved[i];
        }
    }

    function _getBalance(IERC20 token) internal view returns (uint256) {
        return address(token) == ETH ? self.balance : token.balanceOf(self);
    }

    /// @notice This function is private, use _marketEnter or _marketExit instead
    /// @param selector The selector of the function to call
    /// @param call The MarketCall struct containing the target & calldata
    /// @dev Logic inlined from Address.functionDelegateCall to support reverting with custom errors
    function _marketDelegateCall(bytes4 selector, MarketCall calldata call) internal {
        address target = call.target;
        // Checks for approval and contract code at the target address
        if (!isApprovedTarget[target] || target.code.length == 0) revert TargetNotApproved(target);
        // Check that the input amount is sufficient
        if (call.amountIn == 0) revert InsufficientInput(address(call.fromToken));

        uint256 initialBalance = _getBalance(call.toToken);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = target.delegatecall(
            abi.encodeWithSelector(selector, call)
        );

        if (success) {
            // If the call was successful, verify that the output amount is sufficient
            uint256 amountOut = _getBalance(call.toToken) - initialBalance;
            if (amountOut < call.minAmountOut) revert InsufficientOutput(address(call.toToken));
        } else {
            // Reverts without a provided reason
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
}
