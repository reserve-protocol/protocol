// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../AppreciatingFiatCollateral.sol";
import "../../../libraries/Fixed.sol";
import "../../../interfaces/IAsset.sol";
import "./IBancorNetworkInfo.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BNTokenFiatCollateral
 * @notice Collateral plugin for a V3 pool with fiat collateral, like USDC or USDT
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract BNTokenFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IBancorNetworkInfo public immutable network_info;
    address public immutable underlying_token;
    IERC20 public immutable bancor_token;

    uint8 public immutable reference_decimals;

    /// @param config Configuration of this collateral. config.erc20 must be the pool token, i.e. bnUSDC
    /// @param _network_info {1} The address to the deployed BancorNetworkInfo contract
    /// @param _underlying_token {2} The token that backs the pool token, i.e. USDC
    /// @param revenue_hiding {3} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(
        CollateralConfig memory config,
        address _network_info,
        address _underlying_token,
        uint192 revenue_hiding
    ) AppreciatingFiatCollateral(config, revenue_hiding) {
        require(address(config.erc20) != address(0), "missing erc20");
        require(address(_network_info) != address(0), "missing network info");
        require(address(_underlying_token) != address(0), "missing pool token");
        network_info = IBancorNetworkInfo(_network_info);
        bancor_token = IERC20(config.erc20);
        underlying_token = _underlying_token;
        reference_decimals = config.erc20.decimals();
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        //Due to bancor's design, if the pool is in deficit the pool will payout
        //less than the LP token rate if a withdrawl is made. Thus, the rate has
        //to be calculated taking into account the amount the protocol will let
        //you withdraw, rather than just the bare underlyingToPoolToken rate

        // For the highest accuracy, we make this calculation with the max supply
        // of the pool token.
        uint256 supply = bancor_token.totalSupply();
        WithdrawalAmounts memory amounts = network_info.withdrawalAmounts(underlying_token, supply);
        return shiftl_toFix(amounts.baseTokenAmount, 0 - int8(reference_decimals))
            .mul(shiftl_toFix(network_info.underlyingToPoolToken(underlying_token, FIX_ONE), -18))
            .div(shiftl_toFix(amounts.totalAmount, 0 - int8(reference_decimals)));
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override(Asset, IRewardable) {
        // Bancor rewards are not available because in order to engage in the
        // program users must stake their LP tokens into another contract,
        // which would not allow them to be transferred to the rToken on issue.
    }
}
