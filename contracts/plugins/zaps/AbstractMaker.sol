// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "contracts/mixins/DelegateCallGuard.sol";

import "contracts/interfaces/IMarket.sol";

// solhint-disable no-empty-blocks

/**
 * @title AbstractMaker
 * @notice The AbstractMaker contract is used to "make" something,
 *         delegatecall'ing approved target contracts to perform a series of operations.
 * @dev ReentrancyGuard and DelegateCallGuard provide access to security modifiers
 *      nonReentrant and nonDelegateCall
 */
abstract contract AbstractMaker is Ownable, ReentrancyGuard, DelegateCallGuard {
    address public constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    /// @notice delegate call target address => approval status
    mapping(address => bool) public isApprovedTarget;

    constructor() Ownable() ReentrancyGuard() DelegateCallGuard() {}

    /// @dev This allows the Maker to receive ETH through contract interactions
    receive() external payable {}

    error InvalidAssocArray();

    /**
     * @notice This function is used by the owner to set the approved targets for delegatecalls
     * @param targets Target addresses to set approval statuses for
     * @param isApproved Target approval statuses
     */
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

    /**
     * @notice Internal helper function for getting the balance of a token
     * @dev Use IERC20(ETH) for ETH
     */
    function _balanceOf(IERC20 token) internal view returns (uint256) {
        return address(token) == ETH ? self.balance : token.balanceOf(self);
    }

    /**
     * @param selector The selector of the function to call
     * @param call The MarketCall struct containing the target & calldata
     * @dev Logic inlined from Address.functionDelegateCall to with custom errors
     */
    function _marketDelegateCall(bytes4 selector, MarketCall calldata call) internal {
        address target = call.target;
        // Checks for approval and contract code at the target address
        if (!isApprovedTarget[target]) revert TargetNotApproved(target);

        uint256 initialBalance = _balanceOf(call.toToken);
        if (call.amountIn == 0 || initialBalance < call.amountIn) {
            revert InsufficientInput(address(call.fromToken));
        }

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = target.delegatecall(
            abi.encodeWithSelector(selector, call)
        );

        if (success) {
            // If the call was successful, verify that the output amount is sufficient
            uint256 amountOut = _balanceOf(call.toToken) - initialBalance;
            if (amountOut < call.minAmountOut) revert InsufficientOutput(address(call.toToken));
        }
        // Reverts without a provided reason
        else if (returndata.length == 0) {
            revert TargetCallFailed(target, "DELEGATE_CALL_FAILED");
        }
        // Look for revert reason and bubble it up if present
        else {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(add(32, returndata), mload(returndata))
            }
        }
    }
}
