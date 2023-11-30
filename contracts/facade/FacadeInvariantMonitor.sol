// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IFacadeInvariantMonitor.sol";
import "../interfaces/IRToken.sol";
import "../libraries/Fixed.sol";
import "../p1/RToken.sol";
import "../plugins/assets/compoundv2/CTokenWrapper.sol";

interface IAaveProtocolDataProvider {
    function getReserveData(address asset)
        external
        view
        returns (
            uint256 availableLiquidity,
            uint256 totalStableDebt,
            uint256 totalVariableDebt,
            uint256 liquidityRate,
            uint256 variableBorrowRate,
            uint256 stableBorrowRate,
            uint256 averageStableBorrowRate,
            uint256 liquidityIndex,
            uint256 variableBorrowIndex,
            uint40 lastUpdateTimestamp
        );
}

interface IStaticATokenLM is IERC20 {
    // solhint-disable-next-line func-name-mixedcase
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);

    function dynamicBalanceOf(address account) external view returns (uint256);
}

/**
 * @title FacadeInvariantMonitor
 * @notice A UX-friendly layer for monitoring invariants of specific RToken
 */
contract FacadeInvariantMonitor is IFacadeInvariantMonitor {
    using FixLib for uint192;

    IAaveProtocolDataProvider public constant AAVE_V2_DATA_PROVIDER =
        IAaveProtocolDataProvider(0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d);

    // === Views ===

    /// @return Whether batch auctions are disabled for a specific rToken
    function batchAuctionsDisabled(IRToken rToken) external view returns (bool) {
        return rToken.main().broker().batchTradeDisabled();
    }

    /// @return Whether any dutch auction is disabled for a specific rToken
    function dutchAuctionsDisabled(IRToken rToken) external view returns (bool) {
        bool disabled = false;

        IERC20[] memory erc20s = rToken.main().assetRegistry().erc20s();
        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (rToken.main().broker().dutchTradeDisabled(IERC20Metadata(address(erc20s[i]))))
                disabled = true;
        }

        return disabled;
    }

    /// @return Which percentage of issuance throttle is still available for a specific rToken
    function issuanceAvailable(IRToken rToken) external view returns (uint256) {
        ThrottleLib.Params memory params = RTokenP1(address(rToken)).issuanceThrottleParams();

        // Calculate hourly limit as: max(params.amtRate, supply.mul(params.pctRate))
        uint256 limit = (rToken.totalSupply() * params.pctRate) / FIX_ONE_256; // {qRTok}
        if (params.amtRate > limit) limit = params.amtRate;

        uint256 issueAvailable = rToken.issuanceAvailable();
        if (issueAvailable >= limit) return FIX_ONE_256;

        return (issueAvailable * FIX_ONE_256) / limit;
    }

    function redemptionAvailable(IRToken rToken) external view returns (uint256) {
        ThrottleLib.Params memory params = RTokenP1(address(rToken)).redemptionThrottleParams();

        uint256 supply = rToken.totalSupply();

        if (supply == 0) return FIX_ONE_256;

        // Calculate hourly limit as: max(params.amtRate, supply.mul(params.pctRate))
        uint256 limit = (supply * params.pctRate) / FIX_ONE_256; // {qRTok}
        if (params.amtRate > limit) limit = supply < params.amtRate ? supply : params.amtRate;

        uint256 redeemAvailable = rToken.redemptionAvailable();
        if (redeemAvailable >= limit) return FIX_ONE_256;

        return (redeemAvailable * FIX_ONE_256) / limit;
    }

    function backingReedemable(
        IRToken rToken,
        CollPluginType collType,
        IERC20 erc20
    ) external view returns (uint256) {
        uint256 backingBalance;
        uint256 availableLiquidity;

        if (collType == CollPluginType.AAVE_V2) {
            IStaticATokenLM staticAToken = IStaticATokenLM(address(erc20));

            backingBalance = staticAToken.dynamicBalanceOf(address(rToken.main().backingManager()));
            (availableLiquidity, , , , , , , , , ) = AAVE_V2_DATA_PROVIDER.getReserveData(
                address(staticAToken.UNDERLYING_ASSET_ADDRESS())
            );
        } else if (collType == CollPluginType.COMPOUND_V2) {
            CTokenWrapper cTokenVault = CTokenWrapper(address(erc20));
            ICToken cToken = ICToken(address(cTokenVault.underlying()));
            IERC20 underlying = IERC20(cToken.underlying());

            uint256 exchangeRate = cToken.exchangeRateStored();
            uint256 underlyingDecimals = IERC20Metadata(address(underlying)).decimals();
            uint256 cTokenBal = cTokenVault.balanceOf(address(rToken.main().backingManager()));

            backingBalance = (cTokenBal * exchangeRate) / (10**underlyingDecimals);
            availableLiquidity = underlying.balanceOf(address(cToken));
        }

        if (availableLiquidity == 0) {
            return 0; // Avoid division by zero
        }

        if (availableLiquidity >= backingBalance) {
            return FIX_ONE_256;
        }

        // Calculate the percentage
        return (availableLiquidity * FIX_ONE_256) / backingBalance;
    }
}
