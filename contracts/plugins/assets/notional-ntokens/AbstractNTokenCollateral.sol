// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/plugins/assets/notional-ntokens/INotionalProxy.sol";
import "contracts/plugins/assets/notional-ntokens/INTokenERC20Proxy.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title Abstract NToken Collateral
 * @notice Abstract implementation of for the NToken collateral plugins
 */
abstract contract NTokenCollateral is RevenueHiding {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    INTokenERC20Proxy public immutable nToken;
    INotionalProxy public immutable notionalProxy;
    uint192 public immutable defaultThreshold; // {%} percentage allowed of de-peg // D18

    /// @param _fallbackPrice {UoA} Price to be returned in worst case
    /// @param _targetPerRefFeed Feed units: {UoA/ref}
    /// @param _erc20Collateral Asset that the plugin manages
    /// @param _maxTradeVolume {UoA} The max trade volume, in UoA
    /// @param _oracleTimeout {s} The number of seconds until a oracle value becomes invalid
    /// @param _allowedDropBasisPoints {bps} Max drop allowed on refPerTok before defaulting
    /// @param _targetName Name of category
    /// @param _delayUntilDefault {s} The number of seconds deviation must occur before default
    /// @param _notionalProxy Address of the NotionalProxy to communicate to the protocol
    /// @param _defaultThreshold {%} A value like 0.05 that represents a deviation tolerance
    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _targetPerRefFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        uint16 _allowedDropBasisPoints,
        bytes32 _targetName,
        uint256 _delayUntilDefault,
        address _notionalProxy,
        uint192 _defaultThreshold
    )
    RevenueHiding(
        _fallbackPrice,
        _targetPerRefFeed,
        _erc20Collateral,
        _maxTradeVolume,
        _oracleTimeout,
        _allowedDropBasisPoints,
        _targetName,
        _delayUntilDefault
    )
    {
        require(_notionalProxy != address(0), "Notional proxy address missing");
        require(_defaultThreshold > 0 && _defaultThreshold < FIX_ONE, "invalid defaultThreshold");

        nToken = INTokenERC20Proxy(address(_erc20Collateral));
        notionalProxy = INotionalProxy(_notionalProxy);
        defaultThreshold = _defaultThreshold;
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function actualRefPerTok() public view override returns (uint192) {
        // fetch value of all current liquidity
        uint192 valueOfAll = _safeWrap(uint256(nToken.getPresentValueUnderlyingDenominated()));
        // D8 uint256
        // fetch total supply of tokens
        uint192 totalSupply = _safeWrap(nToken.totalSupply());
        // D8 uint256
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
