// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "contracts/interfaces/IAsset.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/OracleErrorMock.sol";
import "contracts/fuzz/ERC20Fuzz.sol";

contract CollateralMock is OracleErrorMock, Collateral {
    using FixLib for uint192;
    using PriceModelLib for PriceModel;

    PriceModel public refPerTokModel;
    PriceModel public targetPerRefModel;
    PriceModel public uoaPerTargetModel;
    PriceModel public deviationModel;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    uint192 public initialPeg; // peg value (for default detection)

    constructor(
        // Collateral base-class arguments
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata, //referenceERC20_,
        bytes32 targetName_,
        // Price Models
        PriceModel memory refPerTokModel_, // Ref units per token
        PriceModel memory targetPerRefModel_, // Target units per ref unit
        PriceModel memory uoaPerTargetModel_, // Units-of-account per target unit
        PriceModel memory deviationModel_
    )
        // deviationModel is the deviation of price() from the combination of the above.
        // that is: price() = deviation * uoaPerTarget * targetPerRef * refPerTok
        Collateral(
            refPerTokModel_.curr.mul(targetPerRefModel_.curr).mul(uoaPerTargetModel_.curr).mul(
                deviationModel_.curr
            ),
            AggregatorV3Interface(address(1)), // Stub out expected Chainlink feed
            erc20_,
            maxTradeVolume_,
            1, // stub out oracleTimeout
            targetName_,
            delayUntilDefault_
        )
    {
        refPerTokModel = refPerTokModel_;
        targetPerRefModel = targetPerRefModel_;
        uoaPerTargetModel = uoaPerTargetModel_;
        deviationModel = deviationModel_;

        defaultThreshold = defaultThreshold_;

        prevReferencePrice = refPerTok();

        // Store peg value
        initialPeg = targetPerRef();
    }

    function price(AggregatorV3Interface, uint48) internal view virtual override returns (uint192) {
        maybeFail();
        return
            deviationModel
                .price()
                .mul(uoaPerTargetModel.price())
                .mul(targetPerRefModel.price())
                .mul(refPerTokModel.price());
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual override returns (uint192) {
        return refPerTokModel.price();
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual override returns (uint192) {
        return targetPerRefModel.price();
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual override returns (uint192) {
        return uoaPerTargetModel.price();
    }

    function update(
        uint192 a,
        uint192 b,
        uint192 c,
        uint192 d
    ) public {
        refPerTokModel.update(a);
        targetPerRefModel.update(b);
        uoaPerTargetModel.update(c);
        deviationModel.update(d);
    }

    function partialUpdate(uint192 a, uint192 b) public {
        uoaPerTargetModel.update(a);
        deviationModel.update(b);
    }

    function refresh() public override {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();

        // Check for hard default
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            uint192 p = targetPerRef();

            // Check if priceable
            if (p > 0) {
                // Check for soft default. If not pegged, default eventually
                uint192 delta = (initialPeg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}
                if (p < initialPeg - delta || p > initialPeg + delta) {
                    markStatus(CollateralStatus.IFFY);
                } else markStatus(CollateralStatus.SOUND);
            } else {
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    // ==== Rewards ====
    // expects delegatecall; claimer and rewardee is `this`
    function claimRewards() override public {
        ERC20Fuzz(address(erc20)).payRewards(address(this));
    }
}
