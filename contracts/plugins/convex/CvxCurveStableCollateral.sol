// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IAsset.sol";
import "./PoolTokens.sol";

interface IWrappedStakedCvx {
    function crv() external returns (address);

    function cvx() external returns (address);

    function getReward(address _account) external;
}

/**
 * @title CvxCurveStableCollateral
 */
contract CvxCurveStableCollateral is CvxCurvePoolTokens, ICollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    struct Configuration {
        ERC20 lpToken;
        uint8 nTokens;
        address[][] tokensPriceFeeds;
        address targetPegFeed;
        address wrappedStakeToken;
        ICurvePool curvePool;
        bytes32 targetName;
        uint48 oracleTimeout;
        uint192 fallbackPrice;
        uint192 maxTradeVolume;
        uint192 defaultThreshold;
        uint192 poolRatioThreshold;
        uint256 delayUntilDefault;
        CurvePoolType poolType;
    }

    IERC20Metadata public immutable erc20;
    IWrappedStakedCvx public immutable wrappedStakeToken;
    ERC20 public immutable lpToken;
    uint8 internal immutable lpTokenDecimals;
    uint8 public immutable erc20Decimals;
    uint192 public immutable maxTradeVolume; // {UoA}
    uint192 public immutable fallbackPrice; // {UoA}
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    uint192 public immutable poolRatioThreshold;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    uint256 public immutable delayUntilDefault; // {s} e.g 86400
    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;
    bytes32 public immutable targetName;
    address public immutable targetPegFeed;

    constructor(Configuration memory config) CvxCurvePoolTokens(ptConfig(config)) {
        require(address(config.lpToken) != address(0), "lp token address is zero");
        require(config.wrappedStakeToken != address(0), "wrappedStakeToken address is zero");
        require(config.fallbackPrice > 0, "fallback price zero");
        require(config.maxTradeVolume > 0, "invalid max trade volume");
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        require(config.targetName != bytes32(0), "targetName missing");
        require(config.delayUntilDefault > 0, "delayUntilDefault zero");
        require(config.poolRatioThreshold > 0, "poolRatioThreshold zero");

        erc20 = ERC20(config.wrappedStakeToken);
        wrappedStakeToken = IWrappedStakedCvx(config.wrappedStakeToken);
        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;
        erc20Decimals = erc20.decimals();
        maxTradeVolume = config.maxTradeVolume;
        fallbackPrice = config.fallbackPrice;
        defaultThreshold = config.defaultThreshold;
        poolRatioThreshold = config.poolRatioThreshold;
        targetPegFeed = config.targetPegFeed;
        lpToken = config.lpToken;
        lpTokenDecimals = lpToken.decimals();

        prevReferencePrice = refPerTok();
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();
        // Check for hard default
        uint192 referencePrice = refPerTok();
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            if (pegNotMaintained() || unbalancedBeyondTreshold()) {
                markStatus(CollateralStatus.IFFY);
            } else {
                markStatus(CollateralStatus.SOUND);
            }
        }
        prevReferencePrice = referencePrice;
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
    }

    function ptConfig(Configuration memory config) internal pure returns (PTConfiguration memory) {
        return
            PTConfiguration({
                lpToken: config.lpToken,
                nTokens: config.nTokens,
                tokenFeeds: config.tokensPriceFeeds,
                curvePool: config.curvePool,
                poolType: config.poolType,
                oracleTimeout: config.oracleTimeout
            });
    }

    function unbalancedBeyondTreshold() internal view returns (bool) {
        uint192[] memory balances = getBalances();
        uint192 totalBalances;
        uint192 min = FIX_MAX;
        uint192 max;

        for (uint8 i = 0; i < balances.length; i++) {
            min = _safeWrap(Math.min(min, balances[i]));
            max = _safeWrap(Math.max(max, balances[i]));
            totalBalances += balances[i];
        }

        return (max - min).div(totalBalances) > poolRatioThreshold;
    }

    function pegNotMaintained() internal view returns (bool) {
        for (uint8 i = 0; i < nTokens; i++) {
            try this.tokenPrice(i) returns (uint192 p) {
                // Check for soft default of underlying reference token
                uint192 peg = getPeg();
                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}
                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) return true;
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                return true;
            }
        }
        return false;
    }

    function getPeg() public view returns (uint192) {
        if (targetPegFeed == address(0)) return targetPerRef();
        return AggregatorV3Interface(targetPegFeed).price(oracleTimeout).mul(targetPerRef());
    }

    function strictPrice() public view returns (uint192) {
        uint192 _totalSupply = shiftl_toFix(lpToken.totalSupply(), -int8(lpTokenDecimals));
        return totalBalancesValue().div(_totalSupply);
    }

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a allowFallback price
    /// @return {UoA/tok} The current price, or if it's reverting, a fallback price
    function price(bool allowFallback) public view returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, fallbackPrice);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view returns (uint192) {
        return _safeWrap(curvePool.get_virtual_price());
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public pure returns (uint192) {
        return FIX_ONE;
    }

    /// @return The collateral's status
    function status() public view override returns (CollateralStatus) {
        if (_whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (_whenDefault > block.timestamp) {
            return CollateralStatus.IFFY;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    function claimRewards() external {
        IERC20 cvx = IERC20(wrappedStakeToken.cvx());
        IERC20 crv = IERC20(wrappedStakeToken.crv());
        uint256 cvxOldBal = cvx.balanceOf(address(this));
        uint256 crvOldBal = crv.balanceOf(address(this));
        wrappedStakeToken.getReward(address(this));
        emit RewardsClaimed(cvx, cvx.balanceOf(address(this)) - cvxOldBal);
        emit RewardsClaimed(crv, crv.balanceOf(address(this)) - crvOldBal);
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure returns (bool) {
        return true;
    }

    // === Helpers ===

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

    function whenDefault() public view returns (uint256) {
        return _whenDefault;
    }
}
