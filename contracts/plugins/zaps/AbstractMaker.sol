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
        if (address(token) == address(0)) {
            return self.balance;
        } else {
            return token.balanceOf(self);
        }
    }

    /// @notice This function is used to delegatecall the 'enter' function in a target contract
    function _marketEnter(MarketCall calldata marketCall) internal {
        _marketDelegateCall(marketCall, IMarket.enter.selector);
    }

    /// @notice This function is used to delegatecall the 'exit' function in a target contract
    function _marketExit(MarketCall calldata marketCall) internal {
        _marketDelegateCall(marketCall, IMarket.exit.selector);
    }

    /// @notice This function is private, use _marketEnter or _marketExit instead
    /// @param marketCall The MarketCall struct containing the calldata
    /// @param selector The selector of the function to call
    /// @dev Logic inlined from Address.functionDelegateCall to support reverting with custom errors
    function _marketDelegateCall(MarketCall calldata marketCall, bytes4 selector) private {
        address target = marketCall.target;
        // Checks for approval and contract code at the target address
        if (!isApprovedTarget[target] || target.code.length == 0) revert TargetNotApproved(target);
        // Check that the input amount is sufficient
        if (marketCall.amountIn == 0) revert InsufficientInput();

        uint256 initialBalance = _getBalance(marketCall.toToken);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = target.delegatecall(
            abi.encodeWithSelector(selector, marketCall)
        );

        if (!success) {
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

        // If the call was successful, verify that the output amount is sufficient
        uint256 amountOut = _getBalance(marketCall.toToken) - initialBalance;
        if (amountOut < marketCall.minAmountOut) revert InsufficientOutput();
    }
}
