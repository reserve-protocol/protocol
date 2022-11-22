// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/// External Interface for StakedTokenV1
// See: https://github.com/coinbase/wrapped-tokens-os/
//      blob/main/contracts/wrapped-tokens/staking/StakedTokenV1.sol
interface IStakedToken {
    /// @dev From Coinbase StakedTokenV1.sol: Returns the current exchange rate scaled by by 10**18
    /// @return _exchangeRate The exchange rate
    function exchangeRate() external view returns (uint256);
}

/// External Interface for future StakedTokenV1 Controller witch
/// should follow cToken model.
// see https://www.coinbase.com/cbeth/whitepaper
interface IStakedController {
    /// Claim cbEth for an account, to an account
    function claimStaked(address account, uint256 amount) external;

    /// @return The address for Staked token
    function getStakedAddress() external view returns (address);
}
