// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "contracts/libraries/Fixed.sol";

contract RevenueHidingMock is RevenueHiding {
    uint192 private fakeRefPerTok;

    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _chainlinkFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        bytes32 _targetName,
        uint256 _delayUntilDefault,
        uint192 _allowedDropBasisPoints
    )
        RevenueHiding(
            _fallbackPrice,
            _chainlinkFeed,
            _erc20Collateral,
            _maxTradeVolume,
            _oracleTimeout,
            _targetName,
            _delayUntilDefault,
            _allowedDropBasisPoints
        )
    {
        fakeRefPerTok = FIX_ONE;
    }

    function updateFakeRefPerTok(uint192 _value) external {
        fakeRefPerTok = _value;
    }

    function checkReferencePeg() internal override {
        markStatus(CollateralStatus.SOUND);
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function actualRefPerTok() public view override returns (uint192) {
        return fakeRefPerTok;
    }
}
