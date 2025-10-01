// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./ERC20Fuzz.sol";
import "./IFuzz.sol";
import "../interfaces/IBackingManager.sol";
import "../interfaces/IStRSR.sol";
import "../interfaces/IRevenueTrader.sol";
import "../interfaces/IRToken.sol";
import "../libraries/Fixed.sol";

interface IReentrantScenario {
    function reentrancyTarget() external view returns (uint8);
}

interface IGlobalReentrancyGuard {
    function reentrancyGuardEntered() external view returns (bool);
}

/**
 * @title ERC20ReentrantFuzz
 * @notice Malicious ERC20 token that attempts reentrancy attacks during transfers
 * @dev Used to test globalNonReentrant modifier in fuzzing scenarios
 */
contract ERC20ReentrantFuzz is ERC20Fuzz {
    using FixLib for uint192;

    // Attack configuration
    bool public attackEnabled;
    IReentrantScenario public scenario;

    // Tracking counters
    uint256 public attemptedReentrancies;
    uint256 public blockedByGuardReentrancies;
    uint256 public failedReentrancies;
    bool public reentrancySucceeded;

    // Target function identifiers
    enum Target {
        RTOKEN_ISSUE,           // 0
        RTOKEN_REDEEM,          // 1
        RTOKEN_REDEEM_CUSTOM,   // 2
        RTOKEN_MONETIZE,        // 3
        STRSR_STAKE,            // 4
        STRSR_UNSTAKE,          // 5
        STRSR_WITHDRAW,         // 6
        STRSR_CANCEL_UNSTAKE,   // 7
        BACKING_REBALANCE,      // 8
        BACKING_FORWARD_REVENUE,// 9
        BACKING_GRANT_ALLOWANCE,// 10
        TRADER_DISTRIBUTE,      // 11
        TRADER_SETTLE,          // 12
        TRADER_CLAIM_REWARDS    // 13
    }

    constructor(
        string memory name_,
        string memory symbol_,
        IMainFuzz main_,
        IReentrantScenario scenario_
    ) ERC20Fuzz(name_, symbol_, main_) {
        scenario = scenario_;
    }

    function enableAttack() external {
        attackEnabled = true;
    }

    function disableAttack() external {
        attackEnabled = false;
    }


    function transfer(address to, uint256 amount) public override returns (bool) {
        if (attackEnabled) {
            attemptReentrancy();
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (attackEnabled) {
            attemptReentrancy();
        }
        return super.transferFrom(from, to, amount);
    }

    function attemptReentrancy() internal {
        // Only attempt reentrancy if we're already inside a globalNonReentrant context
        // This ensures we're testing actual reentrancy, not just regular calls
        if (!IGlobalReentrancyGuard(address(main)).reentrancyGuardEntered()) {
            return; // No lock active, don't attempt
        }

        // Get the target function to call
        uint8 currentTarget = scenario.reentrancyTarget();

        // Track the attempt in this token
        attemptedReentrancies++;

        // Try to execute the target function and check if it's blocked by reentrancy guard
        (bool success, bool blockedByGuard) = executeTargetFunction(currentTarget);

        if (success) {
            // This should never happen if globalNonReentrant is working!
            reentrancySucceeded = true;
        } else if (blockedByGuard) {
            // Expected behavior - reentrancy was blocked by the global guard
            blockedByGuardReentrancies++;
            failedReentrancies++;
        } else {
            // Failed for some other reason (paused, insufficient balance, etc.)
            failedReentrancies++;
        }
    }

    function executeTargetFunction(uint8 target) internal returns (bool success, bool blockedByGuard) {
        // Get minimal amounts for testing (1 token or smallest unit)
        uint256 minAmount = 1;

        if (target == uint8(Target.RTOKEN_ISSUE)) {
            try TestIRToken(address(main.rToken())).issue(minAmount) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.RTOKEN_REDEEM)) {
            try TestIRToken(address(main.rToken())).redeem(minAmount) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.RTOKEN_REDEEM_CUSTOM)) {
            // For redeemCustom, we need to set up arrays
            uint48[] memory basketNonces = new uint48[](0);
            uint192[] memory portions = new uint192[](0);
            address[] memory expectedERC20sOut = new address[](0);
            uint256[] memory minAmounts = new uint256[](0);
            address recipient = address(this);

            try TestIRToken(address(main.rToken())).redeemCustom(
                recipient,
                minAmount,
                basketNonces,
                portions,
                expectedERC20sOut,
                minAmounts
            ) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.RTOKEN_MONETIZE)) {
            // Try to monetize donations for this token
            try TestIRToken(address(main.rToken())).monetizeDonations(IERC20(address(this))) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.STRSR_STAKE)) {
            try IStRSR(address(main.stRSR())).stake(minAmount) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.STRSR_UNSTAKE)) {
            try IStRSR(address(main.stRSR())).unstake(minAmount) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.STRSR_WITHDRAW)) {
            try IStRSR(address(main.stRSR())).withdraw(address(this), 0) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.STRSR_CANCEL_UNSTAKE)) {
            try IStRSR(address(main.stRSR())).cancelUnstake(0) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.BACKING_REBALANCE)) {
            try IBackingManager(address(main.backingManager())).rebalance(TradeKind.BATCH_AUCTION) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.BACKING_FORWARD_REVENUE)) {
            IERC20[] memory erc20s = new IERC20[](1);
            erc20s[0] = IERC20(address(this));

            try IBackingManager(address(main.backingManager())).forwardRevenue(erc20s) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.BACKING_GRANT_ALLOWANCE)) {
            try IBackingManager(address(main.backingManager())).grantRTokenAllowance(IERC20(address(this))) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.TRADER_DISTRIBUTE)) {
            // Try on RSR trader
            try IRevenueTrader(address(main.rsrTrader())).distributeTokenToBuy() {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.TRADER_SETTLE)) {
            try IBackingManager(address(main.backingManager())).settleTrade(IERC20(address(this))) {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }

        } else if (target == uint8(Target.TRADER_CLAIM_REWARDS)) {
            try IRevenueTrader(address(main.rsrTrader())).claimRewards() {
                return (true, false);
            } catch (bytes memory reason) {
                return (false, isReentrancyError(reason));
            }
        }

        return (false, false);
    }

    /**
     * @notice Check if the error is specifically the ReentrancyGuardReentrantCall error
     * @param reason The revert reason bytes
     * @return true if the error is the reentrancy guard error
     */
    function isReentrancyError(bytes memory reason) internal pure returns (bool) {
        // The error selector for ReentrancyGuardReentrantCall()
        // keccak256("ReentrancyGuardReentrantCall()") = 0x3ee5aeb5
        bytes4 reentrancyErrorSelector = 0x3ee5aeb5;

        // Check if the reason data starts with the error selector
        if (reason.length >= 4) {
            bytes4 receivedSelector;
            assembly {
                receivedSelector := mload(add(reason, 0x20))
            }
            return receivedSelector == reentrancyErrorSelector;
        }
        return false;
    }
}