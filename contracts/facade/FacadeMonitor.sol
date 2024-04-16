// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../interfaces/IFacadeMonitor.sol";
import "../interfaces/IRToken.sol";
import "../libraries/Fixed.sol";
import "../p1/RToken.sol";
import "../plugins/assets/compoundv2/DEPRECATED_CTokenWrapper.sol";
import "../plugins/assets/compoundv3/ICusdcV3Wrapper.sol";
import "../plugins/assets/stargate/StargateRewardableWrapper.sol";
import { StaticATokenV3LM } from "../plugins/assets/aave-v3/vendor/StaticATokenV3LM.sol";
import "../plugins/assets/morpho-aave/MorphoAaveV2TokenisedDeposit.sol";

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
 * @title FacadeMonitor
 * @notice A UX-friendly layer for monitoring RTokens
 */
contract FacadeMonitor is Initializable, OwnableUpgradeable, UUPSUpgradeable, IFacadeMonitor {
    using FixLib for uint192;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    // solhint-disable-next-line var-name-mixedcase
    address public immutable AAVE_V2_DATA_PROVIDER;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(MonitorParams memory params) {
        AAVE_V2_DATA_PROVIDER = params.AAVE_V2_DATA_PROVIDER_ADDR;
        _disableInitializers();
    }

    function init(address initialOwner) public initializer {
        require(initialOwner != address(0), "invalid owner address");

        __Ownable_init();
        __UUPSUpgradeable_init();
        _transferOwnership(initialOwner);
    }

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

        if (collType == CollPluginType.AAVE_V2 || collType == CollPluginType.MORPHO_AAVE_V2) {
            address underlying;
            if (collType == CollPluginType.AAVE_V2) {
                // AAVE V2 - Uses Static wrapper
                IStaticATokenLM staticAToken = IStaticATokenLM(address(erc20));
                backingBalance = staticAToken.dynamicBalanceOf(
                    address(rToken.main().backingManager())
                );
                underlying = staticAToken.UNDERLYING_ASSET_ADDRESS();
            } else {
                // MORPHO AAVE V2
                MorphoAaveV2TokenisedDeposit mrpTknDeposit = MorphoAaveV2TokenisedDeposit(
                    address(erc20)
                );
                backingBalance = mrpTknDeposit.convertToAssets(
                    mrpTknDeposit.balanceOf(address(rToken.main().backingManager()))
                );
                underlying = mrpTknDeposit.underlying();
            }

            (availableLiquidity, , , , , , , , , ) = IAaveProtocolDataProvider(
                AAVE_V2_DATA_PROVIDER
            ).getReserveData(underlying);
        } else if (collType == CollPluginType.AAVE_V3) {
            StaticATokenV3LM staticAToken = StaticATokenV3LM(address(erc20));
            IERC20 aToken = staticAToken.aToken();
            IERC20 underlying = IERC20(staticAToken.asset());

            backingBalance = staticAToken.convertToAssets(
                staticAToken.balanceOf(address(rToken.main().backingManager()))
            );
            availableLiquidity = underlying.balanceOf(address(aToken));
        } else if (collType == CollPluginType.COMPOUND_V2 || collType == CollPluginType.FLUX) {
            // (1) OLD compound-v2 uses a wrapper
            // (2) NEW compound-v2 does not use a wrapper
            // (3) FLUX does not use a wrapper
            ICToken cToken = ICToken(ICToken(address(erc20)).underlying()); // case (1)

            // solhint-disable-next-line no-empty-blocks
            try cToken.underlying() returns (address) {} catch {
                cToken = ICToken(address(erc20)); // case (2) or (3)
            }
            uint256 cTokenBal = cToken.balanceOf(address(rToken.main().backingManager()));

            IERC20 underlying = IERC20(cToken.underlying());
            uint256 exchangeRate = cToken.exchangeRateStored();

            backingBalance = (cTokenBal * exchangeRate) / 1e18;
            availableLiquidity = underlying.balanceOf(address(cToken));
        } else if (collType == CollPluginType.COMPOUND_V3) {
            ICusdcV3Wrapper cTokenV3Wrapper = ICusdcV3Wrapper(address(erc20));
            CometInterface cTokenV3 = CometInterface(address(cTokenV3Wrapper.underlyingComet()));
            IERC20 underlying = IERC20(cTokenV3.baseToken());

            backingBalance = cTokenV3Wrapper.underlyingBalanceOf(
                address(rToken.main().backingManager())
            );
            availableLiquidity = underlying.balanceOf(address(cTokenV3));
        } else if (collType == CollPluginType.STARGATE) {
            StargateRewardableWrapper stgWrapper = StargateRewardableWrapper(address(erc20));
            IStargatePool stgPool = stgWrapper.pool();

            uint256 wstgBal = stgWrapper.balanceOf(address(rToken.main().backingManager()));

            backingBalance = stgPool.amountLPtoLD(wstgBal);
            availableLiquidity = stgPool.totalLiquidity();
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

    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
