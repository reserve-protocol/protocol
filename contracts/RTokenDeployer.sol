// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./modules/InsurancePool.sol";
import "./modules/Owner.sol";
import "./libraries/Token.sol";
import "./RToken.sol";

/*
 * @title RTokenDeployer
 * @dev Static deployment of V1 of the Reserve Protocol.
 * Allows anyone to create insured basket currencies that have the ability to change collateral.
 */
contract RTokenDeployer {
    function deploy(
        address owner,
        string calldata name,
        string calldata symbol,
        RToken.Config memory rTokenConfig,
        Token.Info[] memory basketTokens,
        Token.Info memory rsrToken
    )
        public
        returns (
            address rToken,
            address insurancePool
        )
    {
        // Create RToken and InsurancePool
        // TODO: Deploy proxy
        // RToken rtoken = RToken.initialize(owner, name, symbol, rTokenConfig, basketTokens, rsrToken);
        // InsurancePool ip = new InsurancePool(address(rtoken), rsrToken.tokenAddress);
        // return (address(rtoken), address(ip));
    }
}
