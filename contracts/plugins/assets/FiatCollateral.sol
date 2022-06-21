// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "./SelfReferentialCollateral.sol";

/**
 * @title FiatCollateral
 * @notice A general non-appreciating collateral type to be extended.
 */
contract FiatCollateral is SelfReferentialCollateral {
    using FixLib for uint192;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    IERC20Metadata public immutable referenceERC20;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint256 public immutable delayUntilDefault; // {s} e.g 86400

    // solhint-disable-next-line func-name-mixedcase
    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_
    ) SelfReferentialCollateral(main_, erc20_, maxTradeVolume_, bytes32(bytes("USD"))) {
        defaultThreshold = defaultThreshold_;
        delayUntilDefault = delayUntilDefault_;
        referenceERC20 = referenceERC20_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return main.oracle().priceUSD(bytes32(bytes(referenceERC20.symbol())));
    }

    /// Refresh exchange rates and update default status.
    /// @dev This default check assumes that the collateral's price() value is expected
    /// to stay close to pricePerTarget() * targetPerRef(). If that's not true for the
    /// collateral you're defining, you MUST redefine refresh()!!
    function refresh() external virtual override {
        if (whenDefault <= block.timestamp) {
            return;
        }
        uint256 oldWhenDefault = whenDefault;

        uint192 p = price();

        // {UoA/ref} = {UoA/target} * {target/ref}
        uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
        uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

        // If the price is below the default-threshold price, default eventually
        if (p < peg - delta || p > peg + delta) {
            whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
        } else whenDefault = NEVER;

        if (whenDefault != oldWhenDefault) {
            emit DefaultStatusChanged(oldWhenDefault, whenDefault, status());
        }
    }

    /// @return The collateral's status
    function status() public view virtual override returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (whenDefault <= block.timestamp) {
            return CollateralStatus.DISABLED;
        } else {
            return CollateralStatus.IFFY;
        }
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual override returns (uint192) {
        return FIX_ONE;
    }
}
