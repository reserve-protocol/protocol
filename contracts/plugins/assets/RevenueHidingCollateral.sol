// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../interfaces/IAsset.sol";
import "./OracleLib.sol";
import "contracts/libraries/Fixed.sol";

abstract contract RevenueHidingCollateral is ICollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IERC20Metadata public immutable override erc20;
    uint8 public immutable override erc20Decimals;

    bytes32 public immutable override targetName;

    uint192 public immutable fallbackPrice; // {UoA}

    uint192 public immutable override maxTradeVolume; // {UoA}

    // {s} seconds contained in a single time period for calculating fee
    uint256 public constant PERIOD = 60;
    uint192 public immutable revenueVisibleAmount; // {%} e.g. 0.95
    uint192 public maxRefPerTok;

    // Default Status:
    // _whenDefault == NEVER: no risk of default (initial value)
    // _whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving _whenDefault == NEVER.
    // _whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;

    uint256 public immutable delayUntilDefault; // {s} e.g 86400

    constructor(
        address token_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint16 basisPoints_
    ) {
        require(targetName_ != bytes32(0), "targetName missing");
        require(delayUntilDefault_ > 0, "delayUntilDefault zero");
        require(token_ != address(0), "");

        require(basisPoints_ <= 10000, "basisPoints_ invalid");
        erc20 = IERC20Metadata(token_);
        erc20Decimals = erc20.decimals();
        maxTradeVolume = _safeWrap(maxTradeVolume_);
        fallbackPrice = _safeWrap(fallbackPrice_);
        targetName = targetName_;
        delayUntilDefault = delayUntilDefault_;
        revenueVisibleAmount = FIX_ONE - shiftl_toFix(basisPoints_, -2);
    }

    function markStatus(CollateralStatus status_) internal {
        if (_whenDefault <= block.timestamp) return; // prevent DISABLED -> SOUND/IFFY

        if (status_ == CollateralStatus.SOUND) {
            _whenDefault = NEVER;
        } else if (status_ == CollateralStatus.IFFY) {
            _whenDefault = Math.min(block.timestamp + delayUntilDefault, _whenDefault);
        } else if (status_ == CollateralStatus.DISABLED) {
            _whenDefault = block.timestamp;
        }
    }

    function alreadyDefaulted() internal view returns (bool) {
        return _whenDefault <= block.timestamp;
    }

    function whenDefault() external view returns (uint256) {
        return _whenDefault;
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price()
    function strictPrice() public view virtual returns (uint192);

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a allowFallback price
    /// @return {UoA/tok} The current price, or if it's reverting, a fallback price
    function price(bool allowFallback) public view override returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, fallbackPrice);
        }
    }

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view override returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure override returns (bool) {
        return true;
    }

    // solhint-disable no-empty-blocks

    /// (address, calldata) to call in order to claim rewards for holding this asset
    /// @dev The default impl returns zero values, implying that no reward function exists.
    function getClaimCalldata() external view virtual returns (address _to, bytes memory _cd) {}

    /// @return The status of this collateral asset. (Is it defaulting? Might it soon?)
    function status() public view virtual override returns (CollateralStatus) {
        if (_whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (_whenDefault > block.timestamp) {
            return CollateralStatus.IFFY;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    /// Refresh exchange rates and update default status.
    /// The Reserve protocol calls this at least once per transaction, before relying on
    /// this collateral's prices or default status.
    function refresh() external virtual {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();
        uint192 actualRefPerTok_ = actualRefPerTok();
        if (actualRefPerTok_ < refPerTok()) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            if (actualRefPerTok_ > maxRefPerTok) {
                maxRefPerTok = actualRefPerTok_;
            }
            bool isSound = _checkAndUpdateDefaultStatus();
            if (isSound) {
                try this.strictPrice() returns (uint192) {
                    markStatus(CollateralStatus.SOUND);
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            }
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    // ==== Exchange Rates ====

    /// @return {ref/tok} Quantity of whole reference units (hidden) per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        return actualRefPerTok().mul(revenueVisibleAmount);
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public pure virtual returns (uint192) {
        return FIX_ONE;
    }

    /// @return {ref/tok} Quantity of whole reference units (actual) per whole collateral tokens
    function actualRefPerTok() public view virtual returns (uint192);

    function _checkAndUpdateDefaultStatus() internal virtual returns (bool isSound);
}
