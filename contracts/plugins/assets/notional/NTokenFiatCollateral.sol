// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/plugins/assets/notional/INotionalProxy.sol";
import "contracts/plugins/assets/notional/INTokenERC20Proxy.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title NTokenFiatCollateral
 * @notice Collateral plugin for a NToken of fiat collateral
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract NTokenFiatCollateral is RevenueHiding {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    INTokenERC20Proxy public immutable nToken;
    INotionalProxy public immutable notionalProxy;
    uint192 public immutable defaultThreshold; // {%} percentage allowed of de-peg // D18

    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _chainlinkFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        bytes32 _targetName,
        uint256 _delayUntilDefault,
        address _notionalProxy,
        uint192 _defaultThreshold,
        uint192 _allowedDrop
    )
    RevenueHiding(
        _fallbackPrice,
        _chainlinkFeed,
        _erc20Collateral,
        _maxTradeVolume,
        _oracleTimeout,
        _targetName,
        _delayUntilDefault,
        _allowedDrop
    )
    {
        require(_notionalProxy != address(0), "Notional proxy address missing");

        nToken = INTokenERC20Proxy(address(_erc20Collateral));
        notionalProxy = INotionalProxy(_notionalProxy);
        defaultThreshold = _defaultThreshold;
    }

    function checkReferencePeg() internal override {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 currentPrice) {
            // the peg of our reference is always ONE target
            uint192 peg = FIX_ONE;

            // since peg is ONE we dont need to operate the threshold to get the delta
            uint192 delta = defaultThreshold;

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (
                currentPrice < peg - delta ||
                currentPrice > peg + delta
            ) {
                markStatus(CollateralStatus.IFFY);
            }
            else {
                markStatus(CollateralStatus.SOUND);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert();
            // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function actualRefPerTok() public view override returns (uint192) {
        // fetch value of all current liquidity
        uint192 valueOfAll = _safeWrap(uint256(nToken.getPresentValueUnderlyingDenominated())); // D8 uint256
        // fetch total supply of tokens
        uint192 totalSupply = _safeWrap(nToken.totalSupply()); // D8 uint256
        // divide to get the value of one token
        return valueOfAll.div(totalSupply);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// Must emit `RewardsClaimed` for each token rewards are claimed for
    /// @dev delegatecall: let there be dragons!
    /// @custom:interaction
    function claimRewards() external override {
        // claim rewards and returns the number of claimed tokens
        uint256 claimedNote = notionalProxy.nTokenClaimIncentives();
        // Address of NOTE token is the same across all possible liquidity collateral
        IERC20 note = IERC20(0xCFEAead4947f0705A14ec42aC3D44129E1Ef3eD5);
        // Emit event
        emit RewardsClaimed(note, claimedNote);
    }
}
