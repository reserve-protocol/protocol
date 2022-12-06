// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/ICToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/bancor/IBancorProxy.sol";
import "contracts/plugins/assets/bancor/IBnTokenERC20.sol";
import "contracts/plugins/assets/bancor/IStandardRewards.sol";
import "contracts/plugins/assets/bancor/IAutoCompoundingRewards.sol";
import "hardhat/console.sol";

/**
 * @title CTokenFiatCollateral
 * @notice Collateral plugin for a cToken of fiat collateral, like cUSDC or cUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract BancorV3FiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    int8 public immutable ERC20Decimals;
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    IBancorProxy public immutable bancorProxy;
    IBnTokenERC20 public immutable bnToken;
    IStandardRewards public immutable standardRewards;
    IAutoCompoundingRewards public immutable autoCompoundingRewards;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        address bancorProxy_,
        address standardRewards_,
        address autoCompoundingRewards_
    )
    Collateral(
        fallbackPrice_,
        chainlinkFeed_,
        erc20_,
        maxTradeVolume_,
        oracleTimeout_,
        targetName_,
        delayUntilDefault_
    )
    {
        require(bancorProxy_ != address(0), "missing erc20");
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(standardRewards_ != address(0), "standardRewards missing");

        bnToken = IBnTokenERC20(address(erc20));
        bancorProxy = IBancorProxy(bancorProxy_);
        ERC20Decimals = int8(erc20.decimals());
        defaultThreshold = defaultThreshold_;
        standardRewards = IStandardRewards(standardRewards_);
        autoCompoundingRewards = IAutoCompoundingRewards(autoCompoundingRewards_);
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        autoCompoundingRewards.autoProcessRewards();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // Check for soft default of underlying reference token
                // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE;
                // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                else markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert();
                // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint192 rate = _safeWrap(
            bancorProxy.poolTokenToUnderlying(bnToken.reserveToken(), 1e6)
        );
        int8 shiftLeft = 8 - ERC20Decimals - 8;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external override {
        uint256[] memory ids = new uint256[](1);
        ids[0] = standardRewards.latestProgramId(bnToken.reserveToken());
        console.log("%s", ids[0]);
        uint256 claimed = standardRewards.claimRewards(ids);
        IERC20 bnt = IERC20(0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C);
        emit RewardsClaimed(bnt, 0);
    }
}
