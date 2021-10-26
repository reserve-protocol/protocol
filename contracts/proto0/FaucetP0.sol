// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IFaucet.sol";

/**
 * @title FaucetP0
 * @dev A helper contract to drip RToken back to the Manager at a steady rate.
 */
contract FaucetP0 is IFaucet {
    using SafeERC20 for IERC20;

    address public immutable beneficiary;
    IERC20 public immutable token;

    struct Handout {
        uint256 amount;
        uint256 start; // Start timestamp
        uint256 duration; // Duration in seconds
        uint256 released; // Amount already released
    }

    Handout[] public handouts;

    //uint256 public handoutIndex; // Potential optimization

    constructor(address beneficiary_, address token_) {
        require(beneficiary_ != address(0), "Beneficiary is zero address");
        require(token_ != address(0), "Token is zero address");

        beneficiary = beneficiary_;
        token = IERC20(token_);
    }

    function handout(uint256 amount, uint256 timePeriod) external override {
        require(amount > 0, "Cannot handout zero");

        token.safeTransferFrom(msg.sender, address(this), amount);

        // Register handout
        handouts.push(Handout(amount, block.timestamp, timePeriod, 0));
    }

    function drip() external override {
        uint256 releasable = _processHandouts(block.timestamp);
        token.safeTransfer(beneficiary, releasable);
    }

    function getVestedAmount(uint256 timestamp) external view returns (uint256) {
        uint256 releasable = 0;
        for (
            uint256 index = 0; /*handoutIndex*/
            index < handouts.length;
            index++
        ) {
            Handout memory currHandout = handouts[index];

            // Check if there are still funds to be released
            if (currHandout.released < currHandout.amount) {
                uint256 vestedAmount = _vestedAmount(currHandout, timestamp);

                // Release amount
                releasable += vestedAmount - currHandout.released;
            }
        }

        return releasable;
    }

    function _processHandouts(uint256 timestamp) internal returns (uint256) {
        uint256 releasable = 0;
        for (
            uint256 index = 0; /*handoutIndex*/
            index < handouts.length;
            index++
        ) {
            Handout storage currHandout = handouts[index];

            // Check if there are still funds to be released
            if (currHandout.released < currHandout.amount) {
                uint256 vestedAmount = _vestedAmount(currHandout, timestamp);

                // Release amount
                releasable += vestedAmount - currHandout.released;

                // Update released
                currHandout.released = vestedAmount;

                // Note: Potential optimization by cleaning up Handout once all consumed
            }

            // Note:  Potential optimization by increasing handoutIndex
        }

        return releasable;
    }

    function _vestedAmount(Handout memory _handout, uint256 timestamp) internal pure returns (uint256) {
        if (timestamp <= _handout.start) {
            return 0;
        } else if (timestamp > _handout.start + _handout.duration) {
            return _handout.amount;
        } else {
            return (_handout.amount * (timestamp - _handout.start)) / _handout.duration;
        }
    }
}
