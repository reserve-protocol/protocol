// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "contracts/fuzz/AssetMock.sol";
import "contracts/fuzz/ERC20Fuzz.sol";
import "contracts/fuzz/OracleErrorMock.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AppreciatingFiatCollateral.sol";

contract CollateralMock is OracleErrorMock, AppreciatingFiatCollateral {
    using FixLib for uint192;
    using PriceModelLib for PriceModel;

    PriceModel public refPerTokModel;
    PriceModel public targetPerRefModel;
    PriceModel public uoaPerTargetModel;
    PriceModel public deviationModel;

    constructor(
        // Collateral base-class arguments
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 priceTimeout_,
        uint192 oracleError_,
        uint192 defaultThreshold_,
        uint48 delayUntilDefault_,
        bytes32 targetName_,
        // Price Models
        PriceModel memory refPerTokModel_, // Ref units per token
        PriceModel memory targetPerRefModel_, // Target units per ref unit
        PriceModel memory uoaPerTargetModel_, // Units-of-account per target unit
        PriceModel memory deviationModel_,
        uint192 revenueHiding
    )
        // deviationModel is the deviation of price() from the combination of the above.
        // that is: price() = deviation * uoaPerTarget * targetPerRef * refPerTok
        AppreciatingFiatCollateral(
            CollateralConfig({
                priceTimeout: priceTimeout_,
                chainlinkFeed: AggregatorV3Interface(address(1)),
                oracleError: oracleError_,
                erc20: erc20_,
                maxTradeVolume: maxTradeVolume_,
                oracleTimeout: 1, //stub
                targetName: targetName_,
                defaultThreshold: defaultThreshold_,
                delayUntilDefault: delayUntilDefault_
            }),
            revenueHiding
        )
    {
        refPerTokModel = refPerTokModel_;
        targetPerRefModel = targetPerRefModel_;
        uoaPerTargetModel = uoaPerTargetModel_;
        deviationModel = deviationModel_;

        // Cache constants
        uint192 peg = targetPerRef(); // {target/ref}

        // {target/ref}= {target/ref} * {1}
        uint192 delta = peg.mul(defaultThreshold_);
        pegBottom = peg - delta;
        pegTop = peg + delta;
    }

    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        maybeFail();

        pegPrice = targetPerRefModel.price();

        uint192 p = deviationModel.price().mul(uoaPerTargetModel.price()).mul(pegPrice).mul(
            refPerTokModel.price()
        );

        (low, high) = errRange(p, oracleError);
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual override returns (uint192) {
        return targetPerRefModel.price();
    }

    function update(
        uint192 a,
        uint192 b,
        uint192 c,
        uint192 d
    ) public virtual {
        refPerTokModel.update(a);
        targetPerRefModel.update(b);
        uoaPerTargetModel.update(c);
        deviationModel.update(d);
        refresh();
    }

    function partialUpdate(uint192 a, uint192 b) public {
        uoaPerTargetModel.update(a);
        deviationModel.update(b);
    }

    // expects delegatecall; claimer and rewardee is `this`
    function claimRewards() public override(Asset, IRewardable) {
        ERC20Fuzz(address(erc20)).payRewards(address(this));
    }

    function _underlyingRefPerTok() internal view virtual override returns (uint192) {
        return refPerTokModel.price();
    }
}

// A CollateralMock that does not use decaying lotPrice()s, but instead just returns the last saved
// value. Needed for DiffTest, because refresh() doesn't always happen in the same block on both P0
// and P1.
contract CollateralNoDecay is CollateralMock {
    function lotPrice() external view virtual override(Asset, IAsset) returns (uint192 lotLow, uint192 lotHigh) {
        try this.tryPrice() returns (uint192 low, uint192 high, uint192) {
            // if the price feed is still functioning, use that
            return (low, high);
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return (savedLowPrice, savedHighPrice);
        }
    }

    constructor(
        // Collateral base-class arguments
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 priceTimeout_,
        uint192 oracleError_,
        uint192 defaultThreshold_,
        uint48 delayUntilDefault_,
        bytes32 targetName_,
        // Price Models
        PriceModel memory refPerTokModel_, // Ref units per token
        PriceModel memory targetPerRefModel_, // Target units per ref unit
        PriceModel memory uoaPerTargetModel_, // Units-of-account per target unit
        PriceModel memory deviationModel_,
        uint192 revenueHiding
    )
        CollateralMock(
            erc20_,
            maxTradeVolume_,
            priceTimeout_,
            oracleError_,
            defaultThreshold_,
            delayUntilDefault_,
            targetName_,
            refPerTokModel_,
            targetPerRefModel_,
            uoaPerTargetModel_,
            deviationModel_,
            revenueHiding
        )
    {}
}
